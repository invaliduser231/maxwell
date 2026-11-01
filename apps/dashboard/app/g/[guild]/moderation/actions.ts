'use server';

import { generalConfig } from '@maxwell/core';
import { MASS_BAN_MAX, moderationConfig, parseMemberIds } from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type Result, runAction, saveModule } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor, viewer } from '@/lib/guard';
import { people } from '@/lib/people';
import { type CaseView, caseDetail } from './data';

const MODULE = 'moderation';
const caseNumber = z.number().int().positive().max(2_147_483_647);

async function done(guildId: string, number: number): Promise<Result<CaseView>> {
  await runAction(guildId, MODULE, 'sync', { number });
  revalidatePath(`/g/${guildId}/moderation`);
  const view = await caseDetail(guildId, number);
  return view ? { ok: true, data: view } : { ok: false, error: 'That case is gone.' };
}

export async function loadCase(guildId: string, number: number): Promise<Result<CaseView>> {
  const check = await viewer(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!caseNumber.safeParse(number).success) return { ok: false, error: 'Unknown case.' };
  const view = await caseDetail(guildId, number);
  return view ? { ok: true, data: view } : { ok: false, error: 'That case is gone.' };
}

export async function saveReason(
  guildId: string,
  number: number,
  reason: string,
): Promise<Result<CaseView>> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!caseNumber.safeParse(number).success) return { ok: false, error: 'Unknown case.' };
  const text = reason.trim().slice(0, 1_500) || null;
  const userId = check.access.user.id;
  const changed = await new ModerationStore(db().sql).setReason(guildId, number, text, userId);
  if (!changed) return { ok: false, error: 'That case is gone.' };
  await db().audit.record({
    guildId,
    actor: { id: userId },
    module: MODULE,
    action: 'case.reason',
    summary: `Changed the reason of case #${number}`,
    before: { reason: changed.before },
    after: { reason: text },
    undo: {
      kind: 'moderation.reason',
      payload: { number, reason: changed.before, unclaim: changed.claimed },
    },
  });
  return done(guildId, number);
}

const link = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => /^https?:\/\//i.test(value));

export async function addEvidence(
  guildId: string,
  number: number,
  url: string,
): Promise<Result<CaseView>> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!caseNumber.safeParse(number).success) return { ok: false, error: 'Unknown case.' };
  const parsed = link.safeParse(url);
  if (!parsed.success) return { ok: false, error: 'Use a full link starting with https://.' };
  const added = await new ModerationStore(db().sql).addEvidence(guildId, number, parsed.data);
  if (!added) return { ok: false, error: 'That link is already there, or the case is full.' };
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: MODULE,
    action: 'case.evidence',
    summary: `Added evidence to case #${number}`,
    after: { case: number, url: parsed.data },
    undo: null,
  });
  return done(guildId, number);
}

export async function removeEvidence(
  guildId: string,
  number: number,
  url: string,
): Promise<Result<CaseView>> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!caseNumber.safeParse(number).success) return { ok: false, error: 'Unknown case.' };
  const removed = await new ModerationStore(db().sql).removeEvidence(guildId, number, url);
  if (!removed) return { ok: false, error: 'That link is already gone.' };
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: MODULE,
    action: 'case.evidence',
    summary: `Removed evidence from case #${number}`,
    before: { case: number, url },
    undo: null,
  });
  return done(guildId, number);
}

export async function voidCase(guildId: string, number: number): Promise<Result<CaseView>> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!caseNumber.safeParse(number).success) return { ok: false, error: 'Unknown case.' };
  const userId = check.access.user.id;
  const voided = await new ModerationStore(db().sql).voidCase(guildId, number, userId, null);
  if (!voided) return { ok: false, error: 'That case is already void.' };
  await db().audit.record({
    guildId,
    actor: { id: userId },
    module: MODULE,
    action: 'case.void',
    summary: `Voided case #${number}`,
    after: { case: number, reason: null },
    undo: { kind: 'moderation.void', payload: { numbers: [number] } },
  });
  return done(guildId, number);
}

export async function reviewCase(
  guildId: string,
  number: number,
  approve: boolean,
): Promise<Result> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!caseNumber.safeParse(number).success) return { ok: false, error: 'Unknown case.' };
  return runAction(guildId, MODULE, 'review', {
    number,
    approve,
    moderatorId: check.access.user.id,
  });
}

export interface MassBanEntry {
  id: string;
  name: string;
  avatar: string | null;
  known: boolean;
}

export interface MassBanPreview {
  members: MassBanEntry[];
  invalid: string[];
}

export async function previewMassBan(
  guildId: string,
  text: string,
): Promise<Result<MassBanPreview>> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  const { ids, invalid } = parseMemberIds(text.slice(0, 20_000));
  if (ids.length === 0) return { ok: false, error: 'Paste at least one member ID.' };
  if (ids.length > MASS_BAN_MAX) return { ok: false, error: 'Up to 200 members at once.' };
  const found = await people(ids, MASS_BAN_MAX);
  const members = ids.map((id) => {
    const person = found.get(id);
    return {
      id,
      name: person?.name ?? id,
      avatar: person?.avatar ?? null,
      known: person?.known ?? false,
    };
  });
  return { ok: true, data: { members, invalid: invalid.slice(0, 20) } };
}

const massBanInput = z.object({
  userIds: z
    .array(z.string().regex(/^\d{15,21}$/))
    .min(1)
    .max(MASS_BAN_MAX),
  reason: z.string().trim().max(1_500),
  deleteMessages: z.boolean().default(false),
  shield: z.boolean().default(false),
});

export async function massBan(
  guildId: string,
  input: z.input<typeof massBanInput>,
): Promise<Result> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = massBanInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the list first.' };
  const { reason, deleteMessages, shield } = parsed.data;
  const self = check.access.user.id;
  const userIds = [...new Set(parsed.data.userIds)].filter((id) => id !== self);
  if (userIds.length === 0) return { ok: false, error: 'That is you.' };
  const config = await db().modules.get(guildId, MODULE, moderationConfig);
  if (config.requireReason && !reason) return { ok: false, error: 'Add a reason.' };
  const result = await runAction(guildId, MODULE, 'massban', {
    userIds,
    moderatorId: self,
    reason: reason || null,
    deleteMessages,
    shield: shield && (await new ShieldStore(db().sql).participates(guildId)),
  });
  if (result.ok) revalidatePath(`/g/${guildId}/moderation`);
  return result;
}

export async function setCommand(guildId: string, name: string, on: boolean): Promise<Result> {
  const check = await editor(guildId, 'general');
  if ('error' in check) return { ok: false, error: check.error };
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) return { ok: false, error: 'Unknown command.' };
  const general = await db().modules.get(guildId, 'general', generalConfig);
  const rest = general.disabledCommands.filter((entry) => entry !== name);
  const next = { ...general, disabledCommands: on ? rest : [...rest, name] };
  const saved = await saveModule(
    guildId,
    'general',
    next,
    on ? `Turned ${name} on` : `Turned ${name} off`,
  );
  if (!saved.ok) return saved;
  revalidatePath(`/g/${guildId}/moderation`);
  return { ok: true };
}
