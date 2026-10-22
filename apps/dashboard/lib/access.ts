import 'server-only';
import { type AccessLevel, levelFor, moduleByKey } from '@maxwell/core';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from './db';
import { env } from './env';
import { botGuild, canManage, type FluxerUser, type GuildInfo, guildMember } from './fluxer';
import { pageByKey } from './pages';
import { getSession, sessionGuilds } from './session';

export interface GuildAccess {
  guild: GuildInfo;
  user: FluxerUser;
  admin: boolean;
  voted: boolean;
  levels: Record<string, AccessLevel>;
}

export const requireUser = cache(async (next = '/'): Promise<FluxerUser> => {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return session.user;
});

export const guildAccess = cache(async (guildId: string): Promise<GuildAccess | null> => {
  if (!/^\d{1,21}$/.test(guildId)) return null;
  const user = await requireUser(`/g/${guildId}`);
  const owner = env().OWNER_IDS.includes(user.id);
  const { access, votes } = db();
  const membershipOf = sessionGuilds().then((list) =>
    (list ?? []).find((entry) => entry.id === guildId),
  );
  const [membership, guild, voted, grantList] = await Promise.all([
    membershipOf,
    membershipOf.then((found) => (found || owner ? botGuild(guildId) : null)),
    owner ? Promise.resolve(true) : votes.hasVoted(user.id),
    access.list(guildId),
  ]);
  if (!membership && !owner) return null;
  if (!guild) return null;
  const admin = owner || (membership ? canManage(membership, user.id) : false);
  const grants = admin ? [] : grantList;
  const roles =
    admin || grants.length === 0 ? [] : ((await guildMember(guildId, user.id))?.roles ?? []);
  const levels: Record<string, AccessLevel> = {};
  for (const key of ['*', ...new Set(grants.map((grant) => grant.module))]) {
    levels[key] = admin ? 'edit' : levelFor(grants, user.id, roles, key);
  }
  return { guild, user, admin, voted, levels };
});

export function levelOf(access: GuildAccess, module: string | null): AccessLevel {
  if (access.admin) return 'edit';
  if (!module)
    return Object.values(access.levels).some((level) => level !== 'none') ? 'view' : 'none';
  const specific = access.levels[module] ?? 'none';
  const all = access.levels['*'] ?? 'none';
  return specific === 'edit' || all === 'edit'
    ? 'edit'
    : specific === 'view' || all === 'view'
      ? 'view'
      : 'none';
}

export function canSee(access: GuildAccess, pageKey: string): boolean {
  const page = pageByKey(pageKey);
  if (!page) return false;
  if (page.adminOnly) return access.admin;
  return levelOf(access, page.module) !== 'none';
}

export async function requireGuild(guildId: string): Promise<GuildAccess> {
  const access = await guildAccess(guildId);
  if (!access || levelOf(access, null) === 'none') notFound();
  return access;
}

export async function requirePage(guildId: string, pageKey: string): Promise<GuildAccess> {
  const access = await requireGuild(guildId);
  if (!canSee(access, pageKey)) notFound();
  return access;
}

export function voteBlocked(access: GuildAccess, module: string): boolean {
  return (moduleByKey(module)?.voteLocked ?? false) && !access.voted;
}
