import 'server-only';
import { guildAccess, levelOf } from './access';
import { db } from './db';
import { canManage, type FluxerUser, inviteUrl } from './fluxer';
import { sessionGuilds } from './session';

export interface CommunityEntry {
  id: string;
  name: string;
  iconUrl: string | null;
  members: number | null;
  status: 'in' | 'out';
  invite: string | null;
}

const order = { in: 0, out: 1 } as const;

export async function communities(user: FluxerUser): Promise<CommunityEntry[]> {
  const guilds = (await sessionGuilds()) ?? [];
  const ids = guilds.map((guild) => guild.id);
  const [present, granted] = await Promise.all([
    db().sql<{ id: string }[]>`
      select id::text as id from guilds where left_at is null and id = any(${ids}::bigint[])
    `,
    db().sql<{ id: string }[]>`
      select distinct guild_id::text as id from dashboard_access where guild_id = any(${ids}::bigint[])
    `,
  ]);
  const inGuild = new Set(present.map((row) => row.id));
  const withGrants = granted
    .map((row) => row.id)
    .filter((id) => inGuild.has(id) && !guilds.some((g) => g.id === id && canManage(g, user.id)));
  const checked = await Promise.all(
    withGrants.map(async (id) => {
      const access = await guildAccess(id).catch(() => null);
      return access && levelOf(access, null) !== 'none' ? id : null;
    }),
  );
  const allowed = new Set(checked.filter((id): id is string => id !== null));

  return guilds
    .flatMap((guild): CommunityEntry[] => {
      const manage = canManage(guild, user.id);
      const present = inGuild.has(guild.id);
      if (!manage && !allowed.has(guild.id)) return [];
      const status = present ? 'in' : 'out';
      return [
        {
          id: guild.id,
          name: guild.name,
          iconUrl: guild.iconUrl,
          members: guild.memberCount,
          status,
          invite: status === 'out' ? inviteUrl(guild.id) : null,
        },
      ];
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}
