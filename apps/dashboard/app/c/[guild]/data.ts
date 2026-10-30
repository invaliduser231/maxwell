import 'server-only';
import { generalConfig } from '@maxwell/core';
import { EventStore } from '@maxwell/core/stores/events';
import { curveOf, LevelStore } from '@maxwell/core/stores/levels';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { db } from '@/lib/db';
import { botGuild } from '@/lib/fluxer';
import { profiles } from '@/lib/people';
import {
  isGuildId,
  loadPublicPage,
  type PublicPage,
  type PublicSources,
  publicTag,
} from '@/lib/public-page';

const REVALIDATE = 300;

const sources: PublicSources = {
  active: (guildId) => db().guilds.active(guildId),
  async settings(guildId) {
    const { modules, sql } = db();
    const [general, levels, events, curve] = await Promise.all([
      modules.get(guildId, 'general', generalConfig),
      modules.isEnabled(guildId, 'levels'),
      modules.isEnabled(guildId, 'events'),
      curveOf(sql, guildId),
    ]);
    return { page: general.publicPage, levels, events, curve };
  },
  guild: botGuild,
  leaderboard: (guildId, limit) => new LevelStore(db().sql).publicLeaderboard(guildId, limit),
  events: (guildId, limit) => new EventStore(db().sql).upcoming(guildId, limit),
  profiles: (userIds) => profiles(userIds),
};

export const publicPage = cache(async (guildId: string): Promise<PublicPage | null> => {
  if (!isGuildId(guildId) || !(await db().guilds.active(guildId))) return null;
  return unstable_cache(() => loadPublicPage(guildId, sources), ['public-page', guildId], {
    revalidate: REVALIDATE,
    tags: [publicTag(guildId)],
  })();
});
