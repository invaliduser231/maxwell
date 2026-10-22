import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { hash, seal, token, unseal } from './crypto';
import { db } from './db';
import { env } from './env';
import {
  devGuilds,
  type FluxerUser,
  refreshTokens,
  revokeToken,
  type TokenPair,
  type UserGuild,
  userGuilds,
} from './fluxer';

export const SESSION_COOKIE = 'mx_session';
export const DEV_TOKEN = 'dev-login';

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEV_LOGIN === '1';
}
const SESSION_DAYS = 30;
const GUILDS_TTL_MS = 60_000;
const GUILDS_STALE_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

export interface Session {
  id: string;
  user: FluxerUser;
  expiresAt: Date;
}

interface Row {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  guilds: UserGuild[] | null;
  guildsFetchedAt: Date | null;
  lastSeenAt: Date;
  expiresAt: Date;
}

export function secureCookies(): boolean {
  return env().DASHBOARD_URL.startsWith('https://');
}

export async function createSession(user: FluxerUser, tokens: TokenPair): Promise<string> {
  const value = token();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db().sql`
    insert into dashboard_sessions (
      id, user_id, username, display_name, avatar_url, access_token, refresh_token,
      token_expires_at, expires_at
    ) values (
      ${hash(value)}, ${user.id}, ${user.username}, ${user.displayName}, ${user.avatarUrl},
      ${seal(tokens.accessToken)}, ${seal(tokens.refreshToken)}, ${tokens.expiresAt}, ${expiresAt}
    )
  `;
  await db().sql`delete from dashboard_sessions where expires_at < now()`;
  return value;
}

async function load(value: string): Promise<Row | null> {
  const [row] = await db().sql<Row[]>`
    select id, user_id::text as "userId", username, display_name as "displayName",
      avatar_url as "avatarUrl", access_token as "accessToken", refresh_token as "refreshToken",
      token_expires_at as "tokenExpiresAt", guilds, guilds_fetched_at as "guildsFetchedAt",
      last_seen_at as "lastSeenAt", expires_at as "expiresAt"
    from dashboard_sessions where id = ${hash(value)} and expires_at > now()
  `;
  return row ?? null;
}

const current = cache(async (): Promise<Row | null> => {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const row = await load(value);
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await db().sql`update dashboard_sessions set last_seen_at = now() where id = ${row.id}`;
  }
  return row;
});

export async function getSession(): Promise<Session | null> {
  const row = await current();
  if (!row) return null;
  return {
    id: row.id,
    user: {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl ?? '',
    },
    expiresAt: row.expiresAt,
  };
}

async function accessToken(row: Row): Promise<string | null> {
  if (unseal(row.accessToken) === DEV_TOKEN) return DEV_TOKEN;
  if (row.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return unseal(row.accessToken);
  }
  const refresh = unseal(row.refreshToken);
  if (!refresh) return null;
  try {
    const next = await refreshTokens(refresh);
    await db().sql`
      update dashboard_sessions set access_token = ${seal(next.accessToken)},
        refresh_token = ${seal(next.refreshToken)}, token_expires_at = ${next.expiresAt}
      where id = ${row.id}
    `;
    return next.accessToken;
  } catch {
    await db().sql`delete from dashboard_sessions where id = ${row.id}`;
    return null;
  }
}

const refreshing = new Map<string, Promise<UserGuild[] | null>>();

function refreshGuilds(row: Row): Promise<UserGuild[] | null> {
  const running = refreshing.get(row.id);
  if (running) return running;
  const task = (async () => {
    const access = await accessToken(row);
    if (!access) return null;
    try {
      const guilds =
        access === DEV_TOKEN && devLoginEnabled() ? await devGuilds() : await userGuilds(access);
      await db().sql`
        update dashboard_sessions set guilds = ${db().sql.json(guilds as never)},
          guilds_fetched_at = now()
        where id = ${row.id}
      `;
      return guilds;
    } catch {
      return row.guilds;
    }
  })().finally(() => refreshing.delete(row.id));
  refreshing.set(row.id, task);
  return task;
}

export const sessionGuilds = cache(async (fresh = false): Promise<UserGuild[] | null> => {
  const row = await current();
  if (!row) return null;
  const age = row.guildsFetchedAt ? Date.now() - row.guildsFetchedAt.getTime() : Infinity;
  if (!fresh && row.guilds && age < GUILDS_TTL_MS) return row.guilds;
  if (!fresh && row.guilds && age < GUILDS_STALE_MS) {
    refreshGuilds(row).catch(() => null);
    return row.guilds;
  }
  return refreshGuilds(row);
});

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!value) return;
  const row = await load(value);
  if (!row) return;
  await db().sql`delete from dashboard_sessions where id = ${row.id}`;
  const refresh = unseal(row.refreshToken);
  if (refresh) await revokeToken(refresh);
}
