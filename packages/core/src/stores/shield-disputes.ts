import type { Sql } from '../db/sql.js';
import type { ShieldSource } from '../modules/security.js';
import { participates, type ShieldReport } from './shield.js';

export const DISPUTE_MIN = 20;
export const DISPUTE_MAX = 2_000;
export const DISPUTE_NOTE_MAX = 500;
export const DISPUTE_WAIT_DAYS = 30;

const DAY = 86_400_000;

export type DisputeStatus = 'open' | 'removed' | 'kept';
export type DisputeAction = 'remove' | 'keep';

export interface ShieldDispute {
  id: string;
  userId: string;
  body: string;
  status: DisputeStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ListingEntry {
  source: ShieldSource;
  createdAt: Date;
  expiresAt: Date;
}

export interface DisputeRecord {
  guildId: string;
  source: ShieldSource;
  reportedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface DisputeDecision {
  id: string;
  disputeId: string;
  userId: string;
  action: Exclude<DisputeStatus, 'open'>;
  operatorId: string;
  note: string | null;
  records: DisputeRecord[];
  createdAt: Date;
}

export type DisputeEligibility =
  | { kind: 'open'; dispute: ShieldDispute }
  | { kind: 'not-listed'; last: ShieldDispute | null }
  | { kind: 'wait'; until: Date; last: ShieldDispute }
  | { kind: 'ready'; last: ShieldDispute | null };

export type FileResult =
  | { kind: 'created'; dispute: ShieldDispute }
  | Exclude<DisputeEligibility, { kind: 'ready' }>;

export type DecisionCheck =
  | { ok: true; status: Exclude<DisputeStatus, 'open'>; note: string | null }
  | { ok: false; error: 'closed' | 'note' };

export type DecideResult =
  | { kind: 'decided'; dispute: ShieldDispute; removed: number }
  | { kind: 'missing' }
  | { kind: 'closed' }
  | { kind: 'note' };

export function disputeEligibility(
  listing: readonly ListingEntry[],
  last: ShieldDispute | null,
  now = Date.now(),
): DisputeEligibility {
  if (last?.status === 'open') return { kind: 'open', dispute: last };
  if (listing.length === 0) return { kind: 'not-listed', last };
  if (last?.decidedAt) {
    const decided = last.decidedAt.getTime();
    const until = decided + DISPUTE_WAIT_DAYS * DAY;
    const newer = listing.some((entry) => entry.createdAt.getTime() > decided);
    if (until > now && !newer) return { kind: 'wait', until: new Date(until), last };
  }
  return { kind: 'ready', last };
}

export function checkDecision(
  dispute: Pick<ShieldDispute, 'status'>,
  action: DisputeAction,
  note: string | null,
): DecisionCheck {
  if (dispute.status !== 'open') return { ok: false, error: 'closed' };
  const text = note?.trim() ?? '';
  if (text.length > DISPUTE_NOTE_MAX) return { ok: false, error: 'note' };
  if (action === 'keep' && text.length === 0) return { ok: false, error: 'note' };
  return { ok: true, status: action === 'remove' ? 'removed' : 'kept', note: text || null };
}

const columns = (sql: Sql) => sql`
  id::text, user_id::text as "userId", body, status, note, decided_by::text as "decidedBy",
  decided_at as "decidedAt", created_at as "createdAt"
`;

const decisionColumns = (sql: Sql) => sql`
  id::text, dispute_id::text as "disputeId", user_id::text as "userId", action,
  operator_id::text as "operatorId", note, records, created_at as "createdAt"
`;

function snapshot(rows: readonly ShieldReport[]): DisputeRecord[] {
  return rows.map((row) => ({
    guildId: row.guildId,
    source: row.source,
    reportedBy: row.reportedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export class ShieldDisputeStore {
  constructor(private readonly sql: Sql) {}

  async listing(userId: string, now = Date.now()): Promise<ListingEntry[]> {
    return this.sql<ListingEntry[]>`
      select r.source, r.created_at as "createdAt", r.expires_at as "expiresAt"
      from security_shield_reports r
      where r.user_id = ${userId} and r.expires_at > ${new Date(now)}
        and ${participates(this.sql, this.sql`r.guild_id`)}
      order by r.created_at desc
    `;
  }

  async records(userId: string, now = Date.now()): Promise<ShieldReport[]> {
    return this.sql<ShieldReport[]>`
      select r.guild_id::text as "guildId", r.user_id::text as "userId", r.source,
        r.reported_by::text as "reportedBy", r.created_at as "createdAt", r.expires_at as "expiresAt"
      from security_shield_reports r
      where r.user_id = ${userId} and r.expires_at > ${new Date(now)}
      order by r.created_at desc
    `;
  }

  async latest(userId: string): Promise<ShieldDispute | null> {
    const [row] = await this.sql<ShieldDispute[]>`
      select ${columns(this.sql)} from security_shield_disputes
      where user_id = ${userId}
      order by created_at desc, id desc limit 1
    `;
    return row ?? null;
  }

  async get(id: string): Promise<ShieldDispute | null> {
    if (!/^\d{1,19}$/.test(id)) return null;
    const [row] = await this.sql<ShieldDispute[]>`
      select ${columns(this.sql)} from security_shield_disputes where id = ${id}
    `;
    return row ?? null;
  }

  async eligibility(userId: string, now = Date.now()): Promise<DisputeEligibility> {
    const [listing, last] = await Promise.all([this.listing(userId, now), this.latest(userId)]);
    return disputeEligibility(listing, last, now);
  }

  async file(userId: string, body: string, now = Date.now()): Promise<FileResult> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`security.shield.dispute:${userId}`}))`;
      const listing = await tx<ListingEntry[]>`
        select r.source, r.created_at as "createdAt", r.expires_at as "expiresAt"
        from security_shield_reports r
        where r.user_id = ${userId} and r.expires_at > ${new Date(now)}
          and ${participates(this.sql, this.sql`r.guild_id`)}
      `;
      const [last] = await tx<ShieldDispute[]>`
        select ${columns(this.sql)} from security_shield_disputes
        where user_id = ${userId}
        order by created_at desc, id desc limit 1
      `;
      const state = disputeEligibility(listing, last ?? null, now);
      if (state.kind !== 'ready') return state;
      const [dispute] = await tx<ShieldDispute[]>`
        insert into security_shield_disputes (user_id, body, created_at)
        values (${userId}, ${body}, ${new Date(now)})
        returning ${columns(this.sql)}
      `;
      return { kind: 'created', dispute: dispute as ShieldDispute };
    });
  }

  async open(limit = 100): Promise<ShieldDispute[]> {
    return this.sql<ShieldDispute[]>`
      select ${columns(this.sql)} from security_shield_disputes
      where status = 'open'
      order by created_at asc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `;
  }

  async decide(
    id: string,
    operatorId: string,
    action: DisputeAction,
    note: string | null,
    now = Date.now(),
  ): Promise<DecideResult> {
    if (!/^\d{1,19}$/.test(id)) return { kind: 'missing' };
    return this.sql.begin(async (tx) => {
      const [current] = await tx<ShieldDispute[]>`
        select ${columns(this.sql)} from security_shield_disputes where id = ${id} for update
      `;
      if (!current) return { kind: 'missing' };
      const check = checkDecision(current, action, note);
      if (!check.ok) return { kind: check.error };
      const rows =
        check.status === 'removed'
          ? await tx<ShieldReport[]>`
              delete from security_shield_reports where user_id = ${current.userId}
              returning guild_id::text as "guildId", user_id::text as "userId", source,
                reported_by::text as "reportedBy", created_at as "createdAt",
                expires_at as "expiresAt"
            `
          : await tx<ShieldReport[]>`
              select guild_id::text as "guildId", user_id::text as "userId", source,
                reported_by::text as "reportedBy", created_at as "createdAt",
                expires_at as "expiresAt"
              from security_shield_reports where user_id = ${current.userId}
            `;
      const [dispute] = await tx<ShieldDispute[]>`
        update security_shield_disputes
        set status = ${check.status}, note = ${check.note}, decided_by = ${operatorId},
          decided_at = ${new Date(now)}
        where id = ${id}
        returning ${columns(this.sql)}
      `;
      await tx`
        insert into security_shield_decisions
          (dispute_id, user_id, action, operator_id, note, records, created_at)
        values (${id}, ${current.userId}, ${check.status}, ${operatorId}, ${check.note},
          ${tx.json(snapshot(rows) as never)}, ${new Date(now)})
      `;
      return {
        kind: 'decided',
        dispute: dispute as ShieldDispute,
        removed: check.status === 'removed' ? rows.length : 0,
      };
    });
  }

  async decisions(limit = 50): Promise<DisputeDecision[]> {
    return this.sql<DisputeDecision[]>`
      select ${decisionColumns(this.sql)} from security_shield_decisions
      order by created_at desc, id desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `;
  }
}
