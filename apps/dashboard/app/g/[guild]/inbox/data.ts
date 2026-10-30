import 'server-only';
import type { InboxKind, InboxStatus } from '@maxwell/core/modules/moderation';
import { type InboxItem, InboxStore } from '@maxwell/core/stores/inbox';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { SecurityStore } from '@maxwell/core/stores/security';
import { db } from '@/lib/db';
import { type Person, people, personOf } from '@/lib/people';
import type { CheckRow } from '../security/data';

export type InboxView = 'active' | 'mine' | 'closed';

export interface InboxPerson {
  id: string;
  name: string;
  avatar: string | null;
}

export interface InboxRow {
  number: number;
  kind: InboxKind;
  status: InboxStatus;
  subject: InboxPerson | null;
  reporterCount: number;
  preview: string | null;
  assignee: InboxPerson | null;
  createdAt: string;
}

export interface InboxCase {
  number: number;
  action: string;
  reason: string | null;
  voided: boolean;
  createdAt: string;
}

export interface InboxDetail extends InboxRow {
  body: string | null;
  excerpt: string | null;
  messageUrl: string | null;
  reporters: InboxPerson[];
  caseNumber: number | null;
  suggested: string | null;
  outcome: string | null;
  outcomeCase: number | null;
  note: string | null;
  resolvedBy: InboxPerson | null;
  resolvedAt: string | null;
  cases: InboxCase[];
  held: number | null;
  check: { state: string | null; score: number; reasons: CheckRow['reasons'] } | null;
}

const PREVIEW = 120;

function webUrl(): string {
  return (process.env.FLUXER_WEB_URL ?? 'https://fluxer.app').replace(/\/+$/, '');
}

function view(known: ReadonlyMap<string, Person>, id: string | null): InboxPerson | null {
  if (!id) return null;
  const person = personOf(known, id);
  return { id, name: person.name, avatar: person.avatar };
}

function preview(item: InboxItem): string | null {
  if (item.kind === 'gate' || item.kind === 'check') return null;
  const text = (item.excerpt ?? item.body ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1).trimEnd()}…` : text;
}

function row(known: ReadonlyMap<string, Person>, item: InboxItem): InboxRow {
  return {
    number: item.number,
    kind: item.kind,
    status: item.status,
    subject: view(known, item.subjectId),
    reporterCount: item.reporters.length,
    preview: preview(item),
    assignee: view(known, item.assigneeId),
    createdAt: item.createdAt.toISOString(),
  };
}

export async function listInbox(
  guildId: string,
  mode: InboxView,
  kind: InboxKind | null,
  self: string,
): Promise<InboxRow[]> {
  const items = await new InboxStore(db().sql).list(guildId, {
    status: mode === 'closed' ? 'closed' : mode === 'mine' ? 'claimed' : 'active',
    assigneeId: mode === 'mine' ? self : undefined,
    kind: kind ?? undefined,
    limit: 100,
  });
  const known = await people(items.flatMap((item) => [item.subjectId, item.assigneeId]));
  return items.map((item) => row(known, item));
}

export async function inboxDetail(guildId: string, number: number): Promise<InboxDetail | null> {
  const item = await new InboxStore(db().sql).get(guildId, number);
  if (!item) return null;
  const moderation = new ModerationStore(db().sql);
  const [cases, flag] = await Promise.all([
    item.subjectId ? moderation.list(guildId, { userId: item.subjectId, limit: 6 }) : [],
    item.kind === 'review' && item.caseNumber !== null
      ? moderation.get(guildId, item.caseNumber)
      : null,
  ]);
  const known = await people([item.subjectId, item.assigneeId, item.resolvedBy, ...item.reporters]);
  const suggested = typeof flag?.meta.suggested === 'string' ? flag.meta.suggested : null;
  const check =
    item.kind === 'check' && item.refId
      ? await new SecurityStore(db().sql).check(guildId, item.refId).catch(() => null)
      : null;
  const held = item.kind === 'gate' ? Number(item.body) : Number.NaN;
  return {
    ...row(known, item),
    body: item.kind === 'gate' || item.kind === 'check' ? null : item.body,
    excerpt: item.excerpt,
    messageUrl:
      item.channelId && item.messageId
        ? `${webUrl()}/channels/${guildId}/${item.channelId}/${item.messageId}`
        : null,
    reporters: item.reporters.flatMap((id) => view(known, id) ?? []),
    caseNumber: item.caseNumber,
    suggested,
    outcome: item.outcome,
    outcomeCase: item.outcomeCase,
    note: item.note,
    resolvedBy: view(known, item.resolvedBy),
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    cases: cases
      .filter((entry) => entry.number !== item.caseNumber)
      .slice(0, 5)
      .map((entry) => ({
        number: entry.number,
        action: entry.action,
        reason: entry.reason,
        voided: entry.voidedAt !== null,
        createdAt: entry.createdAt.toISOString(),
      })),
    held: Number.isFinite(held) ? held : null,
    check:
      item.kind === 'check'
        ? {
            state: item.body,
            score: check?.score ?? 0,
            reasons: (check?.reasons ?? []) as CheckRow['reasons'],
          }
        : null,
  };
}

export async function inboxCounts(guildId: string, self: string) {
  return new InboxStore(db().sql).counts(guildId, self);
}
