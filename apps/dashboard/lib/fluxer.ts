import 'server-only';
import { env, oauth } from './env';
import { type BotHolder, managedRoleIds } from './managed-roles';

const MEDIA = 'https://fluxerusercontent.com';
const STATIC = 'https://fluxerstatic.com';

export const PERMISSION = {
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  ViewAuditLog: 1n << 7n,
  ManageMessages: 1n << 13n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ModerateMembers: 1n << 40n,
} as const;

const ALL_PERMISSIONS = (1n << 64n) - 1n;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface FluxerUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface UserGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  permissions: string | null;
  memberCount: number | null;
}

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
}

export interface GuildRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  permissions: string;
}

export interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number | null;
}

export interface GuildMember {
  userId: string;
  roles: string[];
  nick: string | null;
}

export class FluxerError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`fluxer ${status}`);
  }
}

function credentials(): { clientId: string; clientSecret: string } {
  const value = oauth();
  if (!value) throw new Error('FLUXER_CLIENT_ID and FLUXER_CLIENT_SECRET are not set');
  return value;
}

function api(path: string): string {
  return `${env().FLUXER_API.replace(/\/+$/, '')}${path}`;
}

async function call<T>(path: string, auth: string): Promise<T> {
  const response = await fetch(api(path), {
    headers: { authorization: auth, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new FluxerError(response.status, await response.text().catch(() => ''));
  return (await response.json()) as T;
}

export function iconUrl(
  guildId: string,
  hash: string | null | undefined,
  size = 128,
): string | null {
  if (!hash) return null;
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `${MEDIA}/icons/${guildId}/${hash}.${ext}?size=${size}`;
}

export function avatarUrl(userId: string, hash: string | null | undefined, size = 128): string {
  if (!hash) return `${STATIC}/avatars/${Number(BigInt(userId) % 6n)}.png`;
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `${MEDIA}/avatars/${userId}/${hash}.${ext}?size=${size}`;
}

export function redirectUri(): string {
  return `${env().DASHBOARD_URL.replace(/\/+$/, '')}/auth/callback`;
}

export function authorizeUrl(state: string, challenge: string): string {
  const query = new URLSearchParams({
    client_id: credentials().clientId,
    response_type: 'code',
    scope: 'identify guilds',
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return api(`/oauth2/authorize?${query}`);
}

async function tokenRequest(form: Record<string, string>): Promise<TokenPair> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(api('/oauth2/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      ...form,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new FluxerError(response.status, await response.text().catch(() => ''));
  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  };
}

export function exchangeCode(code: string, verifier: string): Promise<TokenPair> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenPair> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function revokeToken(value: string): Promise<void> {
  const { clientId, clientSecret } = credentials();
  await fetch(api('/oauth2/token/revoke'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: value,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

interface WireUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export async function currentUser(accessToken: string): Promise<FluxerUser> {
  const user = await call<WireUser>('/users/@me', `Bearer ${accessToken}`);
  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    avatarUrl: avatarUrl(user.id, user.avatar),
  };
}

interface WireGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner_id: string;
  permissions?: string;
  member_count?: number;
  approximate_member_count?: number;
}

export async function userGuilds(accessToken: string): Promise<UserGuild[]> {
  const guilds: UserGuild[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ limit: '100', with_counts: 'true' });
    if (after) query.set('after', after);
    const batch = await call<WireGuild[]>(`/users/@me/guilds?${query}`, `Bearer ${accessToken}`);
    for (const guild of batch) {
      guilds.push({
        id: guild.id,
        name: guild.name,
        iconUrl: iconUrl(guild.id, guild.icon),
        ownerId: guild.owner_id,
        permissions: guild.permissions ?? null,
        memberCount: guild.approximate_member_count ?? guild.member_count ?? null,
      });
    }
    if (batch.length < 100) break;
    after = batch.at(-1)?.id;
  }
  return guilds;
}

export function canManage(guild: UserGuild, userId: string): boolean {
  if (guild.ownerId === userId) return true;
  if (!guild.permissions) return false;
  const bits = BigInt(guild.permissions);
  return (bits & PERMISSION.Administrator) !== 0n || (bits & PERMISSION.ManageGuild) !== 0n;
}

const BOT_FRESH = 30_000;
const BOT_STALE = 10 * 60_000;
const botCache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function fetchBot<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const request = load()
    .then((value) => {
      if (botCache.size > 2_000) botCache.clear();
      botCache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = botCache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < BOT_FRESH) return hit.value as T;
  if (hit && age < BOT_STALE) {
    fetchBot<T>(key, load).catch(() => botCache.delete(key));
    return hit.value as T;
  }
  return fetchBot<T>(key, load);
}

function bot<T>(path: string): Promise<T> {
  return cached(path, () => call<T>(path, `Bot ${env().FLUXER_TOKEN}`));
}

export function forgetBotCache(guildId: string): void {
  for (const key of botCache.keys()) if (key.includes(`/guilds/${guildId}`)) botCache.delete(key);
}

export async function botGuild(guildId: string): Promise<GuildInfo | null> {
  try {
    const guild = await bot<WireGuild>(`/guilds/${guildId}`);
    return {
      id: guild.id,
      name: guild.name,
      iconUrl: iconUrl(guild.id, guild.icon),
      ownerId: guild.owner_id,
      memberCount: guild.member_count ?? guild.approximate_member_count ?? null,
    };
  } catch (error) {
    if (error instanceof FluxerError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

interface WireChannel {
  id: string;
  name?: string | null;
  type: number;
  parent_id?: string | null;
  position?: number;
}

export async function guildChannels(guildId: string): Promise<GuildChannel[]> {
  const channels = await bot<WireChannel[]>(`/guilds/${guildId}/channels`);
  return channels
    .map((channel) => ({
      id: channel.id,
      name: channel.name ?? '',
      type: channel.type,
      parentId: channel.parent_id ?? null,
      position: channel.position ?? 0,
    }))
    .sort((a, b) => a.position - b.position);
}

interface WireRole {
  id: string;
  name: string;
  color?: number;
  position?: number;
  managed?: boolean;
  permissions?: string;
}

interface WireSearchMember {
  user_id: string;
  username?: string;
  global_name?: string | null;
  role_ids?: string[];
  joined_at?: number | null;
}

interface WireSelf {
  roles?: string[];
  user?: { username?: string; global_name?: string | null };
}

async function searchMembers(
  guildId: string,
  body: Record<string, unknown>,
): Promise<WireSearchMember[]> {
  const response = await fetch(api(`/guilds/${guildId}/members-search`), {
    method: 'POST',
    headers: {
      authorization: `Bot ${env().FLUXER_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new FluxerError(response.status, await response.text().catch(() => ''));
  const result = (await response.json()) as { members?: WireSearchMember[] };
  return result.members ?? [];
}

async function botHolders(guildId: string): Promise<BotHolder[]> {
  const [self, bots] = await Promise.all([
    bot<WireSelf>(`/guilds/${guildId}/members/@me`).catch(() => null),
    cached(`/guilds/${guildId}/members-search#bots`, () =>
      searchMembers(guildId, { is_bot: true, limit: 100 }),
    ).catch(() => []),
  ]);
  const holders: BotHolder[] = bots.map((member) => ({
    username: member.username ?? '',
    globalName: member.global_name ?? null,
    roleIds: member.role_ids ?? [],
  }));
  if (self?.user) {
    holders.push({
      username: self.user.username ?? '',
      globalName: self.user.global_name ?? null,
      roleIds: self.roles ?? [],
    });
  }
  return holders;
}

export async function guildRoles(guildId: string): Promise<GuildRole[]> {
  const [roles, bots] = await Promise.all([
    bot<WireRole[]>(`/guilds/${guildId}/roles`),
    botHolders(guildId),
  ]);
  const managed = managedRoleIds(roles, bots);
  return roles
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color ?? 0,
      position: role.position ?? 0,
      managed: (role.managed ?? false) || managed.has(role.id),
      permissions: role.permissions ?? '0',
    }))
    .sort((a, b) => b.position - a.position);
}

export interface GuildEmoji {
  id: string;
  name: string;
  animated: boolean;
}

export async function guildEmojis(guildId: string): Promise<GuildEmoji[]> {
  const emojis = await bot<{ id: string; name?: string | null; animated?: boolean }[]>(
    `/guilds/${guildId}/emojis`,
  );
  return emojis
    .filter((emoji) => emoji.name)
    .map((emoji) => ({ id: emoji.id, name: emoji.name ?? '', animated: emoji.animated ?? false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function botRoleIds(guildId: string): Promise<string[] | null> {
  try {
    const member = await bot<{ roles?: string[] }>(`/guilds/${guildId}/members/@me`);
    return member.roles ?? [];
  } catch {
    return null;
  }
}

export async function botPermissions(guildId: string): Promise<bigint | null> {
  try {
    const [member, roles] = await Promise.all([
      bot<{ roles?: string[] }>(`/guilds/${guildId}/members/@me`),
      guildRoles(guildId),
    ]);
    const mine = new Set([guildId, ...(member.roles ?? [])]);
    const bits = roles
      .filter((role) => mine.has(role.id))
      .reduce((acc, role) => acc | BigInt(role.permissions), 0n);
    return (bits & PERMISSION.Administrator) !== 0n ? ALL_PERMISSIONS : bits;
  } catch {
    return null;
  }
}

export interface MemberHit {
  userId: string;
  joinedAt: Date | null;
}

export async function memberSearch(
  guildId: string,
  query: string,
  limit = 10,
): Promise<MemberHit[]> {
  const members = await searchMembers(guildId, { query, limit });
  const seen = new Set<string>();
  return members.flatMap((member) => {
    if (seen.has(member.user_id)) return [];
    seen.add(member.user_id);
    return [
      {
        userId: member.user_id,
        joinedAt: member.joined_at ? new Date(member.joined_at * 1000) : null,
      },
    ];
  });
}

export async function guildMember(guildId: string, userId: string): Promise<GuildMember | null> {
  try {
    const member = await bot<{ roles?: string[]; nick?: string | null }>(
      `/guilds/${guildId}/members/${userId}`,
    );
    return { userId, roles: member.roles ?? [], nick: member.nick ?? null };
  } catch (error) {
    if (error instanceof FluxerError && error.status === 404) return null;
    throw error;
  }
}

export interface MemberProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bot: boolean;
}

export async function userProfile(userId: string): Promise<MemberProfile | null> {
  try {
    const user = await bot<WireUser & { bot?: boolean }>(`/users/${userId}`);
    return {
      id: user.id,
      username: user.username,
      displayName: user.global_name ?? user.username,
      avatarUrl: avatarUrl(user.id, user.avatar),
      bot: user.bot ?? false,
    };
  } catch (error) {
    if (error instanceof FluxerError && error.status === 404) return null;
    throw error;
  }
}

const INVITE_BITS = [1, 2, 4, 5, 6, 7, 10, 11, 13, 14, 15, 16, 18, 20, 24, 27, 28, 29, 40, 51]
  .reduce((acc, bit) => acc | (1n << BigInt(bit)), 0n)
  .toString();

export function inviteUrl(guildId?: string): string | null {
  const clientId = env().FLUXER_CLIENT_ID;
  if (!clientId) return null;
  const query = new URLSearchParams({
    client_id: clientId,
    scope: 'bot',
    permissions: INVITE_BITS,
  });
  if (guildId) query.set('guild_id', guildId);
  return api(`/oauth2/authorize?${query}`);
}

export interface BotProfile {
  nick: string | null;
  bio: string | null;
  avatarUrl: string | null;
}

export async function botProfile(guildId: string): Promise<BotProfile | null> {
  try {
    const member = await bot<{
      nick?: string | null;
      bio?: string | null;
      avatar?: string | null;
      user?: { id: string };
    }>(`/guilds/${guildId}/members/@me`);
    const userId = member.user?.id;
    return {
      nick: member.nick ?? null,
      bio: member.bio ?? null,
      avatarUrl:
        member.avatar && userId
          ? `${MEDIA}/guilds/${guildId}/users/${userId}/avatars/${member.avatar}.png?size=128`
          : null,
    };
  } catch {
    return null;
  }
}

function auditHeader(reason: string): string {
  const value = reason.slice(0, 512);
  return /^[\x20-\x7e]*$/.test(value) ? value : encodeURIComponent(value);
}

export async function updateBotProfile(
  guildId: string,
  patch: { nick?: string | null; bio?: string | null; avatar?: string | null },
  reason: string,
): Promise<void> {
  const response = await fetch(api(`/guilds/${guildId}/members/@me`), {
    method: 'PATCH',
    headers: {
      authorization: `Bot ${env().FLUXER_TOKEN}`,
      'content-type': 'application/json',
      'x-audit-log-reason': auditHeader(reason),
    },
    body: JSON.stringify(patch),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  forgetBotCache(guildId);
  if (!response.ok) throw new FluxerError(response.status, await response.text().catch(() => ''));
}

export async function leaveGuild(guildId: string): Promise<void> {
  const response = await fetch(api(`/users/@me/guilds/${guildId}`), {
    method: 'DELETE',
    headers: { authorization: `Bot ${env().FLUXER_TOKEN}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new FluxerError(response.status, await response.text().catch(() => ''));
  }
}

export async function devGuilds(): Promise<UserGuild[]> {
  const guilds = await call<WireGuild[]>(
    '/users/@me/guilds?limit=100',
    `Bot ${env().FLUXER_TOKEN}`,
  );
  return guilds.map((guild) => ({
    id: guild.id,
    name: guild.name,
    iconUrl: iconUrl(guild.id, guild.icon),
    ownerId: guild.owner_id,
    permissions: PERMISSION.Administrator.toString(),
    memberCount: guild.approximate_member_count ?? guild.member_count ?? null,
  }));
}
