'use server';

import { type AutomodRuleKey, automodRuleSchemas } from '@maxwell/core/modules/automod';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { type Result, runAction } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor, viewer } from '@/lib/guard';
import { type DryRunView, dryRunView, type GateView, gateView } from './data';

function isRuleKey(key: string): key is AutomodRuleKey {
  return Object.hasOwn(automodRuleSchemas, key);
}

export async function startDryRun(
  guildId: string,
  ruleKey: string,
  rule: unknown,
): Promise<Result<{ id: string }>> {
  const check = await editor(guildId, 'automod');
  if ('error' in check) return { ok: false, error: check.error };
  if (!isRuleKey(ruleKey)) return { ok: false, error: 'Unknown rule.' };
  const parsed = automodRuleSchemas[ruleKey].safeParse(rule);
  if (!parsed.success) return { ok: false, error: 'Check the rule settings first.' };
  const id = await new AutomodStore(db().sql).createDryRun(
    guildId,
    ruleKey,
    parsed.data as Record<string, unknown>,
    check.access.user.id,
  );
  if (!id) return { ok: false, error: 'That did not work. Try again.' };
  const queued = await runAction(guildId, 'automod', 'dryrun', { runId: id });
  if (!queued.ok) return queued;
  return { ok: true, data: { id: String(id) } };
}

export async function dryRunResult(guildId: string, id: string): Promise<Result<DryRunView>> {
  const check = await viewer(guildId, 'automod');
  if ('error' in check) return { ok: false, error: check.error };
  if (!/^\d{1,20}$/.test(id)) return { ok: false, error: 'Unknown dry run.' };
  const run = await new AutomodStore(db().sql).getDryRun(guildId, id);
  if (!run) return { ok: false, error: 'That dry run is gone.' };
  return { ok: true, data: await dryRunView(run) };
}

export async function gateStatus(guildId: string): Promise<Result<GateView>> {
  const check = await viewer(guildId, 'automod');
  if ('error' in check) return { ok: false, error: check.error };
  return { ok: true, data: await gateView(guildId) };
}

export async function gateRole(guildId: string): Promise<Result<{ roleId: string | null }>> {
  const check = await viewer(guildId, 'automod');
  if ('error' in check) return { ok: false, error: check.error };
  const state = await db().modules.state(guildId, 'automod');
  const raid = (state.config as { raid?: { gateRoleId?: unknown } }).raid;
  const roleId = typeof raid?.gateRoleId === 'string' ? raid.gateRoleId : null;
  return { ok: true, data: { roleId } };
}
