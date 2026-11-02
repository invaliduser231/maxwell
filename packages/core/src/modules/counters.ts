import { z } from 'zod';
import { defineModule } from './types.js';

const id = z.string().regex(/^\d{1,21}$/);

export const counterTypes = [
  'members',
  'online',
  'goal',
  'voice',
  'channels',
  'roles',
  'countdown',
] as const;

export type CounterType = (typeof counterTypes)[number];

export const COUNTER_LIMIT = 20;

export const counter = z.object({
  channelId: id,
  type: z.enum(counterTypes),
  template: z.string().trim().min(1).max(100),
  goal: z.number().int().min(1).max(100_000_000).nullable().default(null),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});

export type Counter = z.infer<typeof counter>;

export const countersConfig = z.object({
  counters: z.array(counter).max(COUNTER_LIMIT).default([]),
});

export type CountersConfig = z.infer<typeof countersConfig>;

export interface CounterValues {
  members: number | null;
  online: number | null;
  voice: number;
  channels: number;
  roles: number;
  today: string;
}

export function daysUntil(until: string, today: string): number {
  const end = Date.parse(`${until}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function counterValue(item: Counter, values: CounterValues): number | null {
  switch (item.type) {
    case 'members':
    case 'goal':
      return values.members;
    case 'online':
      return values.online;
    case 'voice':
      return values.voice;
    case 'channels':
      return values.channels;
    case 'roles':
      return values.roles;
    case 'countdown':
      return item.until ? daysUntil(item.until, values.today) : null;
  }
}

export function counterName(item: Counter, values: CounterValues, locale = 'en'): string | null {
  const count = counterValue(item, values);
  if (count === null) return null;
  const format = (value: number) => value.toLocaleString(locale);
  const goal = item.goal ?? 0;
  const name = item.template
    .replaceAll('{count}', format(count))
    .replaceAll('{goal}', format(goal))
    .replaceAll('{left}', format(Math.max(0, goal - count)))
    .trim();
  return name.length > 0 ? name.slice(0, 100) : null;
}

export default defineModule({
  key: 'counters',
  name: 'Counters',
  description: 'Channel names that keep count.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: countersConfig,
  migrations: [],
});
