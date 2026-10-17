export interface Migration {
  id: number;
  name: string;
  up: string;
}

export const coreMigrations: Migration[] = [
  {
    id: 1,
    name: 'guilds',
    up: `
      create table guilds (
        id bigint primary key,
        prefix text,
        joined_at timestamptz not null default now(),
        left_at timestamptz
      );

      create table guild_modules (
        guild_id bigint not null references guilds (id) on delete cascade,
        module text not null,
        enabled boolean not null default true,
        config jsonb not null default '{}',
        updated_at timestamptz not null default now(),
        primary key (guild_id, module)
      );
    `,
  },
  {
    id: 2,
    name: 'member_joins',
    up: `
      create table member_joins (
        id bigint generated always as identity primary key,
        guild_id bigint not null,
        user_id bigint not null,
        joined_at timestamptz not null,
        left_at timestamptz,
        join_source smallint,
        invite_code text,
        inviter_id bigint,
        resolved_at timestamptz,
        unique (guild_id, user_id, joined_at)
      );

      create index member_joins_inviter on member_joins (guild_id, inviter_id) where inviter_id is not null;
      create index member_joins_member on member_joins (guild_id, user_id, joined_at desc);
    `,
  },
  {
    id: 3,
    name: 'guild_assets',
    up: `
      create table guild_assets (
        guild_id bigint not null references guilds (id) on delete cascade,
        key text not null,
        content_type text not null,
        data bytea not null,
        updated_at timestamptz not null default now(),
        primary key (guild_id, key)
      );
    `,
  },
  {
    id: 4,
    name: 'module_state',
    up: `
      alter table guild_modules alter column enabled drop not null;
      alter table guild_modules alter column enabled drop default;
      update guild_modules set enabled = null;
    `,
  },
  {
    id: 5,
    name: 'audit_entries',
    up: `
      create table audit_entries (
        id bigint generated always as identity primary key,
        guild_id bigint not null,
        actor_id bigint,
        module text not null,
        action text not null,
        summary text not null,
        before jsonb,
        after jsonb,
        undo jsonb,
        created_at timestamptz not null default now(),
        undone_at timestamptz,
        undone_by bigint
      );

      create index audit_entries_guild on audit_entries (guild_id, created_at desc);
    `,
  },
  {
    id: 6,
    name: 'jobs',
    up: `
      create table jobs (
        id bigint generated always as identity primary key,
        kind text not null,
        guild_id bigint,
        payload jsonb not null default '{}',
        run_at timestamptz not null default now(),
        locked_until timestamptz,
        attempts integer not null default 0,
        last_error text,
        dedupe_key text unique,
        created_at timestamptz not null default now()
      );

      create index jobs_due on jobs (run_at) where locked_until is null;
    `,
  },
  {
    id: 7,
    name: 'voters',
    up: `
      create table voters (
        user_id bigint primary key,
        seen_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 8,
    name: 'module_migrations',
    up: `
      create table module_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 9,
    name: 'dashboard_sessions',
    up: `
      create table dashboard_sessions (
        id text primary key,
        user_id bigint not null,
        username text not null,
        display_name text not null,
        avatar_url text,
        access_token text not null,
        refresh_token text not null,
        token_expires_at timestamptz not null,
        guilds jsonb,
        guilds_fetched_at timestamptz,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        expires_at timestamptz not null
      );

      create index dashboard_sessions_user on dashboard_sessions (user_id);
      create index dashboard_sessions_expiry on dashboard_sessions (expires_at);
    `,
  },
  {
    id: 10,
    name: 'dashboard_access',
    up: `
      create table dashboard_access (
        guild_id bigint not null references guilds (id) on delete cascade,
        subject_type text not null check (subject_type in ('role', 'user')),
        subject_id bigint not null,
        module text not null,
        level text not null check (level in ('view', 'edit')),
        created_by bigint,
        created_at timestamptz not null default now(),
        primary key (guild_id, subject_type, subject_id, module)
      );
    `,
  },
  {
    id: 11,
    name: 'bot_meta',
    up: `
      create table bot_meta (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      );
    `,
  },
];
