import { inviteLink, type PublicPageConfig } from '@maxwell/core/modules/general';
import { type LevelCurve, levelFromXp } from '@maxwell/core/modules/levels';

export const PUBLIC_BOARD_SIZE = 10;
export const PUBLIC_EVENT_COUNT = 5;

export interface PublicGuild {
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
}

export interface PublicSettings {
  page: PublicPageConfig;
  levels: boolean;
  events: boolean;
  curve: LevelCurve;
}

export interface PublicEventSource {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number | null;
  timezone: string;
  location: string | null;
}

export interface PublicSources {
  active(guildId: string): Promise<boolean>;
  settings(guildId: string): Promise<PublicSettings>;
  guild(guildId: string): Promise<PublicGuild | null>;
  leaderboard(guildId: string, limit: number): Promise<{ userId: string; xp: number }[]>;
  events(guildId: string, limit: number): Promise<PublicEventSource[]>;
  profiles(
    userIds: string[],
  ): Promise<Map<string, { name: string; avatar: string | null; known: boolean }>>;
}

export interface PublicMember {
  rank: number;
  userId: string;
  name: string | null;
  avatar: string | null;
  level: number;
  xp: number;
}

export interface PublicEvent {
  id: string;
  title: string;
  startsAt: string;
  timezone: string;
  location: string | null;
}

export interface PublicPage {
  guildId: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
  description: string;
  invite: string | null;
  leaderboard: PublicMember[] | null;
  events: PublicEvent[] | null;
}

export function publicTag(guildId: string): string {
  return `public-page:${guildId}`;
}

export function isGuildId(value: string): boolean {
  return /^\d{1,21}$/.test(value);
}

function stillOn(event: PublicEventSource, now: number): boolean {
  const end = event.startsAt.getTime() + (event.durationMinutes ?? 0) * 60_000;
  return end >= now;
}

export async function loadPublicPage(
  guildId: string,
  sources: PublicSources,
  now = Date.now(),
): Promise<PublicPage | null> {
  if (!isGuildId(guildId) || !(await sources.active(guildId))) return null;
  const settings = await sources.settings(guildId);
  if (!settings.page.enabled) return null;
  const guild = await sources.guild(guildId);
  if (!guild) return null;

  const [rows, events] = await Promise.all([
    settings.levels ? sources.leaderboard(guildId, PUBLIC_BOARD_SIZE) : null,
    settings.events ? sources.events(guildId, PUBLIC_EVENT_COUNT * 4) : null,
  ]);
  const known = rows?.length ? await sources.profiles(rows.map((row) => row.userId)) : new Map();

  return {
    guildId,
    name: guild.name,
    iconUrl: guild.iconUrl,
    memberCount: guild.memberCount,
    description: settings.page.description,
    invite: settings.page.invite ? inviteLink(settings.page.invite) : null,
    leaderboard: rows
      ? rows.slice(0, PUBLIC_BOARD_SIZE).map((row, index) => {
          const person = known.get(row.userId);
          return {
            rank: index + 1,
            userId: row.userId,
            name: person?.known ? person.name : null,
            avatar: person?.known ? person.avatar : null,
            level: levelFromXp(row.xp, settings.curve).level,
            xp: row.xp,
          };
        })
      : null,
    events: events
      ? events
          .filter((event) => stillOn(event, now))
          .slice(0, PUBLIC_EVENT_COUNT)
          .map((event) => ({
            id: event.id,
            title: event.title,
            startsAt: event.startsAt.toISOString(),
            timezone: event.timezone,
            location: event.location,
          }))
      : null,
  };
}
