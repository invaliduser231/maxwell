'use server';

import { enqueue } from '@maxwell/core';
import { fixPlan, fixSummary, securityHealth } from '@maxwell/core/modules/security-check';
import { revalidatePath, updateTag } from 'next/cache';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor } from '@/lib/guard';
import { publicTag } from '@/lib/public-page';
import { fixModules, keysFor, needsAdmin, parseFixTarget, selectFixes } from '@/lib/security-check';
import { loadHealthInput } from './data';

export async function fixSecurity(
  guildId: string,
  target: unknown,
): Promise<Result<{ fixed: number; queued: number }>> {
  const check = await editor(guildId, 'security');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = parseFixTarget(target);
  if (!parsed) return { ok: false, error: 'Unknown fix.' };
  const input = await loadHealthInput(guildId);
  const picked = selectFixes(securityHealth(input).findings, parsed);
  const plan = fixPlan(input, picked);
  if (plan.keys.length === 0) return { ok: false, error: 'Nothing to fix.' };
  if (needsAdmin(plan) && !check.access.admin)
    return { ok: false, error: 'Only admins can do that.' };
  for (const module of fixModules(plan)) {
    if (module === 'security') continue;
    const allowed = await editor(guildId, module);
    if ('error' in allowed) return { ok: false, error: allowed.error };
  }

  const { modules, sql } = db();
  const actor = { id: check.access.user.id };
  for (const module of plan.enable) await modules.setEnabled(guildId, module, true, actor);
  const patches = [
    ['security', plan.security],
    ['automod', plan.automod],
    ['moderation', plan.moderation],
  ] as const;
  for (const [module, patch] of patches) {
    if (!patch) continue;
    await modules.update(
      guildId,
      module,
      patch as Record<string, unknown>,
      actor,
      fixSummary(keysFor(plan, module)),
    );
  }
  for (const role of plan.roles) {
    await enqueue(sql, {
      kind: 'security-check.role',
      guildId,
      payload: { roleId: role.roleId, permissions: role.permissions, by: actor.id },
    });
  }
  if (plan.enable.length > 0 || patches.some(([, patch]) => patch)) updateTag(publicTag(guildId));
  revalidatePath(`/g/${guildId}`, 'layout');
  return { ok: true, data: { fixed: plan.keys.length, queued: plan.roles.length } };
}
