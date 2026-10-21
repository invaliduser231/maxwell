import { generalConfig } from '@maxwell/core/modules/general';
import { type SchedulerConfig, schedulerConfig } from '@maxwell/core/modules/scheduler';
import { resolveTimezone } from '@maxwell/core/stores/scheduler';
import type { Services } from '../../services.js';

export { type SchedulerConfig, schedulerConfig };

export const MODULE = 'scheduler';

export const keys = {
  message: (guildId: string, messageId: string, runAt: number) =>
    `scheduler.message:${guildId}:${messageId}:${runAt}`,
  reminder: (id: string) => `scheduler.reminder:${id}`,
  sweep: (slot: number) => `scheduler.sweep:${slot}`,
  sync: (guildId: string) => `scheduler.sync:${guildId}`,
};

export const SYNC_DELAY = 2_000;

export function changedGuild(payload: string): string | null {
  const [guildId, key, ...rest] = payload.split(':');
  if (rest.length > 0 || key !== MODULE || !guildId || !/^\d{1,21}$/.test(guildId)) return null;
  return guildId;
}

export async function guildTimezone(
  services: Services,
  guildId: string,
  own: string | null,
): Promise<string> {
  if (own) return resolveTimezone(own);
  const general = await services.settings.config(guildId, 'general', generalConfig);
  return resolveTimezone(general.timezone);
}
