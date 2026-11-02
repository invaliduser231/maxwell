import type { Sql } from '../db/sql.js';
import { CONFIG_CHANNEL } from '../guilds/modules.js';
import type {
  SnapshotChannel,
  SnapshotData,
  SnapshotModule,
  SnapshotRole,
  TemplateData,
} from '../modules/backups.js';

export type SnapshotKind = 'daily' | 'manual';

export interface SnapshotMeta {
  id: string;
  number: number;
  guildId: string;
  kind: SnapshotKind;
  label: string | null;
  createdBy: string | null;
  roleCount: number;
  channelCount: number;
  moduleCount: number;
  createdAt: Date;
}

export interface Snapshot extends SnapshotMeta {
  data: SnapshotData;
}

export type ImportStatus = 'pending' | 'previewed' | 'applying' | 'applied' | 'failed';

export interface ImportRow {
  id: string;
  guildId: string;
  code: string;
  status: ImportStatus;
  plan: unknown;
  result: unknown;
  error: string | null;
  createdBy: string | null;
  createdAt: Date;
  appliedAt: Date | null;
}

export const TEMPLATES_PER_GUILD = 5;

export interface TemplateMeta {
  id: string;
  guildId: string;
  title: string;
  description: string;
  guildName: string | null;
  roleCount: number;
  channelCount: number;
  uses: number;
  createdAt: Date;
}

export interface Template extends TemplateMeta {
  data: TemplateData;
}

export type TemplateSort = 'popular' | 'new';

export class BackupStore {
  constructor(private readonly sql: Sql) {}

  async insert(
    guildId: string,
    kind: SnapshotKind,
    data: SnapshotData,
    options: { label?: string | null; by?: string | null } = {},
  ): Promise<SnapshotMeta> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`backups:${guildId}`}))`;
      const [row] = await tx<SnapshotMeta[]>`
        insert into backups_snapshots (
          guild_id, number, kind, label, created_by, role_count, channel_count, module_count, data
        )
        values (
          ${guildId},
          (select coalesce(max(number), 0) + 1 from backups_snapshots where guild_id = ${guildId}),
          ${kind}, ${options.label ?? null}, ${options.by ?? null},
          ${data.roles.length}, ${data.channels.length}, ${Object.keys(data.modules).length},
          ${tx.json(data as never)}
        )
        returning id, number, guild_id as "guildId", kind, label, created_by as "createdBy",
          role_count as "roleCount", channel_count as "channelCount", module_count as "moduleCount",
          created_at as "createdAt"
      `;
      if (!row) throw new Error('snapshot insert returned nothing');
      return row;
    });
  }

  async list(guildId: string, limit = 50): Promise<SnapshotMeta[]> {
    return this.sql<SnapshotMeta[]>`
      select id, number, guild_id as "guildId", kind, label, created_by as "createdBy",
        role_count as "roleCount", channel_count as "channelCount", module_count as "moduleCount",
        created_at as "createdAt"
      from backups_snapshots
      where guild_id = ${guildId}
      order by created_at desc, id desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async get(guildId: string, id: string): Promise<Snapshot | null> {
    if (!/^\d+$/.test(id)) return null;
    const [row] = await this.sql<Snapshot[]>`
      select id, number, guild_id as "guildId", kind, label, created_by as "createdBy",
        role_count as "roleCount", channel_count as "channelCount", module_count as "moduleCount",
        created_at as "createdAt", data
      from backups_snapshots
      where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async byNumber(guildId: string, number: number): Promise<Snapshot | null> {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) return null;
    const [row] = await this.sql<Snapshot[]>`
      select id, number, guild_id as "guildId", kind, label, created_by as "createdBy",
        role_count as "roleCount", channel_count as "channelCount", module_count as "moduleCount",
        created_at as "createdAt", data
      from backups_snapshots
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async latest(guildId: string, kind?: SnapshotKind): Promise<Snapshot | null> {
    const [row] = await this.sql<Snapshot[]>`
      select id, number, guild_id as "guildId", kind, label, created_by as "createdBy",
        role_count as "roleCount", channel_count as "channelCount", module_count as "moduleCount",
        created_at as "createdAt", data
      from backups_snapshots
      where guild_id = ${guildId} ${kind ? this.sql`and kind = ${kind}` : this.sql``}
      order by created_at desc, id desc
      limit 1
    `;
    return row ?? null;
  }

  async latestAt(guildId: string, kind: SnapshotKind): Promise<Date | null> {
    const [row] = await this.sql<{ at: Date | null }[]>`
      select max(created_at) as at from backups_snapshots
      where guild_id = ${guildId} and kind = ${kind}
    `;
    return row?.at ?? null;
  }

  async usage(guildId: string): Promise<{ count: number; bytes: number }> {
    const [row] = await this.sql<{ count: number; bytes: number }[]>`
      select count(*)::int as count, coalesce(sum(pg_column_size(data)), 0)::bigint::float8 as bytes
      from backups_snapshots
      where guild_id = ${guildId}
    `;
    return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
  }

  async findRole(
    guildId: string,
    roleId: string,
  ): Promise<{ snapshotId: string; role: SnapshotRole } | null> {
    const [row] = await this.sql<{ snapshotId: string; role: SnapshotRole }[]>`
      select s.id as "snapshotId", r.value as role
      from backups_snapshots s
      cross join lateral jsonb_array_elements(s.data -> 'roles') r
      where s.guild_id = ${guildId} and r.value ->> 'id' = ${roleId}
      order by s.created_at desc, s.id desc
      limit 1
    `;
    return row ?? null;
  }

  async findChannel(
    guildId: string,
    channelId: string,
  ): Promise<{ snapshotId: string; channel: SnapshotChannel } | null> {
    const [row] = await this.sql<{ snapshotId: string; channel: SnapshotChannel }[]>`
      select s.id as "snapshotId", c.value as channel
      from backups_snapshots s
      cross join lateral jsonb_array_elements(s.data -> 'channels') c
      where s.guild_id = ${guildId} and c.value ->> 'id' = ${channelId}
      order by s.created_at desc, s.id desc
      limit 1
    `;
    return row ?? null;
  }

  async prune(
    guildId: string,
    options: { retentionDays: number; maxManual: number },
  ): Promise<number> {
    const cutoff = new Date(Date.now() - options.retentionDays * 86_400_000);
    const daily = await this.sql`
      delete from backups_snapshots
      where guild_id = ${guildId} and kind = 'daily' and created_at < ${cutoff}
        and id <> (
          select id from backups_snapshots
          where guild_id = ${guildId} and kind = 'daily'
          order by created_at desc, id desc limit 1
        )
      returning 1
    `;
    const manual = await this.sql`
      delete from backups_snapshots
      where guild_id = ${guildId} and kind = 'manual' and id not in (
        select id from backups_snapshots
        where guild_id = ${guildId} and kind = 'manual'
        order by created_at desc, id desc
        limit ${options.maxManual}
      )
      returning 1
    `;
    return daily.length + manual.length;
  }

  async remove(guildId: string, id: string): Promise<boolean> {
    const rows = await this.sql`
      delete from backups_snapshots where guild_id = ${guildId} and id = ${id} returning 1
    `;
    return rows.length > 0;
  }

  async moduleStates(guildId: string): Promise<Record<string, SnapshotModule>> {
    const rows = await this.sql<
      { module: string; enabled: boolean | null; config: Record<string, unknown> }[]
    >`
      select module, enabled, config from guild_modules where guild_id = ${guildId} order by module
    `;
    return Object.fromEntries(
      rows.map((row) => [row.module, { enabled: row.enabled, config: row.config ?? {} }]),
    );
  }

  async writeModuleStates(
    guildId: string,
    states: Record<string, SnapshotModule>,
    keepEnabled: readonly string[] = [],
  ): Promise<void> {
    const entries = Object.entries(states);
    if (entries.length === 0) return;
    await this.sql.begin(async (tx) => {
      await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
      for (const [module, state] of entries) {
        if (keepEnabled.includes(module)) {
          await tx`
            insert into guild_modules (guild_id, module, config)
            values (${guildId}, ${module}, ${tx.json(state.config as never)})
            on conflict (guild_id, module) do update set config = excluded.config, updated_at = now()
          `;
        } else {
          await tx`
            insert into guild_modules (guild_id, module, enabled, config)
            values (${guildId}, ${module}, ${state.enabled}, ${tx.json(state.config as never)})
            on conflict (guild_id, module) do update set
              enabled = excluded.enabled, config = excluded.config, updated_at = now()
          `;
        }
        await tx`select pg_notify(${CONFIG_CHANNEL}, ${`${guildId}:${module}`})`;
      }
    });
  }

  async createImport(guildId: string, code: string, by: string | null): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into backups_imports (guild_id, code, created_by)
      values (${guildId}, ${code}, ${by})
      returning id
    `;
    return row?.id ?? '';
  }

  async getImport(guildId: string, id: string): Promise<ImportRow | null> {
    if (!/^\d+$/.test(id)) return null;
    const [row] = await this.sql<ImportRow[]>`
      select id, guild_id as "guildId", code, status, plan, result, error, created_by as "createdBy",
        created_at as "createdAt", applied_at as "appliedAt"
      from backups_imports where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async listImports(guildId: string, limit = 10): Promise<ImportRow[]> {
    return this.sql<ImportRow[]>`
      select id, guild_id as "guildId", code, status, plan, result, error, created_by as "createdBy",
        created_at as "createdAt", applied_at as "appliedAt"
      from backups_imports where guild_id = ${guildId}
      order by id desc
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }

  async setImportPlan(guildId: string, id: string, plan: unknown): Promise<void> {
    await this.sql`
      update backups_imports set status = 'previewed', plan = ${this.sql.json(plan as never)}, error = null
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async failImport(guildId: string, id: string, error: string): Promise<void> {
    await this.sql`
      update backups_imports set status = 'failed', error = ${error.slice(0, 500)}
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async claimImport(guildId: string, id: string): Promise<ImportRow | null> {
    const [row] = await this.sql<ImportRow[]>`
      update backups_imports set status = 'applying'
      where guild_id = ${guildId} and id = ${id} and status = 'previewed'
      returning id, guild_id as "guildId", code, status, plan, result, error, created_by as "createdBy",
        created_at as "createdAt", applied_at as "appliedAt"
    `;
    return row ?? null;
  }

  async finishImport(guildId: string, id: string, result: unknown): Promise<void> {
    await this.sql`
      update backups_imports set status = 'applied', result = ${this.sql.json(result as never)},
        applied_at = now()
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async createdBy(
    guildId: string,
    userId: string,
  ): Promise<{
    snapshots: {
      id: string;
      number: number;
      kind: SnapshotKind;
      label: string | null;
      createdAt: Date;
    }[];
    imports: { id: string; code: string; status: ImportStatus; createdAt: Date }[];
  }> {
    const snapshots = await this.sql<
      { id: string; number: number; kind: SnapshotKind; label: string | null; createdAt: Date }[]
    >`
      select id, number, kind, label, created_at as "createdAt" from backups_snapshots
      where guild_id = ${guildId} and created_by = ${userId}
      order by created_at desc
    `;
    const imports = await this.sql<
      { id: string; code: string; status: ImportStatus; createdAt: Date }[]
    >`
      select id, code, status, created_at as "createdAt" from backups_imports
      where guild_id = ${guildId} and created_by = ${userId}
      order by created_at desc
    `;
    return { snapshots: [...snapshots], imports: [...imports] };
  }

  async forgetCreator(guildId: string, userId: string): Promise<number> {
    const snapshots = await this.sql`
      update backups_snapshots set created_by = null
      where guild_id = ${guildId} and created_by = ${userId}
      returning 1
    `;
    const imports = await this.sql`
      update backups_imports set created_by = null
      where guild_id = ${guildId} and created_by = ${userId}
      returning 1
    `;
    return snapshots.length + imports.length;
  }

  async setMemberRoles(
    guildId: string,
    members: readonly { userId: string; roleIds: readonly string[] }[],
    liveRoleIds: readonly string[],
  ): Promise<void> {
    if (members.length === 0) return;
    const users = members.map((member) => member.userId);
    const pairs = members.flatMap((member) =>
      [...new Set(member.roleIds)].map((roleId) => ({ role_id: roleId, user_id: member.userId })),
    );
    await this.sql.begin(async (tx) => {
      await tx`
        delete from backups_member_roles
        where guild_id = ${guildId} and user_id = any(${users}::bigint[])
          and deleted_at is null and role_id = any(${[...liveRoleIds]}::bigint[])
      `;
      if (pairs.length === 0) return;
      await tx`
        insert into backups_member_roles (guild_id, role_id, user_id)
        select ${guildId}, x.role_id, x.user_id
        from jsonb_to_recordset(${tx.json(pairs as never)}) as x(role_id bigint, user_id bigint)
        on conflict (guild_id, role_id, user_id) do update set deleted_at = null
      `;
    });
  }

  async forgetMemberRoles(guildId: string, userId: string): Promise<number> {
    const rows = await this.sql`
      delete from backups_member_roles
      where guild_id = ${guildId} and user_id = ${userId}
      returning 1
    `;
    return rows.length;
  }

  async keepMembers(guildId: string, userIds: readonly string[]): Promise<number> {
    const rows = await this.sql`
      delete from backups_member_roles
      where guild_id = ${guildId} and not (user_id = any(${[...userIds]}::bigint[]))
      returning 1
    `;
    return rows.length;
  }

  async markRolesDeleted(guildId: string, roleIds: readonly string[]): Promise<number> {
    const rows = await this.sql`
      update backups_member_roles set deleted_at = now()
      where guild_id = ${guildId} and deleted_at is null
        and role_id = any(${[...roleIds]}::bigint[])
      returning 1
    `;
    return rows.length;
  }

  async markMissingRoles(guildId: string, liveRoleIds: readonly string[]): Promise<number> {
    const rows = await this.sql`
      update backups_member_roles set deleted_at = now()
      where guild_id = ${guildId} and deleted_at is null
        and not (role_id = any(${[...liveRoleIds]}::bigint[]))
      returning 1
    `;
    return rows.length;
  }

  async roleMembers(guildId: string, roleId: string): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select user_id as "userId" from backups_member_roles
      where guild_id = ${guildId} and role_id = ${roleId}
      order by user_id
    `;
    return rows.map((row) => String(row.userId));
  }

  async moveRoleMembers(guildId: string, from: string, to: string): Promise<number> {
    const rows = await this.sql`
      with moved as (
        delete from backups_member_roles
        where guild_id = ${guildId} and role_id = ${from}
        returning user_id
      )
      insert into backups_member_roles (guild_id, role_id, user_id)
      select ${guildId}, ${to}, user_id from moved
      on conflict (guild_id, role_id, user_id) do update set deleted_at = null
      returning 1
    `;
    return rows.length;
  }

  async memberRolesOf(guildId: string, userId: string): Promise<string[]> {
    const rows = await this.sql<{ roleId: string }[]>`
      select role_id as "roleId" from backups_member_roles
      where guild_id = ${guildId} and user_id = ${userId}
      order by role_id
    `;
    return rows.map((row) => String(row.roleId));
  }

  async clearMemberRoles(guildId: string): Promise<number> {
    const rows = await this.sql`
      delete from backups_member_roles where guild_id = ${guildId} returning 1
    `;
    return rows.length;
  }

  async pruneDeletedRoles(guildId: string, before: Date): Promise<number> {
    const rows = await this.sql`
      delete from backups_member_roles
      where guild_id = ${guildId} and deleted_at < ${before}
      returning 1
    `;
    return rows.length;
  }

  async publishTemplate(
    guildId: string,
    input: { title: string; description: string; guildName: string | null; data: TemplateData },
  ): Promise<TemplateMeta | null> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`backups-templates:${guildId}`}))`;
      const [taken] = await tx<{ count: number }[]>`
        select count(*)::int as count from backups_templates where guild_id = ${guildId}
      `;
      if ((taken?.count ?? 0) >= TEMPLATES_PER_GUILD) return null;
      const [row] = await tx<TemplateMeta[]>`
        insert into backups_templates (
          guild_id, title, description, guild_name, role_count, channel_count, data
        )
        values (
          ${guildId}, ${input.title}, ${input.description}, ${input.guildName},
          ${input.data.roles.length}, ${input.data.channels.length}, ${tx.json(input.data as never)}
        )
        returning id, guild_id as "guildId", title, description, guild_name as "guildName",
          role_count as "roleCount", channel_count as "channelCount", uses, created_at as "createdAt"
      `;
      return row ?? null;
    });
  }

  async templates(options: { sort?: TemplateSort; limit?: number } = {}): Promise<TemplateMeta[]> {
    const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
    const order = options.sort === 'new' ? this.sql`t.id desc` : this.sql`t.uses desc, t.id desc`;
    return this.sql<TemplateMeta[]>`
      select t.id, t.guild_id as "guildId", t.title, t.description, t.guild_name as "guildName",
        t.role_count as "roleCount", t.channel_count as "channelCount", t.uses,
        t.created_at as "createdAt"
      from backups_templates t
      where not exists (
        select 1 from guilds g where g.id = t.guild_id and g.left_at is not null
      )
      order by ${order}
      limit ${limit}
    `;
  }

  async template(id: string): Promise<Template | null> {
    if (!/^\d{1,18}$/.test(id)) return null;
    const [row] = await this.sql<Template[]>`
      select t.id, t.guild_id as "guildId", t.title, t.description, t.guild_name as "guildName",
        t.role_count as "roleCount", t.channel_count as "channelCount", t.uses,
        t.created_at as "createdAt", t.data
      from backups_templates t
      where t.id = ${id} and not exists (
        select 1 from guilds g where g.id = t.guild_id and g.left_at is not null
      )
    `;
    return row ?? null;
  }

  async guildTemplates(guildId: string): Promise<TemplateMeta[]> {
    return this.sql<TemplateMeta[]>`
      select id, guild_id as "guildId", title, description, guild_name as "guildName",
        role_count as "roleCount", channel_count as "channelCount", uses, created_at as "createdAt"
      from backups_templates
      where guild_id = ${guildId}
      order by id desc
    `;
  }

  async removeTemplate(id: string, guildId?: string): Promise<TemplateMeta | null> {
    if (!/^\d{1,18}$/.test(id)) return null;
    const [row] = await this.sql<TemplateMeta[]>`
      delete from backups_templates
      where id = ${id} ${guildId ? this.sql`and guild_id = ${guildId}` : this.sql``}
      returning id, guild_id as "guildId", title, description, guild_name as "guildName",
        role_count as "roleCount", channel_count as "channelCount", uses, created_at as "createdAt"
    `;
    return row ?? null;
  }

  async countTemplateUse(id: string): Promise<void> {
    if (!/^\d{1,18}$/.test(id)) return;
    await this.sql`update backups_templates set uses = uses + 1 where id = ${id}`;
  }
}
