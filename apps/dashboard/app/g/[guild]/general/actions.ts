'use server';

import { catalog } from '@maxwell/core';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { FluxerError, leaveGuild, updateBotProfile } from '@/lib/fluxer';
import { admin, editor } from '@/lib/guard';
import { publicTag } from '@/lib/public-page';

const prefixSchema = z.string().trim().min(1).max(8).regex(/^\S+$/, 'No spaces in the prefix.');

export async function savePrefix(guildId: string, prefix: string): Promise<Result> {
  const check = await editor(guildId, 'general');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = prefixSchema.safeParse(prefix);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid prefix.' };
  const { guilds, audit } = db();
  const before = await guilds.prefix(guildId);
  if (before === parsed.data) return { ok: true };
  await guilds.setPrefix(guildId, parsed.data);
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'general',
    action: 'prefix.update',
    summary: `Changed the prefix to ${parsed.data}`,
    before: { prefix: before },
    after: { prefix: parsed.data },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/general`);
  return { ok: true };
}

const profileSchema = z.object({
  nick: z.string().trim().max(32).nullable(),
  bio: z.string().trim().max(320).nullable(),
});

function profileError(error: unknown): string {
  if (error instanceof FluxerError && error.status === 429) {
    return 'Fluxer allows only a few profile changes per half hour. Try again later.';
  }
  return 'Fluxer did not accept that.';
}

export async function saveProfile(
  guildId: string,
  profile: { nick: string | null; bio: string | null },
): Promise<Result> {
  const check = await editor(guildId, 'general');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = profileSchema.safeParse(profile);
  if (!parsed.success) return { ok: false, error: 'Nickname or bio is too long.' };
  try {
    await updateBotProfile(
      guildId,
      { nick: parsed.data.nick || null, bio: parsed.data.bio || null },
      `Changed in the dashboard by ${check.access.user.username}`,
    );
  } catch (error) {
    return { ok: false, error: profileError(error) };
  }
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'general',
    action: 'profile.update',
    summary: 'Changed Maxwell profile',
    after: parsed.data,
    undo: null,
  });
  return { ok: true };
}

const IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR = 1_000_000;

export async function saveAvatar(guildId: string, dataUrl: string | null): Promise<Result> {
  const check = await editor(guildId, 'general');
  if ('error' in check) return { ok: false, error: check.error };
  if (dataUrl !== null && (!IMAGE.test(dataUrl) || dataUrl.length > MAX_AVATAR * 1.4)) {
    return { ok: false, error: 'Use a PNG, JPEG, GIF or WebP under 1 MB.' };
  }
  try {
    await updateBotProfile(
      guildId,
      { avatar: dataUrl },
      `Changed in the dashboard by ${check.access.user.username}`,
    );
  } catch (error) {
    return { ok: false, error: profileError(error) };
  }
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'general',
    action: 'profile.avatar',
    summary: dataUrl ? 'Changed Maxwell avatar' : 'Reset Maxwell avatar',
    undo: null,
  });
  revalidatePath(`/g/${guildId}/general`);
  return { ok: true };
}

export async function resetSettings(guildId: string): Promise<Result> {
  const check = await admin(guildId);
  if ('error' in check) return { ok: false, error: check.error };
  const { modules, audit } = db();
  for (const definition of catalog) {
    const state = await modules.state(guildId, definition.key);
    if (Object.keys(state.config).length === 0) continue;
    await modules.replace(guildId, definition.key, {});
    await audit.record({
      guildId,
      actor: { id: check.access.user.id },
      module: definition.key,
      action: 'config.reset',
      summary: `Reset ${definition.name} settings`,
      before: state.config,
      after: {},
      undo: { kind: 'module.config', payload: { module: definition.key, config: state.config } },
    });
  }
  updateTag(publicTag(guildId));
  revalidatePath(`/g/${guildId}`, 'layout');
  return { ok: true };
}

export async function removeMaxwell(guildId: string): Promise<Result> {
  const check = await admin(guildId);
  if ('error' in check) return { ok: false, error: check.error };
  try {
    await leaveGuild(guildId);
  } catch {
    return { ok: false, error: 'Fluxer did not let me leave. Try again.' };
  }
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'general',
    action: 'bot.remove',
    summary: 'Removed Maxwell',
    undo: null,
  });
  redirect('/communities');
}
