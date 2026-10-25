import 'server-only';
import { canUndo } from '@maxwell/core';
import type { CaseAction } from '@maxwell/core/modules/moderation';
import { type CaseRow, ModerationStore } from '@maxwell/core/stores/moderation';
import { db } from '@/lib/db';
import { type Person, people, personOf } from '@/lib/people';

export interface CaseView {
  number: number;
  action: CaseAction;
  userId: string | null;
  member: string;
  memberAvatar: string | null;
  moderatorId: string | null;
  moderator: string;
  reason: string | null;
  durationSeconds: number | null;
  expiresAt: string | null;
  endedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  evidence: string[];
  excerpt: string | null;
  createdAt: string;
  source: string | null;
  auditId: string | null;
  undo: 'available' | 'done' | 'none';
}

export function moderatorName(row: CaseRow, names: Map<string, Person>): string {
  if (row.moderatorId) return personOf(names, row.moderatorId).name;
  if (row.meta.source === 'automod') return 'AutoMod';
  if (row.meta.source === 'security') return 'Security';
  if (row.meta.external === true) return 'Unknown';
  return 'Maxwell';
}

export function toView(row: CaseRow, names: Map<string, Person>): CaseView {
  const member = row.userId ? personOf(names, row.userId) : null;
  return {
    number: row.number,
    action: row.action,
    userId: row.userId,
    member: member?.name ?? 'Unknown member',
    memberAvatar: member?.avatar ?? null,
    moderatorId: row.moderatorId,
    moderator: moderatorName(row, names),
    reason: row.reason,
    durationSeconds: row.durationSeconds,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
    voidedAt: row.voidedAt ? new Date(row.voidedAt).toISOString() : null,
    voidReason: row.voidReason,
    evidence: row.evidence ?? [],
    excerpt: row.excerpt,
    createdAt: new Date(row.createdAt).toISOString(),
    source: typeof row.meta.source === 'string' ? row.meta.source : null,
    auditId: typeof row.meta.auditId === 'string' ? row.meta.auditId : null,
    undo: 'none',
  };
}

export async function withUndo(guildId: string, view: CaseView): Promise<CaseView> {
  if (!view.auditId || !/^\d{1,20}$/.test(view.auditId)) return view;
  const entry = await db().audit.get(guildId, view.auditId);
  if (!entry?.undo) return view;
  if (entry.undoneAt) return { ...view, undo: 'done' };
  return { ...view, undo: canUndo(entry) ? 'available' : 'none' };
}

export async function caseDetail(guildId: string, number: number): Promise<CaseView | null> {
  const row = await new ModerationStore(db().sql).get(guildId, number);
  if (!row) return null;
  const names = await people([row.userId, row.moderatorId]);
  return withUndo(guildId, toView(row, names));
}
