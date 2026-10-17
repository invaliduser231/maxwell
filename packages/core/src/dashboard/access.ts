import type { Sql } from '../db/sql.js';

export type AccessLevel = 'none' | 'view' | 'edit';

export interface AccessGrant {
  subjectType: 'role' | 'user';
  subjectId: string;
  module: string;
  level: 'view' | 'edit';
  createdBy: string | null;
  createdAt: Date;
}

export const ALL_MODULES = '*';

const rank: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export function strongest(a: AccessLevel, b: AccessLevel): AccessLevel {
  return rank[a] >= rank[b] ? a : b;
}

export function levelFor(
  grants: readonly AccessGrant[],
  userId: string,
  roleIds: readonly string[],
  module: string,
): AccessLevel {
  let level: AccessLevel = 'none';
  for (const grant of grants) {
    if (grant.module !== module && grant.module !== ALL_MODULES) continue;
    const matches =
      grant.subjectType === 'user' ? grant.subjectId === userId : roleIds.includes(grant.subjectId);
    if (matches) level = strongest(level, grant.level);
  }
  return level;
}

export class AccessStore {
  constructor(private readonly sql: Sql) {}

  async list(guildId: string): Promise<AccessGrant[]> {
    return this.sql<AccessGrant[]>`
      select subject_type as "subjectType", subject_id::text as "subjectId", module, level,
        created_by::text as "createdBy", created_at as "createdAt"
      from dashboard_access where guild_id = ${guildId}
      order by subject_type, subject_id, module
    `;
  }

  async replace(
    guildId: string,
    grants: readonly Pick<AccessGrant, 'subjectType' | 'subjectId' | 'module' | 'level'>[],
    by: string,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
      await tx`delete from dashboard_access where guild_id = ${guildId}`;
      for (const grant of grants) {
        await tx`
          insert into dashboard_access (guild_id, subject_type, subject_id, module, level, created_by)
          values (${guildId}, ${grant.subjectType}, ${grant.subjectId}, ${grant.module}, ${grant.level}, ${by})
          on conflict (guild_id, subject_type, subject_id, module) do update set level = excluded.level
        `;
      }
    });
  }
}
