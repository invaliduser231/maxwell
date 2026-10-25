'use server';

import { InviteStatsStore } from '@maxwell/core/stores/invites';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { viewer } from '@/lib/guard';
import { type Person, people, personOf } from '@/lib/people';

export interface RecentJoin {
  person: Person;
  joinedAt: string;
  leftAt: string | null;
  fake: boolean;
}

export async function loadJoins(guildId: string, code: string): Promise<Result<RecentJoin[]>> {
  const check = await viewer(guildId, 'invites');
  if ('error' in check) return { ok: false, error: check.error };
  if (typeof code !== 'string' || code.length === 0 || code.length > 64) {
    return { ok: false, error: 'Unknown invite.' };
  }
  const joins = await new InviteStatsStore(db().sql).recent(guildId, code, 6);
  const known = await people(joins.map((join) => join.userId));
  return {
    ok: true,
    data: joins.map((join) => ({
      person: personOf(known, join.userId),
      joinedAt: join.joinedAt.toISOString(),
      leftAt: join.leftAt?.toISOString() ?? null,
      fake: join.fake,
    })),
  };
}
