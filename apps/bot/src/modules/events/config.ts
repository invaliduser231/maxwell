import { type EventsConfig, eventsConfig } from '@maxwell/core/modules/events';
import { generalConfig } from '@maxwell/core/modules/general';
import { resolveTimezone } from '@maxwell/core/stores/scheduler';
import type { ModuleContext } from '../../runtime/module.js';
import type { Services } from '../../services.js';

export { type EventsConfig, eventsConfig };

export const MODULE = 'events';

export type EventsContext = ModuleContext<typeof eventsConfig>;

const REFRESH_SLOT = 5_000;

export function refreshSlot(now = Date.now()): { slot: number; runAt: Date } {
  const slot = Math.floor(now / REFRESH_SLOT) + 1;
  return { slot, runAt: new Date(slot * REFRESH_SLOT) };
}

export const keys = {
  reminder: (eventId: string, startsAt: number) => `events.reminder:${eventId}:${startsAt}`,
  end: (eventId: string, startsAt: number) => `events.end:${eventId}:${startsAt}`,
  start: (eventId: string, startsAt: number) => `events.start:${eventId}:${startsAt}`,
  reward: (eventId: string, startsAt: number, part: number) =>
    `events.reward:${eventId}:${startsAt}:${part}`,
  rsvpSync: (eventId: string) => `events.rsvp.sync:${eventId}`,
  pollSync: (pollId: string) => `events.poll.sync:${pollId}`,
  rsvpRefresh: (eventId: string, slot: number) => `events.rsvp.refresh:${eventId}:${slot}`,
  pollClose: (pollId: string) => `events.poll.close:${pollId}`,
  pollRefresh: (pollId: string, slot: number) => `events.poll.refresh:${pollId}:${slot}`,
};

export async function guildTimezone(
  services: Services,
  guildId: string,
  config: EventsConfig,
): Promise<string> {
  if (config.timezone) return resolveTimezone(config.timezone);
  const general = await services.settings.config(guildId, 'general', generalConfig);
  return resolveTimezone(general.timezone);
}
