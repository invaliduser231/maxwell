'use server';

import { commandsConfig } from '@maxwell/core/modules/commands';
import { CommandStore, type CommandTestResult } from '@maxwell/core/stores/commands';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor, viewer } from '@/lib/guard';

export async function forgetDeleted(guildId: string): Promise<Result> {
  const check = await editor(guildId, 'commands');
  if ('error' in check) return { ok: false, error: check.error };
  const { sql, modules } = db();
  const config = await modules.get(guildId, 'commands', commandsConfig);
  await new CommandStore(sql).forget(
    guildId,
    config.commands.map((command) => command.id),
  );
  return { ok: true };
}

export async function testResult(
  guildId: string,
  requestId: string,
): Promise<Result<CommandTestResult | null>> {
  const check = await viewer(guildId, 'commands');
  if ('error' in check) return { ok: false, error: check.error };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) return { ok: false, error: 'Unknown test.' };
  const result = await new CommandStore(db().sql).test(guildId, requestId);
  return { ok: true, data: result };
}
