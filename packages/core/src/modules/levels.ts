import { z } from 'zod';
import { defineModule } from './types.js';

export const levelCurves = ['standard', 'gentle', 'linear'] as const;

export type LevelCurve = (typeof levelCurves)[number];

export const MAX_LEVEL = 1000;

export const announceModes = ['current', 'channel', 'dm', 'off'] as const;

export type AnnounceMode = (typeof announceModes)[number];

export function xpForNext(level: number, curve: LevelCurve = 'standard'): number {
  const n = Math.max(0, Math.floor(level));
  switch (curve) {
    case 'gentle':
      return 3 * n * n + 30 * n + 100;
    case 'linear':
      return 50 * n + 100;
    default:
      return 5 * n * n + 50 * n + 100;
  }
}

const tables = new Map<LevelCurve, number[]>();

function table(curve: LevelCurve): number[] {
  const cached = tables.get(curve);
  if (cached) return cached;
  const totals = [0];
  for (let level = 0; level < MAX_LEVEL; level++) {
    totals.push((totals[level] ?? 0) + xpForNext(level, curve));
  }
  tables.set(curve, totals);
  return totals;
}

export function totalXpForLevel(level: number, curve: LevelCurve = 'standard'): number {
  const index = Math.min(Math.max(0, Math.floor(level)), MAX_LEVEL);
  return table(curve)[index] ?? 0;
}

export interface LevelProgress {
  level: number;
  into: number;
  needed: number;
  total: number;
}

export function levelFromXp(xp: number, curve: LevelCurve = 'standard'): LevelProgress {
  const totals = table(curve);
  const total = Math.max(0, Math.floor(xp));
  let low = 0;
  let high = MAX_LEVEL;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((totals[mid] ?? Number.POSITIVE_INFINITY) <= total) low = mid;
    else high = mid - 1;
  }
  return {
    level: low,
    into: total - (totals[low] ?? 0),
    needed: low >= MAX_LEVEL ? 0 : xpForNext(low, curve),
    total,
  };
}

export function parseCurve(value: unknown): LevelCurve {
  return (levelCurves as readonly unknown[]).includes(value) ? (value as LevelCurve) : 'standard';
}

export const levelsConfig = z.object({
  xpMin: z.number().int().min(0).max(500).default(15),
  xpMax: z.number().int().min(0).max(500).default(25),
  cooldownSeconds: z.number().int().min(0).max(86_400).default(60),
  curve: z.enum(levelCurves).default('standard'),
  channelMultipliers: z
    .array(z.object({ channelId: z.string().min(1), multiplier: z.number().min(0).max(10) }))
    .max(100)
    .default([]),
  roleMultipliers: z
    .array(z.object({ roleId: z.string().min(1), multiplier: z.number().min(0).max(10) }))
    .max(100)
    .default([]),
  excludedChannels: z.array(z.string().min(1)).max(500).default([]),
  excludedRoles: z.array(z.string().min(1)).max(100).default([]),
  rewards: z
    .array(z.object({ level: z.number().int().min(1).max(MAX_LEVEL), roleId: z.string().min(1) }))
    .max(100)
    .default([]),
  removePreviousRewards: z.boolean().default(false),
  announce: z.enum(announceModes).default('current'),
  announceChannelId: z.string().nullable().default(null),
  message: z.string().min(1).max(1000).default('**{name}** is now level {level}.'),
  rewardMessage: z
    .string()
    .min(1)
    .max(1000)
    .default('**{name}** is now level {level} and gets **{role}**.'),
  card: z.boolean().default(false),
});

export type LevelsConfig = z.infer<typeof levelsConfig>;

export default defineModule({
  key: 'levels',
  name: 'Levels',
  description: 'XP, role rewards and the leaderboard.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: levelsConfig,
  migrations: [
    {
      id: '1-members',
      up: `
        create table levels_members (
          guild_id bigint not null,
          user_id bigint not null,
          xp bigint not null default 0 check (xp >= 0),
          last_xp_at timestamptz,
          updated_at timestamptz not null default now(),
          primary key (guild_id, user_id)
        );

        create index levels_members_board on levels_members (guild_id, xp desc, user_id);
      `,
    },
    {
      id: '2-snapshots',
      up: `
        create table levels_snapshots (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          kind text not null,
          row_count integer not null default 0,
          created_at timestamptz not null default now()
        );

        create index levels_snapshots_guild on levels_snapshots (guild_id, created_at desc);

        create table levels_snapshot_rows (
          snapshot_id bigint not null references levels_snapshots (id) on delete cascade,
          user_id bigint not null,
          xp bigint,
          primary key (snapshot_id, user_id)
        );
      `,
    },
    {
      id: '3-public-hidden',
      up: `
        create table levels_public_hidden (
          guild_id bigint not null,
          user_id bigint not null,
          created_at timestamptz not null default now(),
          primary key (guild_id, user_id)
        );
      `,
    },
  ],
});
