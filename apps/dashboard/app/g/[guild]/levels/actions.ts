'use server';

import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';

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
