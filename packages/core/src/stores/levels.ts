import type { Sql } from '../db/sql.js';
import {
  type LevelCurve,
  levelFromXp,
  MAX_LEVEL,
  parseCurve,
  totalXpForLevel,
} from '../modules/levels.js';

export interface Standing {
  userId: string;
  xp: number;
  rank: number;
}

export interface XpEntry {
  userId: string;
  xp: number;
}

export type ImportMode = 'replace' | 'add' | 'max';

export interface SnapshotResult {
  snapshotId: string;
  count: number;
}

const CHUNK = 5_000;

export async function curveOf(sql: Sql, guildId: string): Promise<LevelCurve> {
  const [row] = await sql<{ curve: string | null }[]>`
    select config->>'curve' as curve from guild_modules
    where guild_id = ${guildId} and module = 'levels'
  `;
  return parseCurve(row?.curve);
}

export async function levelOf(sql: Sql, guildId: string, userId: string): Promise<number> {
  const [row] = await sql<{ xp: number | null; curve: string | null }[]>`
    select
      (select xp::float8 from levels_members where guild_id = ${guildId} and user_id = ${userId}) as xp,
      (select config->>'curve' from guild_modules where guild_id = ${guildId} and module = 'levels') as curve
  `;
  return levelFromXp(row?.xp ?? 0, parseCurve(row?.curve)).level;
}

export class LevelStore {
  constructor(private readonly sql: Sql) {}

  async award(
    guildId: string,
    userId: string,
    gain: number,
    cooldownSeconds: number,
  ): Promise<number | null> {
    const [row] = await this.sql<{ xp: number }[]>`
      insert into levels_members as m (guild_id, user_id, xp, last_xp_at)
      values (${guildId}, ${userId}, ${gain}, now())
      on conflict (guild_id, user_id) do update
        set xp = m.xp + excluded.xp, last_xp_at = now(), updated_at = now()
        where m.last_xp_at is null
          or m.last_xp_at <= now() - make_interval(secs => ${cooldownSeconds})
      returning xp::float8 as xp
    `;
    return row?.xp ?? null;
  }

  async xp(guildId: string, userId: string): Promise<number> {
    const [row] = await this.sql<{ xp: number }[]>`
      select xp::float8 as xp from levels_members where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.xp ?? 0;
  }

  async standing(guildId: string, userId: string): Promise<Standing | null> {
    const [row] = await this.sql<{ xp: number; rank: number }[]>`
      select me.xp::float8 as xp,
        (select count(*) from levels_members o where o.guild_id = me.guild_id and o.xp > me.xp)::int + 1 as rank
      from levels_members me
      where me.guild_id = ${guildId} and me.user_id = ${userId} and me.xp > 0
    `;
    return row ? { userId, xp: row.xp, rank: row.rank } : null;
  }

  async ranked(guildId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from levels_members where guild_id = ${guildId} and xp > 0
    `;
    return row?.count ?? 0;
  }

  async leaderboard(guildId: string, limit = 10, offset = 0): Promise<Standing[]> {
    const rows = await this.sql<{ userId: string; xp: number }[]>`
      select user_id::text as "userId", xp::float8 as xp
      from levels_members
      where guild_id = ${guildId} and xp > 0
      order by xp desc, user_id
      limit ${Math.min(Math.max(limit, 1), 100)} offset ${Math.max(offset, 0)}
    `;
    return rows.map((row, i) => ({ ...row, rank: offset + i + 1 }));
  }

  async set(guildId: string, userId: string, xp: number): Promise<number> {
    const [row] = await this.sql<{ before: number | null }[]>`
      with prev as (
        select xp from levels_members where guild_id = ${guildId} and user_id = ${userId}
      )
      insert into levels_members (guild_id, user_id, xp)
      values (${guildId}, ${userId}, ${Math.max(0, Math.floor(xp))})
      on conflict (guild_id, user_id) do update set xp = excluded.xp, updated_at = now()
      returning (select xp::float8 from prev) as before
    `;
    return row?.before ?? 0;
  }

  async add(
    guildId: string,
    userId: string,
    delta: number,
  ): Promise<{ before: number; after: number }> {
    const step = Math.trunc(delta);
    const [row] = await this.sql<{ before: number | null; after: number }[]>`
      with prev as (
        select xp from levels_members where guild_id = ${guildId} and user_id = ${userId}
      )
      insert into levels_members as m (guild_id, user_id, xp)
      values (${guildId}, ${userId}, greatest(0, ${step}::bigint))
      on conflict (guild_id, user_id) do update
        set xp = greatest(0, m.xp + ${step}::bigint), updated_at = now()
      returning xp::float8 as after, (select xp::float8 from prev) as before
    `;
    return { before: row?.before ?? 0, after: row?.after ?? 0 };
  }

  async remove(guildId: string, userId: string): Promise<number> {
    const [row] = await this.sql<{ xp: number }[]>`
      delete from levels_members where guild_id = ${guildId} and user_id = ${userId}
      returning xp::float8 as xp
    `;
    return row?.xp ?? 0;
  }

  async importEntries(
    guildId: string,
    entries: readonly XpEntry[],
    mode: ImportMode = 'replace',
  ): Promise<SnapshotResult> {
    const unique = [...new Map(entries.map((entry) => [entry.userId, entry])).values()];
    return this.sql.begin(async (tx) => {
      const [snapshot] = await tx<{ id: string }[]>`
        insert into levels_snapshots (guild_id, kind, row_count)
        values (${guildId}, 'import', ${unique.length})
        returning id
      `;
      const snapshotId = snapshot?.id ?? '';
      for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK);
        const ids = chunk.map((entry) => entry.userId);
        const values = chunk.map((entry) => String(Math.max(0, Math.floor(entry.xp))));
        await tx`
          insert into levels_snapshot_rows (snapshot_id, user_id, xp)
          select ${snapshotId}, u.id, m.xp
          from unnest(${ids}::bigint[]) as u (id)
          left join levels_members m on m.guild_id = ${guildId} and m.user_id = u.id
          on conflict do nothing
        `;
        const merge =
          mode === 'add'
            ? tx`levels_members.xp + excluded.xp`
            : mode === 'max'
              ? tx`greatest(levels_members.xp, excluded.xp)`
              : tx`excluded.xp`;
        await tx`
          insert into levels_members (guild_id, user_id, xp)
          select ${guildId}, u.id, u.xp
          from unnest(${ids}::bigint[], ${values}::bigint[]) as u (id, xp)
          on conflict (guild_id, user_id) do update set xp = ${merge}, updated_at = now()
        `;
      }
      return { snapshotId, count: unique.length };
    });
  }

  async resetAll(guildId: string): Promise<SnapshotResult> {
    return this.sql.begin(async (tx) => {
      const [snapshot] = await tx<{ id: string }[]>`
        insert into levels_snapshots (guild_id, kind, row_count)
        values (${guildId}, 'reset', (select count(*) from levels_members where guild_id = ${guildId}))
        returning id
      `;
      const snapshotId = snapshot?.id ?? '';
      await tx`
        insert into levels_snapshot_rows (snapshot_id, user_id, xp)
        select ${snapshotId}, user_id, xp from levels_members where guild_id = ${guildId}
      `;
      const removed = await tx`delete from levels_members where guild_id = ${guildId} returning 1`;
      return { snapshotId, count: removed.length };
    });
  }

  async restore(guildId: string, snapshotId: string): Promise<number> {
    if (!/^\d{1,19}$/.test(snapshotId)) return 0;
    return this.sql.begin(async (tx) => {
      const [snapshot] = await tx<{ id: string }[]>`
        select id from levels_snapshots where id = ${snapshotId} and guild_id = ${guildId}
      `;
      if (!snapshot) return 0;
      await tx`
        delete from levels_members m
        using levels_snapshot_rows r
        where r.snapshot_id = ${snapshotId} and r.xp is null
          and m.guild_id = ${guildId} and m.user_id = r.user_id
      `;
      const restored = await tx`
        insert into levels_members (guild_id, user_id, xp)
        select ${guildId}, user_id, xp from levels_snapshot_rows
        where snapshot_id = ${snapshotId} and xp is not null
        on conflict (guild_id, user_id) do update set xp = excluded.xp, updated_at = now()
        returning 1
      `;
      await tx`delete from levels_snapshots where id = ${snapshotId}`;
      return restored.length;
    });
  }

  async levelCounts(guildId: string, curve: LevelCurve): Promise<Record<number, number>> {
    const thresholds: string[] = [];
    for (let level = 1; level <= MAX_LEVEL; level++) {
      thresholds.push(String(totalXpForLevel(level, curve)));
    }
    const rows = await this.sql<{ level: number; count: number }[]>`
      select width_bucket(xp, ${thresholds}::bigint[])::int as level, count(*)::int as count
      from levels_members
      where guild_id = ${guildId} and xp > 0
      group by 1
    `;
    const out: Record<number, number> = {};
    for (const row of rows) if (row.level > 0) out[row.level] = row.count;
    return out;
  }

  async lastImport(guildId: string): Promise<{ rows: number; at: Date } | null> {
    const [row] = await this.sql<{ rows: number | null; at: Date }[]>`
      select (after->>'rows')::int as rows, created_at as at
      from audit_entries
      where guild_id = ${guildId} and module = 'levels' and action = 'xp.import'
        and undone_at is null
      order by id desc
      limit 1
    `;
    return row ? { rows: row.rows ?? 0, at: row.at } : null;
  }

  async asset(guildId: string, key: string): Promise<Uint8Array | null> {
    const [row] = await this.sql<{ data: Uint8Array }[]>`
      select data from guild_assets where guild_id = ${guildId} and key = ${key}
    `;
    return row?.data ?? null;
  }

  async memberData(
    guildId: string,
    userId: string,
  ): Promise<{ xp: number; rank: number | null; lastXpAt: Date | null } | null> {
    const [row] = await this.sql<{ xp: number; lastXpAt: Date | null }[]>`
      select xp::float8 as xp, last_xp_at as "lastXpAt" from levels_members
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    if (!row) return null;
    const standing = await this.standing(guildId, userId);
    return { xp: row.xp, rank: standing?.rank ?? null, lastXpAt: row.lastXpAt };
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from levels_members where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`
        delete from levels_snapshot_rows r
        using levels_snapshots s
        where s.id = r.snapshot_id and s.guild_id = ${guildId} and r.user_id = ${userId}
      `;
    });
  }

  async pruneSnapshots(before: Date): Promise<number> {
    const rows = await this.sql`
      delete from levels_snapshots where created_at < ${before} returning 1
    `;
    return rows.length;
  }
}
