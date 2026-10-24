import 'server-only';
import { FormStore, type FormSubmission, type FormVote } from '@maxwell/core/stores/forms';
import { levelOf } from '@maxwell/core/stores/levels';
import { db } from '@/lib/db';
import { guildMember } from '@/lib/fluxer';
import { type Names, namesOf } from '@/lib/people';

export const PAGE = 30;

export interface SubmissionView {
  id: string;
  number: number;
  formId: string;
  formName: string;
  userId: string;
  status: FormSubmission['status'];
  answers: { questionId: string; label: string; display: string }[];
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applied: FormSubmission['applied'];
  votes: { userId: string; vote: FormVote }[];
  level: number | null;
  present: boolean | null;
}

async function extras(
  guildId: string,
  rows: readonly FormSubmission[],
): Promise<Map<string, { level: number | null; present: boolean | null }>> {
  const pending = [
    ...new Set(rows.filter((row) => row.status === 'pending').map((row) => row.userId)),
  ].slice(0, 30);
  const found = await Promise.all(
    pending.map(async (userId) => {
      const [level, member] = await Promise.all([
        levelOf(db().sql, guildId, userId).catch(() => null),
        guildMember(guildId, userId).catch(() => undefined),
      ]);
      return [userId, { level, present: member === undefined ? null : member !== null }] as const;
    }),
  );
  return new Map(found);
}

export async function toViews(
  guildId: string,
  rows: readonly FormSubmission[],
): Promise<{ items: SubmissionView[]; names: Names }> {
  const store = new FormStore(db().sql);
  const [votes, more] = await Promise.all([
    store.votesFor(rows.map((row) => row.id)),
    extras(guildId, rows),
  ]);
  const items = rows.map((row) => ({
    id: row.id,
    number: row.number,
    formId: row.formId,
    formName: row.formName,
    userId: row.userId,
    status: row.status,
    answers: row.answers.map((answer) => ({
      questionId: answer.questionId,
      label: answer.label,
      display: answer.display,
    })),
    createdAt: row.createdAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    note: row.note,
    applied: row.applied,
    votes: votes.get(row.id) ?? [],
    level: more.get(row.userId)?.level ?? null,
    present: more.get(row.userId)?.present ?? null,
  }));
  const names = await namesOf(
    items.flatMap((item) => [
      item.userId,
      item.decidedBy,
      ...item.votes.map((vote) => vote.userId),
    ]),
    120,
  );
  return { items, names };
}

export async function loadSubmissions(
  guildId: string,
  options: { formId?: string; decided: boolean; before?: string },
): Promise<{ items: SubmissionView[]; names: Names; more: boolean }> {
  const store = new FormStore(db().sql);
  const rows = await store.list(guildId, {
    formId: options.formId,
    status: options.decided ? undefined : 'pending',
    decided: options.decided,
    before: options.before,
    limit: PAGE + 1,
  });
  const { items, names } = await toViews(guildId, rows.slice(0, PAGE));
  return { items, names, more: rows.length > PAGE };
}
