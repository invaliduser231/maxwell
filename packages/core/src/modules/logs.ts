import { z } from 'zod';
import { defineModule } from './types.js';

export const logEvents = [
  'messageDelete',
  'messageEdit',
  'messageBulkDelete',
  'memberJoin',
  'memberLeave',
  'memberRoles',
  'nicknames',
  'timeouts',
  'roles',
  'channels',
  'voice',
  'invites',
  'bans',
  'kicks',
] as const;

export type LogEvent = (typeof logEvents)[number];

export const logEventNames: Record<LogEvent, string> = {
  messageDelete: 'Messages deleted',
  messageEdit: 'Messages edited',
  messageBulkDelete: 'Bulk deletes',
  memberJoin: 'Member joins',
  memberLeave: 'Member leaves',
  memberRoles: 'Member roles',
  nicknames: 'Nicknames',
  timeouts: 'Timeouts',
  roles: 'Roles',
  channels: 'Channels',
  voice: 'Voice',
  invites: 'Invites',
  bans: 'Bans',
  kicks: 'Kicks',
};

export const logRoute = z.object({
  enabled: z.boolean().default(true),
  channelId: z.string().nullable().default(null),
});

export type LogRoute = z.output<typeof logRoute>;

const routes = z
  .object(
    Object.fromEntries(logEvents.map((event) => [event, logRoute.prefault({})])) as Record<
      LogEvent,
      z.ZodPrefault<typeof logRoute>
    >,
  )
  .prefault({});

export const logsConfig = z.object({
  defaultChannelId: z.string().nullable().default(null),
  routes,
  ignoredChannelIds: z.array(z.string()).max(100).default([]),
  ignoredRoleIds: z.array(z.string()).max(50).default([]),
  ignoreBots: z.boolean().default(true),
});

export type LogsConfig = z.output<typeof logsConfig>;

export default defineModule({
  key: 'logs',
  name: 'Logs',
  description: 'Message, member, role and channel logs.',
  group: 'order',
  pole: 'south',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: logsConfig,
  migrations: [],
});
