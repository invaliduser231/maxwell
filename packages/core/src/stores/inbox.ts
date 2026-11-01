import type { TransactionSql } from 'postgres';
import { openText, sealText } from '../crypto/data.js';
import type { Sql } from '../db/sql.js';
import type { InboxKind, InboxStatus } from '../modules/moderation.js';

export interface InboxItem {
  id: string;
  guildId: string;
  number: number;
  kind: InboxKind;
  status: InboxStatus;
  subjectId: string | null;
  reporters: string[];
  channelId: string | null;
  messageId: string | null;
  excerpt: string | null;
  body: string | null;
  caseNumber: number | null;
  refId: string | null;
  assigneeId: string | null;
  outcome: string | null;
  outcomeCase: number | null;
  note: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  noticeChannelId: string | null;
  noticeMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportInput {
  guildId: string;
  subjectId: string;
  reporterId: string;
  channelId: string | null;
  messageId: string | null;
  excerpt: string | null;
  body: string | null;
}

export type ReportResult =
  | { kind: 'created'; item: InboxItem }
  | { kind: 'added'; item: InboxItem }
  | { kind: 'already'; item: InboxItem };

export interface AppealInput {
  guildId: string;
  subjectId: string;
  body: string;
  caseNumber: number | null;
}

export type AppealResult =
  | { kind: 'created'; item: InboxItem }
  | { kind: 'open'; item: InboxItem }
  | { kind: 'wait'; until: Date };

export interface InboxFilter {
  status?: 'active' | 'closed' | InboxStatus;
  kind?: InboxKind;
  assigneeId?: string;
  subjectId?: string;
  before?: number;
  limit?: number;
}

export interface InboxCounts {
  open: number;
  claimed: number;
  mine: number;
}

export interface InboxChange {
  before: InboxItem;
  after: InboxItem;
}

export interface Resolution {
  status: 'resolved' | 'dismissed';
  by: string | null;
  outcome: string | null;
  outcomeCase: number | null;
  note: string | null;
}

export type InboxState = Pick<
  InboxItem,
  | 'number'
  | 'status'
  | 'assigneeId'
  | 'outcome'
  | 'outcomeCase'
  | 'note'
  | 'resolvedBy'
  | 'resolvedAt'
>;

export const ACTIVE: readonly InboxStatus[] = ['open', 'claimed'];
export const APPEAL_WAIT_DAYS = 30;

const DAY = 86_400_000;

const columns = (sql: Sql) => sql`
  id::text, guild_id::text as "guildId", number, kind, status, subject_id::text as "subjectId",
  reporters::text[] as reporters, channel_id::text as "channelId",
  message_id::text as "messageId", excerpt, body, case_number as "caseNumber",
  ref_id::text as "refId",
  assignee_id::text as "assigneeId", outcome, outcome_case as "outcomeCase", note,
  resolved_by::text as "resolvedBy", resolved_at as "resolvedAt",
  notice_channel_id::text as "noticeChannelId", notice_message_id::text as "noticeMessageId",
  created_at as "createdAt", updated_at as "updatedAt"
`;

function openItem(row: InboxItem): InboxItem {
  return {
    ...row,
    excerpt: openText(row.guildId, row.excerpt),
    body: openText(row.guildId, row.body),
    note: openText(row.guildId, row.note),
  };
}

function validNumber(number: number): boolean {
  return Number.isSafeInteger(number) && number >= 1 && number <= 2_147_483_647;
}

export class InboxStore {
  constructor(private readonly sql: Sql) {}

  async report(input: ReportInput): Promise<ReportResult> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`moderation.inbox:${input.guildId}`}))`;
      const [open] = input.messageId
        ? await tx<InboxItem[]>`
            select ${columns(this.sql)} from moderation_inbox
            where guild_id = ${input.guildId} and kind = 'report' and status in ('open', 'claimed')
              and message_id = ${input.messageId}
            limit 1
          `
        : await tx<InboxItem[]>`
            select ${columns(this.sql)} from moderation_inbox
            where guild_id = ${input.guildId} and kind = 'report' and status in ('open', 'claimed')
              and subject_id = ${input.subjectId} and message_id is null
            limit 1
          `;
      if (open) {
        if (open.reporters.includes(input.reporterId)) {
          return { kind: 'already', item: openItem(open) };
        }
        const previous = openText(input.guildId, open.body);
        const body =
          input.body === null
            ? open.body
            : sealText(
                input.guildId,
                previous === null ? input.body : `${previous}\n${input.body}`,
              );
        const [item] = await tx<InboxItem[]>`
          update moderation_inbox
          set reporters = array_append(reporters, ${input.reporterId}::bigint),
            body = ${body},
            updated_at = now()
          where id = ${open.id}
          returning ${columns(this.sql)}
        `;
        if (!item) throw new Error('inbox update returned nothing');
        return { kind: 'added', item: openItem(item) };
      }
      const item = await this.#insert(tx, input.guildId, {
        kind: 'report',
        subject_id: input.subjectId,
        reporters: [input.reporterId],
        channel_id: input.channelId,
        message_id: input.messageId,
        excerpt: input.excerpt,
        body: input.body,
      });
      return { kind: 'created', item };
    });
  }

  async appeal(input: AppealInput, now = Date.now()): Promise<AppealResult> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`moderation.inbox:${input.guildId}`}))`;
      const [last] = await tx<InboxItem[]>`
        select ${columns(this.sql)} from moderation_inbox
        where guild_id = ${input.guildId} and kind = 'appeal' and subject_id = ${input.subjectId}
        order by created_at desc limit 1
      `;
      if (last && ACTIVE.includes(last.status)) return { kind: 'open', item: openItem(last) };
      if (last?.resolvedAt) {
        const until = new Date(last.resolvedAt.getTime() + APPEAL_WAIT_DAYS * DAY);
        if (until.getTime() > now) return { kind: 'wait', until };
      }
      const item = await this.#insert(tx, input.guildId, {
        kind: 'appeal',
        subject_id: input.subjectId,
        body: input.body,
        case_number: input.caseNumber,
      });
      return { kind: 'created', item };
    });
  }

  async review(
    guildId: string,
    subjectId: string,
    caseNumber: number,
    body: string | null,
  ): Promise<InboxItem | null> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`moderation.inbox:${guildId}`}))`;
      const [existing] = await tx`
        select 1 from moderation_inbox
        where guild_id = ${guildId} and kind = 'review' and case_number = ${caseNumber}
      `;
      if (existing) return null;
      return this.#insert(tx, guildId, {
        kind: 'review',
        subject_id: subjectId,
        case_number: caseNumber,
        body,
      });
    });
  }

  async openGate(guildId: string, body: string): Promise<{ item: InboxItem; created: boolean }> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`moderation.inbox:${guildId}`}))`;
      const [open] = await tx<InboxItem[]>`
        update moderation_inbox set body = ${sealText(guildId, body)}, updated_at = now()
        where guild_id = ${guildId} and kind = 'gate' and status in ('open', 'claimed')
        returning ${columns(this.sql)}
      `;
      if (open) return { item: openItem(open), created: false };
      const item = await this.#insert(tx, guildId, { kind: 'gate', subject_id: null, body });
      return { item, created: true };
    });
  }

  async closeGate(guildId: string, outcome: string, by: string | null): Promise<InboxItem | null> {
    const [row] = await this.sql<InboxItem[]>`
      update moderation_inbox
      set status = 'resolved', outcome = ${outcome}, resolved_by = ${by}, resolved_at = now(),
        updated_at = now()
      where guild_id = ${guildId} and kind = 'gate' and status in ('open', 'claimed')
      returning ${columns(this.sql)}
    `;
    return row ? openItem(row) : null;
  }

  async openCheck(
    guildId: string,
    userId: string,
    checkId: string,
    body: string,
  ): Promise<InboxItem | null> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`moderation.inbox:${guildId}`}))`;
      const [existing] = await tx`
        select 1 from moderation_inbox
        where guild_id = ${guildId} and kind = 'check' and ref_id = ${checkId}
      `;
      if (existing) return null;
      return this.#insert(tx, guildId, {
        kind: 'check',
        subject_id: userId,
        ref_id: checkId,
        body,
      });
    });
  }

  async closeCheck(
    guildId: string,
    checkId: string,
    outcome: string,
    by: string | null,
  ): Promise<InboxItem | null> {
    const [row] = await this.sql<InboxItem[]>`
      update moderation_inbox
      set status = 'resolved', outcome = ${outcome}, resolved_by = ${by}, resolved_at = now(),
        updated_at = now()
      where guild_id = ${guildId} and kind = 'check' and ref_id = ${checkId}
        and status in ('open', 'claimed')
      returning ${columns(this.sql)}
    `;
    return row ? openItem(row) : null;
  }

  async closeChecksFor(
    guildId: string,
    userId: string,
    outcome: string,
    by: string | null,
  ): Promise<InboxItem[]> {
    return this.sql<InboxItem[]>`
      update moderation_inbox
      set status = 'resolved', outcome = ${outcome}, resolved_by = ${by}, resolved_at = now(),
        updated_at = now()
      where guild_id = ${guildId} and kind = 'check' and subject_id = ${userId}
        and status in ('open', 'claimed')
      returning ${columns(this.sql)}
    `.then((rows) => rows.map(openItem));
  }

  async get(guildId: string, number: number): Promise<InboxItem | null> {
    if (!validNumber(number)) return null;
    const [row] = await this.sql<InboxItem[]>`
      select ${columns(this.sql)} from moderation_inbox
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ? openItem(row) : null;
  }

  async reviewFor(guildId: string, caseNumber: number): Promise<InboxItem | null> {
    const [row] = await this.sql<InboxItem[]>`
      select ${columns(this.sql)} from moderation_inbox
      where guild_id = ${guildId} and kind = 'review' and case_number = ${caseNumber}
    `;
    return row ? openItem(row) : null;
  }

  async latestAppeal(guildId: string, userId: string): Promise<InboxItem | null> {
    const [row] = await this.sql<InboxItem[]>`
      select ${columns(this.sql)} from moderation_inbox
      where guild_id = ${guildId} and kind = 'appeal' and subject_id = ${userId}
      order by created_at desc limit 1
    `;
    return row ? openItem(row) : null;
  }

  async list(guildId: string, filter: InboxFilter = {}): Promise<InboxItem[]> {
    const status = filter.status ?? 'active';
    const statuses: readonly string[] =
      status === 'active' ? ACTIVE : status === 'closed' ? ['resolved', 'dismissed'] : [status];
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return this.sql<InboxItem[]>`
      select ${columns(this.sql)} from moderation_inbox
      where guild_id = ${guildId}
        and status = any(${statuses as string[]}::text[])
        ${filter.kind ? this.sql`and kind = ${filter.kind}` : this.sql``}
        ${filter.assigneeId ? this.sql`and assignee_id = ${filter.assigneeId}` : this.sql``}
        ${filter.subjectId ? this.sql`and subject_id = ${filter.subjectId}` : this.sql``}
        ${filter.before ? this.sql`and number < ${filter.before}` : this.sql``}
      order by number desc
      limit ${limit}
    `.then((rows) => rows.map(openItem));
  }

  async counts(guildId: string, userId: string | null = null): Promise<InboxCounts> {
    const [row] = await this.sql<InboxCounts[]>`
      select
        count(*) filter (where status = 'open')::int as open,
        count(*) filter (where status = 'claimed')::int as claimed,
        count(*) filter (where status = 'claimed' and assignee_id = ${userId})::int as mine
      from moderation_inbox
      where guild_id = ${guildId} and status in ('open', 'claimed')
    `;
    return row ?? { open: 0, claimed: 0, mine: 0 };
  }

  async assign(
    guildId: string,
    number: number,
    assigneeId: string | null,
  ): Promise<InboxChange | null> {
    return this.#change(
      guildId,
      number,
      (tx, id) => tx<InboxItem[]>`
        update moderation_inbox
        set assignee_id = ${assigneeId},
          status = case when ${assigneeId}::bigint is null then 'open' else 'claimed' end,
          updated_at = now()
        where id = ${id} and status in ('open', 'claimed')
        returning ${columns(this.sql)}
      `,
    );
  }

  async resolve(
    guildId: string,
    number: number,
    resolution: Resolution,
  ): Promise<InboxChange | null> {
    return this.#change(
      guildId,
      number,
      (tx, id) => tx<InboxItem[]>`
        update moderation_inbox
        set status = ${resolution.status}, outcome = ${resolution.outcome},
          outcome_case = ${resolution.outcomeCase}, note = ${sealText(guildId, resolution.note)},
          resolved_by = ${resolution.by}, resolved_at = now(),
          assignee_id = coalesce(assignee_id, ${resolution.by}), updated_at = now()
        where id = ${id} and status in ('open', 'claimed')
        returning ${columns(this.sql)}
      `,
    );
  }

  async restore(guildId: string, previous: InboxState): Promise<InboxItem | null> {
    const [row] = await this.sql<InboxItem[]>`
      update moderation_inbox
      set status = ${previous.status}, assignee_id = ${previous.assigneeId},
        outcome = ${previous.outcome}, outcome_case = ${previous.outcomeCase},
        note = ${sealText(guildId, previous.note)}, resolved_by = ${previous.resolvedBy},
        resolved_at = ${previous.resolvedAt}, updated_at = now()
      where guild_id = ${guildId} and number = ${previous.number}
      returning ${columns(this.sql)}
    `;
    return row ? openItem(row) : null;
  }

  async setNotice(
    guildId: string,
    number: number,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.sql`
      update moderation_inbox set notice_channel_id = ${channelId}, notice_message_id = ${messageId}
      where guild_id = ${guildId} and number = ${number}
    `;
  }

  async memberData(
    guildId: string,
    userId: string,
  ): Promise<{ about: InboxItem[]; reported: InboxItem[] }> {
    const rows = await this.sql<InboxItem[]>`
      select ${columns(this.sql)} from moderation_inbox
      where guild_id = ${guildId} and (subject_id = ${userId} or ${userId}::bigint = any(reporters))
      order by number
    `;
    const items = rows.map(openItem);
    return {
      about: items.filter((row) => row.subjectId === userId && row.kind === 'appeal'),
      reported: items.filter((row) => row.reporters.includes(userId)),
    };
  }

  async forget(guildId: string, userId: string): Promise<number> {
    return this.sql.begin(async (tx) => {
      const removed = await tx`
        delete from moderation_inbox
        where guild_id = ${guildId} and kind = 'appeal' and subject_id = ${userId}
          and status in ('resolved', 'dismissed')
        returning id
      `;
      await tx`
        update moderation_inbox set reporters = array_remove(reporters, ${userId}::bigint)
        where guild_id = ${guildId} and ${userId}::bigint = any(reporters)
      `;
      return removed.length;
    });
  }

  async #change(
    guildId: string,
    number: number,
    update: (tx: TransactionSql, id: string) => Promise<InboxItem[]>,
  ): Promise<InboxChange | null> {
    if (!validNumber(number)) return null;
    return this.sql.begin(async (tx) => {
      const [before] = await tx<InboxItem[]>`
        select ${columns(this.sql)} from moderation_inbox
        where guild_id = ${guildId} and number = ${number}
        for update
      `;
      if (!before) return null;
      const [after] = await update(tx, before.id);
      return after ? { before: openItem(before), after: openItem(after) } : null;
    });
  }

  async #insert(
    tx: TransactionSql,
    guildId: string,
    values: {
      kind: InboxKind;
      subject_id: string | null;
      reporters?: string[];
      channel_id?: string | null;
      message_id?: string | null;
      excerpt?: string | null;
      body?: string | null;
      case_number?: number | null;
      ref_id?: string | null;
    },
  ): Promise<InboxItem> {
    const [row] = await tx<InboxItem[]>`
      insert into moderation_inbox (
        guild_id, number, kind, subject_id, reporters, channel_id, message_id, excerpt, body,
        case_number, ref_id
      ) values (
        ${guildId},
        (select coalesce(max(number), 0) + 1 from moderation_inbox where guild_id = ${guildId}),
        ${values.kind}, ${values.subject_id}, ${values.reporters ?? []}::bigint[],
        ${values.channel_id ?? null}, ${values.message_id ?? null}, ${sealText(guildId, values.excerpt ?? null)},
        ${sealText(guildId, values.body ?? null)}, ${values.case_number ?? null}, ${values.ref_id ?? null}
      )
      returning ${columns(this.sql)}
    `;
    if (!row) throw new Error('inbox insert returned nothing');
    return openItem(row);
  }
}
