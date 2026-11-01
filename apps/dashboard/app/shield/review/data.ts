import 'server-only';
import type { ShieldSource } from '@maxwell/core/modules/security';
import type { DisputeStatus } from '@maxwell/core/stores/shield-disputes';
import { ShieldDisputeStore } from '@maxwell/core/stores/shield-disputes';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/access';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { botGuild, type FluxerUser, userProfile } from '@/lib/fluxer';
import { getSession } from '@/lib/session';

export interface PersonView {
  id: string;
  name: string | null;
}

export interface RecordView {
  guildId: string;
  guildName: string | null;
  source: ShieldSource;
  reportedBy: PersonView | null;
  createdAt: string;
  expiresAt: string;
}

export interface OpenDisputeView {
  id: string;
  user: PersonView;
  body: string;
  createdAt: string;
  records: RecordView[];
}

export interface DecisionView {
  id: string;
  user: PersonView;
  action: Exclude<DisputeStatus, 'open'>;
  operator: PersonView;
  note: string | null;
  records: number;
  createdAt: string;
}

export function isOperator(userId: string): boolean {
  return env().OWNER_IDS.includes(userId);
}

export async function requireOperator(): Promise<FluxerUser> {
  const user = await requireUser('/shield/review');
  if (!isOperator(user.id)) notFound();
  return user;
}

export async function operatorSession(): Promise<FluxerUser | null> {
  const session = await getSession();
  if (!session || !isOperator(session.user.id)) return null;
  return session.user;
}

function lookup<T>(load: (id: string) => Promise<T | null>) {
  const seen = new Map<string, Promise<T | null>>();
  return (id: string) => {
    let found = seen.get(id);
    if (!found) {
      found = load(id).catch(() => null);
      seen.set(id, found);
    }
    return found;
  };
}

export async function reviewData(): Promise<{
  open: OpenDisputeView[];
  decisions: DecisionView[];
}> {
  const store = new ShieldDisputeStore(db().sql);
  const [open, decisions] = await Promise.all([store.open(), store.decisions(50)]);
  const person = lookup(userProfile);
  const guild = lookup(botGuild);
  const named = async (id: string): Promise<PersonView> => ({
    id,
    name: (await person(id))?.displayName ?? null,
  });

  const openViews = await Promise.all(
    open.map(async (dispute) => {
      const records = await store.records(dispute.userId);
      return {
        id: dispute.id,
        user: await named(dispute.userId),
        body: dispute.body,
        createdAt: dispute.createdAt.toISOString(),
        records: await Promise.all(
          records.map(async (record) => ({
            guildId: record.guildId,
            guildName: (await guild(record.guildId))?.name ?? null,
            source: record.source,
            reportedBy: record.reportedBy ? await named(record.reportedBy) : null,
            createdAt: record.createdAt.toISOString(),
            expiresAt: record.expiresAt.toISOString(),
          })),
        ),
      };
    }),
  );

  const decisionViews = await Promise.all(
    decisions.map(async (decision) => ({
      id: decision.id,
      user: await named(decision.userId),
      action: decision.action,
      operator: await named(decision.operatorId),
      note: decision.note,
      records: decision.records.length,
      createdAt: decision.createdAt.toISOString(),
    })),
  );

  return { open: openViews, decisions: decisionViews };
}
