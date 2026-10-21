import { z } from 'zod';
import { defineModule } from './types.js';

const id = z.string().regex(/^\d{1,21}$/);

export const menuTypes = ['normal', 'unique', 'add', 'temporary'] as const;

export type MenuType = (typeof menuTypes)[number];

export const roleMenu = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default('menu'),
  channelId: id.nullable().default(null),
  title: z.string().max(256).default('Pick your roles'),
  description: z.string().max(2000).default(''),
  type: z.enum(menuTypes).default('normal'),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 365)
    .default(60 * 24),
  entries: z
    .array(
      z.object({
        emoji: z.string().min(1).max(80),
        roleId: id,
        label: z.string().max(100).default(''),
      }),
    )
    .max(20)
    .default([]),
});

export type RoleMenu = z.infer<typeof roleMenu>;

export const rolesConfig = z.object({
  menus: z
    .array(roleMenu)
    .max(25)
    .refine((menus) => new Set(menus.map((menu) => menu.id)).size === menus.length, {
      message: 'Menu ids must be unique.',
    })
    .default([]),
  autoroles: z
    .object({
      roleIds: z.array(id).max(10).default([]),
      botRoleIds: z.array(id).max(10).default([]),
      delayMinutes: z
        .number()
        .int()
        .min(0)
        .max(60 * 24 * 7)
        .default(0),
    })
    .prefault({}),
  timeRoles: z
    .array(
      z.object({
        roleId: id,
        days: z.number().int().min(1).max(3650),
      }),
    )
    .max(10)
    .default([]),
  sticky: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.enum(['all', 'listed']).default('listed'),
      roleIds: z.array(id).max(50).default([]),
      ignoredRoleIds: z.array(id).max(50).default([]),
      retentionDays: z.number().int().min(1).max(3650).default(180),
    })
    .prefault({}),
});

export type RolesConfig = z.infer<typeof rolesConfig>;

export default defineModule({
  key: 'roles',
  name: 'Roles',
  description: 'Role menus, autoroles and sticky roles.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: rolesConfig,
  migrations: [
    {
      id: '1-tables',
      up: `
        create table roles_menu_messages (
          guild_id bigint not null,
          menu_id text not null,
          channel_id bigint not null,
          message_id bigint not null,
          emojis text[] not null default '{}',
          published_at timestamptz not null default now(),
          primary key (guild_id, menu_id)
        );

        create unique index roles_menu_messages_message on roles_menu_messages (message_id);

        create table roles_temporary (
          guild_id bigint not null,
          user_id bigint not null,
          role_id bigint not null,
          expires_at timestamptz not null,
          primary key (guild_id, user_id, role_id)
        );

        create index roles_temporary_due on roles_temporary (expires_at);

        create table roles_members (
          guild_id bigint not null,
          user_id bigint not null,
          joined_at timestamptz,
          left_at timestamptz,
          sticky_role_ids bigint[] not null default '{}',
          updated_at timestamptz not null default now(),
          primary key (guild_id, user_id)
        );

        create index roles_members_joined on roles_members (guild_id, joined_at) where left_at is null;
        create index roles_members_left on roles_members (left_at) where left_at is not null;

        create table roles_time_granted (
          guild_id bigint not null,
          user_id bigint not null,
          role_id bigint not null,
          granted_at timestamptz not null default now(),
          primary key (guild_id, role_id, user_id)
        );
      `,
    },
  ],
});
