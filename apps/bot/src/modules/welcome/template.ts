import { mention } from '../../commands/mentions.js';
import type { GuildRef, UserRef } from '../../platform/types.js';
import { count, escapeMarkdown, ordinal, snowflakeDate, timestamp } from '../../ui/format.js';
import { copy } from './copy.js';

export type Variables = Record<string, string>;

export function render(template: string, vars: Variables): string {
  return template.replace(/\{([a-z]+)\}/gi, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export function memberVariables(user: UserRef, guild: GuildRef | null): Variables {
  const members = guild?.memberCount ?? null;
  return {
    user: mention.user(user.id),
    name: escapeMarkdown(user.displayName),
    username: escapeMarkdown(user.username),
    id: user.id,
    server: escapeMarkdown(guild?.name ?? copy.unknownServer),
    count: members === null ? '?' : count(members),
    ordinal: members === null ? '?' : ordinal(members),
    created: timestamp(snowflakeDate(user.id), 'R'),
  };
}

export function cardVariables(user: UserRef, guild: GuildRef | null): Variables {
  const members = guild?.memberCount ?? null;
  return {
    user: user.displayName,
    name: user.displayName,
    username: user.username,
    id: user.id,
    server: guild?.name ?? '',
    count: members === null ? '?' : count(members),
    ordinal: members === null ? '?' : ordinal(members),
    created: snowflakeDate(user.id).toISOString().slice(0, 10),
  };
}
