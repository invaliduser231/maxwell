import { notifyLive, type Sql, STRUCTURE_MODULE } from '@maxwell/core';
import type { Logger } from '../log.js';
import type { Platform } from '../platform/types.js';

const QUIET_MS = 400;
const EVENTS = [
  'channelCreate',
  'channelUpdate',
  'channelDelete',
  'roleCreate',
  'roleUpdate',
  'roleDelete',
] as const;

export function watchStructure(platform: Platform, sql: Sql, log: Logger): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const touch = ({ guildId }: { guildId: string }) => {
    if (timers.has(guildId)) return;
    timers.set(
      guildId,
      setTimeout(() => {
        timers.delete(guildId);
        notifyLive(sql, guildId, STRUCTURE_MODULE).catch((error) =>
          log.warn({ err: error, guildId }, 'could not announce a structure change'),
        );
      }, QUIET_MS),
    );
  };
  for (const event of EVENTS) platform.on(event, touch);
  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
