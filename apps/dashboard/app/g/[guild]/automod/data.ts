import 'server-only';
import type { DryRun } from '@maxwell/core/stores/automod';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { PhishingStore } from '@maxwell/core/stores/phishing';
import { db } from '@/lib/db';
import { type Person, people } from '@/lib/people';
import { snowflakeTime } from '@/lib/time';

const PROFILE_LIMIT = 40;
const HELD_LIMIT = 300;
const GATE_ACTIONS = new Set(['automod.gate.letin', 'automod.gate.banall']);
const RECENT = 24 * 60 * 60_000;

export interface SampleView {
  messageId: string;
  authorId: string;
  name: string;
  channelId: string;
  content: string;
  detail: string;
  byMod: boolean;
  createdAt: string;
}

export interface DryRunView {
  id: string;
  ruleKey: string;
  status: DryRun['status'];
  scanned: number;
  caught: number;
  byMods: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  samples: SampleView[];
}

export interface HeldView {
  userId: string;
  name: string;
  avatar: string | null;
  accountAge: number | null;
  heldAt: string;
}

export interface GateView {
  incident: { id: string; reason: string; startedAt: string; endsAt: string | null } | null;
  heldCount: number;
  held: HeldView[];
  last: { entryId: string; summary: string; createdAt: string; banned: boolean } | null;
  now: string;
}

function known(names: Map<string, Person>, id: string): Person | null {
  const person = names.get(id);
  return person?.known ? person : null;
}

export async function dryRunView(run: DryRun): Promise<DryRunView> {
  const names = await people(
    run.samples.map((sample) => sample.authorId),
    PROFILE_LIMIT,
  );
  return {
    id: String(run.id),
    ruleKey: run.ruleKey,
    status: run.status,
    scanned: run.scanned,
    caught: run.caught,
    byMods: run.byMods,
    error: run.error,
    createdAt: new Date(run.createdAt).toISOString(),
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    samples: run.samples.map((sample) => ({
      messageId: sample.messageId,
      authorId: sample.authorId,
      name: known(names, sample.authorId)?.name ?? sample.authorId,
      channelId: sample.channelId,
      content: sample.content,
      detail: sample.detail,
      byMod: sample.byMod,
      createdAt: sample.createdAt,
    })),
  };
}

export async function latestRuns(guildId: string): Promise<DryRunView[]> {
  const runs = await new AutomodStore(db().sql).listDryRuns(guildId, 50);
  const seen = new Set<string>();
  const latest = runs.filter((run) => {
    if (run.status !== 'done' || seen.has(run.ruleKey)) return false;
    seen.add(run.ruleKey);
    return true;
  });
  return Promise.all(latest.map(dryRunView));
}

export async function gateView(guildId: string): Promise<GateView> {
  const store = new AutomodStore(db().sql);
  const [incident, held, entries] = await Promise.all([
    store.activeIncident(guildId),
    store.held(guildId),
    db().audit.list(guildId, { module: 'automod', limit: 30 }),
  ]);
  const shown = held.slice(0, HELD_LIMIT);
  const names = await people(
    shown.map((entry) => entry.userId),
    PROFILE_LIMIT,
  );
  const now = Date.now();
  const entry = entries.find(
    (item) =>
      GATE_ACTIONS.has(item.action) &&
      item.undo !== null &&
      item.undoneAt === null &&
      now - new Date(item.createdAt).getTime() < RECENT,
  );
  return {
    incident: incident
      ? {
          id: String(incident.id),
          reason: incident.reason,
          startedAt: new Date(incident.startedAt).toISOString(),
          endsAt: incident.endsAt ? new Date(incident.endsAt).toISOString() : null,
        }
      : null,
    heldCount: held.length,
    held: shown.map((item) => {
      const born = snowflakeTime(item.userId);
      const heldAt = new Date(item.heldAt);
      return {
        userId: item.userId,
        name: known(names, item.userId)?.name ?? item.userId,
        avatar: known(names, item.userId)?.avatar ?? null,
        accountAge: born === null ? null : Math.max(0, heldAt.getTime() - born),
        heldAt: heldAt.toISOString(),
      };
    }),
    last: entry
      ? {
          entryId: String(entry.id),
          summary: entry.summary,
          createdAt: new Date(entry.createdAt).toISOString(),
          banned: entry.action === 'automod.gate.banall',
        }
      : null,
    now: new Date(now).toISOString(),
  };
}

export interface PhishingListView {
  domains: number;
  updatedAt: string;
  now: string;
}

export async function phishingList(): Promise<PhishingListView | null> {
  const latest = await new PhishingStore(db().sql).latest();
  if (!latest) return null;
  return {
    domains: latest.domains,
    updatedAt: new Date(latest.fetchedAt).toISOString(),
    now: new Date().toISOString(),
  };
}

export async function weeklyHits(guildId: string): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const rows = await new AutomodStore(db().sql).hitCounts(guildId, since);
  return Object.fromEntries(rows.map((row) => [row.rule, row.hits]));
}
