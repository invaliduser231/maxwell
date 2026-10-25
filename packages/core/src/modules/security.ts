import { z } from 'zod';
import { defineModule } from './types.js';

const id = z.string().regex(/^\d{1,21}$/);
const ids = (max = 100) => z.array(id).max(max).default([]);

export const severeActions = ['none', 'kick', 'ban'] as const;
export const expireActions = ['keep', 'kick'] as const;
export const honeypotActions = ['ban', 'softban', 'quarantine'] as const;
export const nukeResponses = ['strip', 'kick', 'ban'] as const;
export const nukeLimitKeys = [
  'channelDelete',
  'channelCreate',
  'roleDelete',
  'ban',
  'kick',
  'webhook',
  'botAdd',
  'dangerousGrant',
] as const;

export type SevereAction = (typeof severeActions)[number];
export type HoneypotAction = (typeof honeypotActions)[number];
export type NukeResponse = (typeof nukeResponses)[number];
export type NukeLimitKey = (typeof nukeLimitKeys)[number];

export const defaultSpamWords = [
  'nitro',
  'free',
  'giveaway',
  'airdrop',
  'crypto',
  'promo',
  'onlyfans',
  'support',
  'admin',
  'moderator',
  'official',
  'staff',
] as const;

const points = (value: number) => z.number().int().min(-20).max(30).default(value);

export const ageTier = z.object({
  hours: z.number().int().min(1).max(8760),
  points: z.number().int().min(0).max(30),
});

export const riskWeights = z
  .object({
    ageTiers: z
      .array(ageTier)
      .max(8)
      .default([
        { hours: 24, points: 6 },
        { hours: 72, points: 5 },
        { hours: 168, points: 4 },
        { hours: 336, points: 3 },
        { hours: 720, points: 1 },
      ]),
    noAvatar: points(1),
    noName: points(1),
    newWithoutAvatar: points(3),
    randomName: points(2),
    digitName: points(1),
    spamName: points(3),
    wave: points(4),
    rejoin: points(2),
    priorKick: points(2),
    priorBan: points(4),
    newInviter: points(2),
    established: points(-2),
  })
  .prefault({});

export const verificationSettings = z
  .object({
    enabled: z.boolean().default(false),
    threshold: z.number().int().min(1).max(100).default(5),
    severeScore: z.number().int().min(1).max(200).default(14),
    severeAction: z.enum(severeActions).default('none'),
    attempts: z.number().int().min(1).max(10).default(3),
    minutes: z.number().int().min(2).max(1440).default(30),
    onExpire: z.enum(expireActions).default('keep'),
    channelId: id.nullable().default(null),
    spamWords: z
      .array(z.string().min(2).max(40))
      .max(100)
      .default([...defaultSpamWords]),
    weights: riskWeights,
  })
  .prefault({});

export const raidSettings = z
  .object({
    enabled: z.boolean().default(false),
    joins: z.number().int().min(3).max(500).default(10),
    perSeconds: z.number().int().min(5).max(600).default(20),
    waveSize: z.number().int().min(2).max(100).default(4),
    waveSeconds: z.number().int().min(10).max(900).default(90),
    floodMembers: z.number().int().min(2).max(100).default(4),
    floodSeconds: z.number().int().min(5).max(600).default(30),
    newMemberMinutes: z.number().int().min(5).max(10_080).default(60),
    minutes: z.number().int().min(1).max(1440).default(15),
    pauseInvites: z.boolean().default(false),
    slowmodeSeconds: z.number().int().min(0).max(21_600).default(0),
    slowmodeChannelIds: ids(25),
  })
  .prefault({});

export const nukeLimits = z
  .object({
    channelDelete: z.number().int().min(1).max(100).default(3),
    channelCreate: z.number().int().min(1).max(100).default(8),
    roleDelete: z.number().int().min(1).max(100).default(3),
    ban: z.number().int().min(1).max(200).default(5),
    kick: z.number().int().min(1).max(200).default(6),
    webhook: z.number().int().min(1).max(100).default(4),
    botAdd: z.number().int().min(1).max(50).default(2),
    dangerousGrant: z.number().int().min(1).max(50).default(2),
  })
  .prefault({});

export const nukeSettings = z
  .object({
    enabled: z.boolean().default(false),
    windowSeconds: z.number().int().min(10).max(3600).default(60),
    limits: nukeLimits,
    response: z.enum(nukeResponses).default('strip'),
    botResponse: z.enum(nukeResponses).default('kick'),
    restore: z.boolean().default(true),
    trustedUserIds: ids(),
    trustedRoleIds: ids(),
  })
  .prefault({});

export const honeypotSettings = z
  .object({
    enabled: z.boolean().default(false),
    channelIds: ids(5),
    roleId: id.nullable().default(null),
    action: z.enum(honeypotActions).default('softban'),
    exemptMods: z.boolean().default(true),
  })
  .prefault({});

export const securityConfig = z.object({
  logChannelId: id.nullable().default(null),
  alertRoleId: id.nullable().default(null),
  verification: verificationSettings,
  raid: raidSettings,
  nuke: nukeSettings,
  honeypot: honeypotSettings,
});

export type SecurityConfig = z.infer<typeof securityConfig>;
export type RiskWeights = SecurityConfig['verification']['weights'];
export type VerificationSettings = SecurityConfig['verification'];
export type RaidSettings = SecurityConfig['raid'];
export type NukeSettings = SecurityConfig['nuke'];
export type HoneypotSettings = SecurityConfig['honeypot'];

export default defineModule({
  key: 'security',
  name: 'Security',
  description: 'Risk checks, captcha, raid and nuke protection, honeypots.',
  group: 'order',
  pole: 'south',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: securityConfig,
  migrations: [
    {
      id: '1-security',
      up: `
        create table security_checks (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          score integer not null,
          reasons jsonb not null default '[]',
          status text not null,
          method text,
          code text,
          attempts integer not null default 0,
          log_channel_id bigint,
          log_message_id bigint,
          created_at timestamptz not null default now(),
          expires_at timestamptz,
          resolved_at timestamptz
        );

        create unique index security_checks_open on security_checks (guild_id, user_id)
          where status = 'pending';
        create index security_checks_guild on security_checks (guild_id, created_at desc);
        create index security_checks_user on security_checks (user_id) where status = 'pending';

        create table security_events (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          kind text not null,
          user_id bigint,
          actor_id bigint,
          summary text not null default '',
          detail jsonb not null default '{}',
          created_at timestamptz not null default now()
        );

        create index security_events_guild on security_events (guild_id, created_at desc);

        create table security_raids (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          reason text not null,
          started_by bigint,
          started_at timestamptz not null default now(),
          ends_at timestamptz,
          ended_at timestamptz,
          ended_by bigint,
          state jsonb not null default '{}'
        );

        create unique index security_raids_open on security_raids (guild_id) where ended_at is null;
      `,
    },
  ],
});
