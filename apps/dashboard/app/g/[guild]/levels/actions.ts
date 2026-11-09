'use server';

import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { editor } from '@/lib/guard';

const snowflake = z.string().regex(/^\d{15,21}$/);

const entry = z.union([
  z.object({ id: snowflake, xp: z.number().int().min(0).max(1_000_000_000_000) }),
  z.object({ id: snowflake, level: z.number().int().min(0).max(1000) }),
]);

const batch = z.object({
  entries: z.array(entry).min(1).max(20_000),
  mode: z.enum(['replace', 'add', 'max']),
});

export async function importLevels(
  guildId: string,
  entries: unknown,
  mode: 'replace' | 'add' | 'max',
): Promise<Result> {
  const parsed = batch.safeParse({ entries, mode });
  if (!parsed.success) return { ok: false, error: 'That file has rows I cannot read.' };
  return runAction(guildId, 'levels', 'import', {
    entries: parsed.data.entries,
    mode: parsed.data.mode,
  });
}

const PLUUTY = 'https://api.pluuty.com/api/leaderboard';
const PLUUTY_PAGE = 100;
const PLUUTY_PAGES = 200;

const pluutyPage = z.object({
  total: z.number().int().min(0),
  entries: z.array(
    z.object({
      userId: snowflake,
      xp: z.number().min(0),
      level: z.number().int().min(0),
    }),
  ),
});

type PluutyEntry = z.output<typeof pluutyPage>['entries'][number];

async function pluutyLeaderboard(guildId: string): Promise<PluutyEntry[] | 'missing' | 'failed'> {
  const entries: PluutyEntry[] = [];
  for (let page = 0; page < PLUUTY_PAGES; page++) {
    const offset = page * PLUUTY_PAGE;
    let response: Response;
    try {
      response = await fetch(
        `${PLUUTY}/${guildId}?type=xp&period=all&limit=${PLUUTY_PAGE}&offset=${offset}`,
        {
          headers: { accept: 'application/json', 'user-agent': 'Maxwell (maxwellbot.app)' },
          signal: AbortSignal.timeout(10_000),
          cache: 'no-store',
        },
      );
    } catch {
      return 'failed';
    }
    if (response.status === 403 || response.status === 404) return 'missing';
    if (!response.ok) return 'failed';
    const parsed = pluutyPage.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return 'failed';
    entries.push(...parsed.data.entries);
    if (parsed.data.entries.length < PLUUTY_PAGE || entries.length >= parsed.data.total) break;
  }
  return entries;
}

export async function importFromPluuty(
  guildId: string,
  mode: 'replace' | 'add' | 'max',
  keep: 'level' | 'xp',
): Promise<Result<{ count: number }>> {
  if (!snowflake.safeParse(guildId).success) return { ok: false, error: 'Unknown community.' };
  const check = await editor(guildId, 'levels');
  if ('error' in check) return { ok: false, error: check.error };
  const board = await pluutyLeaderboard(guildId);
  if (board === 'missing') {
    return {
      ok: false,
      error:
        'Pluuty shows no leaderboard for this community. Turn on its public leaderboard and try again.',
    };
  }
  if (board === 'failed') return { ok: false, error: 'Pluuty did not answer. Try again later.' };
  const seen = new Map<string, z.input<typeof entry>>();
  for (const row of board) {
    seen.set(
      row.userId,
      keep === 'level'
        ? { id: row.userId, level: Math.min(row.level, 1000) }
        : { id: row.userId, xp: Math.min(Math.floor(row.xp), 1_000_000_000_000) },
    );
  }
  if (seen.size === 0) return { ok: false, error: 'Pluuty has no levels for this community yet.' };
  const result = await importLevels(guildId, [...seen.values()], mode);
  return result.ok ? { ok: true, data: { count: seen.size } } : result;
}
