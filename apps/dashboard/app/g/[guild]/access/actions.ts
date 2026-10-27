'use server';

import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { guildMember, memberSearch, userProfile } from '@/lib/fluxer';
import { admin } from '@/lib/guard';
import { getT } from '@/lib/i18n/server';
import { people } from '@/lib/people';

export interface FoundPerson {
  id: string;
  name: string;
  avatar: string | null;
}

const idSchema = z
  .string()
  .trim()
  .regex(/^\d{15,21}$/);

export async function findMember(guildId: string, userId: string): Promise<Result<FoundPerson>> {
  const check = await admin(guildId);
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = idSchema.safeParse(userId);
  if (!parsed.success) return { ok: false, error: 'That is not a user ID.' };
  const member = await guildMember(guildId, parsed.data).catch(() => null);
  if (!member) return { ok: false, error: 'Nobody with that ID is in this community.' };
  const profile = await userProfile(parsed.data).catch(() => null);
  if (profile?.bot) return { ok: false, error: 'Bots cannot use the dashboard.' };
  return {
    ok: true,
    data: {
      id: parsed.data,
      name: member.nick ?? profile?.displayName ?? (await getT())('Unknown member'),
      avatar: profile?.avatarUrl ?? null,
    },
  };
}

export async function searchMembers(
  guildId: string,
  query: string,
): Promise<Result<FoundPerson[]>> {
  const check = await admin(guildId);
  if ('error' in check) return { ok: false, error: check.error };
  const text = typeof query === 'string' ? query.trim().slice(0, 64) : '';
  if (text.length < 2) return { ok: true, data: [] };
  if (idSchema.safeParse(text).success) {
    const found = await findMember(guildId, text);
    return found.ok ? { ok: true, data: found.data ? [found.data] : [] } : found;
  }
  const hits = await memberSearch(guildId, text, 8).catch(() => null);
  if (hits === null) return { ok: false, error: 'Search is not available right now.' };
  const found = await people(
    hits.map((hit) => hit.userId),
    8,
  );
  return {
    ok: true,
    data: [...found.values()]
      .filter((person) => person.known && !person.bot)
      .map((person) => ({ id: person.id, name: person.name, avatar: person.avatar })),
  };
}
