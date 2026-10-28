import { z } from 'zod';
import { defineModule } from './types.js';

export const automodModes = ['off', 'log', 'enforce'] as const;
export const automodActions = ['delete', 'warn', 'timeout', 'kick', 'ban'] as const;
export const automodRuleKeys = [
  'spam',
  'invites',
  'links',
  'mentions',
  'caps',
  'words',
  'repeats',
  'emoji',
  'newAccountLinks',
] as const;

export type AutomodMode = (typeof automodModes)[number];
export type AutomodAction = (typeof automodActions)[number];
export type AutomodRuleKey = (typeof automodRuleKeys)[number];

const ids = () => z.array(z.string()).max(250).default([]);

function base(action: AutomodAction) {
  return {
    mode: z.enum(automodModes).default('off'),
    action: z.enum(automodActions).default(action),
    timeoutMinutes: z.number().int().min(1).max(525_600).default(10),
    deleteMessage: z.boolean().default(true),
    exemptChannelIds: ids(),
    exemptRoleIds: ids(),
    exemptMods: z.boolean().default(true),
  };
}

export const spamRule = z
  .object({
    ...base('timeout'),
    maxMessages: z.number().int().min(1).max(50).default(5),
    perSeconds: z.number().int().min(2).max(120).default(5),
  })
  .prefault({});

export const invitesRule = z
  .object({
    ...base('delete'),
    allowedCodes: z.array(z.string().max(64)).max(100).default([]),
  })
  .prefault({});

export const linksRule = z
  .object({
    ...base('delete'),
    listMode: z.enum(['deny', 'allow']).default('deny'),
    domains: z.array(z.string().max(253)).max(500).default([]),
  })
  .prefault({});

export const mentionsRule = z
  .object({
    ...base('timeout'),
    maxMentions: z.number().int().min(1).max(100).default(5),
    countRoles: z.boolean().default(true),
  })
  .prefault({});

export const capsRule = z
  .object({
    ...base('delete'),
    minLength: z.number().int().min(4).max(2000).default(15),
    maxPercent: z.number().int().min(50).max(100).default(70),
  })
  .prefault({});

export const wordsRule = z
  .object({
    ...base('delete'),
    patterns: z.array(z.string().min(1).max(100)).max(1000).default([]),
  })
  .prefault({});

export const repeatsRule = z
  .object({
    ...base('delete'),
    maxRepeats: z.number().int().min(1).max(20).default(2),
    perSeconds: z.number().int().min(5).max(3600).default(60),
  })
  .prefault({});

export const emojiRule = z
  .object({
    ...base('delete'),
    maxEmojis: z.number().int().min(1).max(200).default(10),
  })
  .prefault({});

export const newAccountLinksRule = z
  .object({
    ...base('delete'),
    minAccountAgeHours: z.number().int().min(1).max(8760).default(72),
  })
  .prefault({});

export const automodRuleSchemas = {
  spam: spamRule,
  invites: invitesRule,
  links: linksRule,
  mentions: mentionsRule,
  caps: capsRule,
  words: wordsRule,
  repeats: repeatsRule,
  emoji: emojiRule,
  newAccountLinks: newAccountLinksRule,
} as const;

export const automodRules = z.object(automodRuleSchemas).prefault({});

export const raidShield = z
  .object({
    enabled: z.boolean().default(false),
    joins: z.number().int().min(2).max(500).default(10),
    perSeconds: z.number().int().min(2).max(600).default(10),
    minAccountAgeHours: z.number().int().min(0).max(8760).default(0),
    gateRoleId: z.string().nullable().default(null),
    gateChannelId: z.string().nullable().default(null),
    lockdownMinutes: z.number().int().min(1).max(1440).default(15),
    alertRoleId: z.string().nullable().default(null),
  })
  .prefault({});

export const automodConfig = z.object({
  logChannelId: z.string().nullable().default(null),
  modRoleIds: ids(),
  exemptChannelIds: ids(),
  exemptRoleIds: ids(),
  ignoreBots: z.boolean().default(true),
  notifyMembers: z.boolean().default(true),
  keepHistory: z.boolean().default(true),
  rules: automodRules,
  raid: raidShield,
});

export type AutomodConfig = z.infer<typeof automodConfig>;
export type AutomodRules = AutomodConfig['rules'];
export type AutomodRule = AutomodRules[AutomodRuleKey];
export type RaidShieldConfig = AutomodConfig['raid'];

export const HISTORY_DAYS = 7;

export default defineModule({
  key: 'automod',
  name: 'AutoMod',
  description: 'Filters and the raid shield.',
  group: 'order',
  pole: 'south',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: automodConfig,
  migrations: [
    {
      id: '1-hits',
      up: `
        create table automod_hits (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          channel_id bigint,
          message_id bigint,
          rule text not null,
          mode text not null,
          action text,
          detail text not null default '',
          content text,
          created_at timestamptz not null default now()
        );

        create index automod_hits_member on automod_hits (guild_id, user_id, created_at desc);
        create index automod_hits_guild on automod_hits (guild_id, created_at desc);
      `,
    },
    {
      id: '2-messages',
      up: `
        create table automod_messages (
          guild_id bigint not null,
          message_id bigint not null,
          channel_id bigint not null,
          author_id bigint not null,
          author_roles jsonb not null default '[]',
          author_bot boolean not null default false,
          content text not null,
          mention_users integer not null default 0,
          mention_roles integer not null default 0,
          created_at timestamptz not null,
          primary key (guild_id, message_id)
        );

        create index automod_messages_replay on automod_messages (guild_id, created_at, message_id);
        create index automod_messages_age on automod_messages (created_at);
      `,
    },
    {
      id: '3-dryruns',
      up: `
        create table automod_dryruns (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          rule_key text not null,
          rule jsonb not null,
          status text not null default 'pending',
          requested_by bigint,
          scanned integer not null default 0,
          caught integer not null default 0,
          by_mods integer not null default 0,
          samples jsonb not null default '[]',
          error text,
          created_at timestamptz not null default now(),
          finished_at timestamptz
        );

        create index automod_dryruns_guild on automod_dryruns (guild_id, created_at desc);
      `,
    },
    {
      id: '4-raid',
      up: `
        create table automod_incidents (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          reason text not null,
          started_by bigint,
          started_at timestamptz not null default now(),
          ends_at timestamptz,
          ended_at timestamptz,
          ended_by bigint
        );

        create index automod_incidents_guild on automod_incidents (guild_id, started_at desc);

        create table automod_held (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          incident_id bigint references automod_incidents (id) on delete set null,
          reason text not null,
          held_at timestamptz not null default now(),
          resolved_at timestamptz,
          outcome text,
          resolved_by bigint
        );

        create unique index automod_held_open on automod_held (guild_id, user_id) where resolved_at is null;
        create index automod_held_incident on automod_held (incident_id);
      `,
    },
    {
      id: '5-partitions',
      up: `
        alter table automod_messages rename to automod_messages_old;
        alter table automod_messages_old rename constraint automod_messages_pkey to automod_messages_old_pkey;
        alter index automod_messages_replay rename to automod_messages_old_replay;
        alter index automod_messages_age rename to automod_messages_old_age;

        create table automod_messages (
          guild_id bigint not null,
          message_id bigint not null,
          channel_id bigint not null,
          author_id bigint not null,
          author_roles jsonb not null default '[]',
          author_bot boolean not null default false,
          content text not null,
          mention_users integer not null default 0,
          mention_roles integer not null default 0,
          created_at timestamptz not null,
          primary key (guild_id, message_id, created_at)
        ) partition by range (created_at);

        create index automod_messages_replay on automod_messages (guild_id, created_at, message_id);
        create table automod_messages_default partition of automod_messages default;

        create table automod_history_guilds (
          guild_id bigint primary key,
          last_at timestamptz not null default now()
        );

        create function automod_messages_rotate(keep_days integer) returns integer
        language plpgsql as $$
        declare
          today date := (now() at time zone 'utc')::date;
          day date;
          name text;
          lower timestamptz;
          upper timestamptz;
          child record;
          dropped integer := 0;
        begin
          for day in
            select generate_series(today - keep_days, today + 2, interval '1 day')::date
          loop
            name := 'automod_messages_p' || to_char(day, 'YYYYMMDD');
            if to_regclass(name) is null then
              lower := day::timestamp at time zone 'utc';
              upper := lower + interval '1 day';
              execute format('create table %I (like automod_messages including defaults)', name);
              execute format(
                'with moved as (delete from automod_messages_default where created_at >= %L and created_at < %L returning *) insert into %I select * from moved',
                lower, upper, name
              );
              execute format(
                'alter table automod_messages attach partition %I for values from (%L) to (%L)',
                name, lower, upper
              );
            end if;
          end loop;
          for child in
            select c.relname from pg_inherits i
            join pg_class c on c.oid = i.inhrelid
            join pg_class p on p.oid = i.inhparent
            where p.relname = 'automod_messages' and c.relname ~ '^automod_messages_p[0-9]{8}$'
          loop
            if to_date(substr(child.relname, 19), 'YYYYMMDD') < today - keep_days then
              execute format('drop table %I', child.relname);
              dropped := dropped + 1;
            end if;
          end loop;
          delete from automod_messages_default where created_at < now() - make_interval(days => keep_days);
          return dropped;
        end
        $$;

        select automod_messages_rotate(7);
        insert into automod_messages
          select * from automod_messages_old where created_at >= now() - interval '7 days'
          on conflict do nothing;
        insert into automod_history_guilds (guild_id, last_at)
          select guild_id, max(created_at) from automod_messages group by guild_id;
        drop table automod_messages_old;
      `,
    },
  ],
});
