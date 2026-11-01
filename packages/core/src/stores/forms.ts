import { openJson, openText, sealJson, sealText } from '../crypto/data.js';
import type { Sql } from '../db/sql.js';

export type FormAnswerValue = string | number | boolean;
export type FormSessionMode = 'dm' | 'channel';
export type SubmissionStatus = 'pending' | 'accepted' | 'declined';
export type FormVote = 'accept' | 'decline';

export interface FormSession {
  id: string;
  guildId: string;
  formId: string;
  userId: string;
  mode: FormSessionMode;
  channelId: string | null;
  questionId: string | null;
  answers: Record<string, FormAnswerValue | null>;
  startedAt: Date;
  expiresAt: Date;
}

export interface SubmittedAnswer {
  questionId: string;
  label: string;
  type: string;
  value: FormAnswerValue | null;
  display: string;
}

export interface AppliedActions {
  addedRoleIds: string[];
  removedRoleIds: string[];
  ticketId: string | null;
  dmSent: boolean;
}

export interface FormSubmission {
  id: string;
  number: number;
  guildId: string;
  formId: string;
  formName: string;
  userId: string;
  answers: SubmittedAnswer[];
  status: SubmissionStatus;
  reviewChannelId: string | null;
  reviewMessageId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  applied: AppliedActions | null;
  createdAt: Date;
}

export interface VoteTally {
  accept: number;
  decline: number;
}

function sessionColumns(sql: Sql) {
  return sql`
    id, guild_id as "guildId", form_id as "formId", user_id as "userId", mode,
    channel_id as "channelId", question_id as "questionId", answers,
    started_at as "startedAt", expires_at as "expiresAt"
  `;
}

function submissionColumns(sql: Sql) {
  return sql`
    id, number, guild_id as "guildId", form_id as "formId", form_name as "formName", user_id as "userId",
    answers, status, review_channel_id as "reviewChannelId",
    review_message_id as "reviewMessageId", decided_by as "decidedBy", decided_at as "decidedAt",
    note, applied, created_at as "createdAt"
  `;
}

function openSession(row: FormSession): FormSession {
  return { ...row, answers: openJson<FormSession['answers']>(row.guildId, row.answers, {}) };
}

function openSubmission(row: FormSubmission): FormSubmission {
  return {
    ...row,
    answers: openJson<SubmittedAnswer[]>(row.guildId, row.answers, []),
    note: openText(row.guildId, row.note),
  };
}

export class FormStore {
  constructor(private readonly sql: Sql) {}

  async startSession(input: {
    guildId: string;
    formId: string;
    userId: string;
    mode: FormSessionMode;
    channelId: string | null;
    questionId: string | null;
    expiresAt: Date;
  }): Promise<FormSession | null> {
    const [row] = await this.sql<FormSession[]>`
      insert into forms_sessions (guild_id, form_id, user_id, mode, channel_id, question_id, expires_at)
      values (
        ${input.guildId}, ${input.formId}, ${input.userId}, ${input.mode}, ${input.channelId},
        ${input.questionId}, ${input.expiresAt}
      )
      on conflict (user_id) do nothing
      returning ${sessionColumns(this.sql)}
    `;
    return row ? openSession(row) : null;
  }

  async session(userId: string): Promise<FormSession | null> {
    const [row] = await this.sql<FormSession[]>`
      select ${sessionColumns(this.sql)} from forms_sessions where user_id = ${userId}
    `;
    return row ? openSession(row) : null;
  }

  async sessionById(id: string): Promise<FormSession | null> {
    const [row] = await this.sql<FormSession[]>`
      select ${sessionColumns(this.sql)} from forms_sessions where id = ${id}
    `;
    return row ? openSession(row) : null;
  }

  async sessionByChannel(channelId: string): Promise<FormSession | null> {
    const [row] = await this.sql<FormSession[]>`
      select ${sessionColumns(this.sql)} from forms_sessions where channel_id = ${channelId}
    `;
    return row ? openSession(row) : null;
  }

  async activeSessions(limit = 10_000): Promise<FormSession[]> {
    return this.sql<FormSession[]>`
      select ${sessionColumns(this.sql)} from forms_sessions
      order by expires_at desc
      limit ${limit}
    `.then((rows) => rows.map(openSession));
  }

  async guildSessions(guildId: string): Promise<FormSession[]> {
    return this.sql<FormSession[]>`
      select ${sessionColumns(this.sql)} from forms_sessions
      where guild_id = ${guildId}
      order by started_at desc
    `.then((rows) => rows.map(openSession));
  }

  async saveProgress(
    id: string,
    questionId: string | null,
    answers: Record<string, FormAnswerValue | null>,
    expiresAt: Date,
  ): Promise<void> {
    const [session] = await this.sql<{ guildId: string }[]>`
      select guild_id::text as "guildId" from forms_sessions where id = ${id}
    `;
    if (!session) return;
    await this.sql`
      update forms_sessions set
        question_id = ${questionId},
        answers = ${this.sql.json(sealJson(session.guildId, answers) as never)},
        expires_at = ${expiresAt}
      where id = ${id}
    `;
  }

  async moveSessionToChannel(id: string, channelId: string): Promise<void> {
    await this.sql`
      update forms_sessions set mode = 'channel', channel_id = ${channelId} where id = ${id}
    `;
  }

  async endSession(id: string): Promise<FormSession | null> {
    const [row] = await this.sql<FormSession[]>`
      delete from forms_sessions where id = ${id}
      returning ${sessionColumns(this.sql)}
    `;
    return row ? openSession(row) : null;
  }

  async createSubmission(input: {
    guildId: string;
    formId: string;
    formName: string;
    userId: string;
    answers: SubmittedAnswer[];
  }): Promise<FormSubmission> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`forms.submissions:${input.guildId}`}))`;
      const [row] = await tx<FormSubmission[]>`
        insert into forms_submissions (guild_id, number, form_id, form_name, user_id, answers)
        values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from forms_submissions where guild_id = ${input.guildId}),
          ${input.formId}, ${input.formName}, ${input.userId},
          ${tx.json(sealJson(input.guildId, input.answers) as never)}
        )
        returning ${submissionColumns(tx as unknown as Sql)}
      `;
      if (!row) throw new Error('submission insert returned nothing');
      return openSubmission(row);
    });
  }

  async submitSession(
    sessionId: string,
    input: {
      guildId: string;
      formId: string;
      formName: string;
      userId: string;
      answers: SubmittedAnswer[];
    },
  ): Promise<FormSubmission | null> {
    return this.sql.begin(async (tx) => {
      const [ended] = await tx`delete from forms_sessions where id = ${sessionId} returning id`;
      if (!ended) return null;
      await tx`select pg_advisory_xact_lock(hashtext(${`forms.submissions:${input.guildId}`}))`;
      const [row] = await tx<FormSubmission[]>`
        insert into forms_submissions (guild_id, number, form_id, form_name, user_id, answers)
        values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from forms_submissions where guild_id = ${input.guildId}),
          ${input.formId}, ${input.formName}, ${input.userId},
          ${tx.json(sealJson(input.guildId, input.answers) as never)}
        )
        returning ${submissionColumns(tx as unknown as Sql)}
      `;
      if (!row) throw new Error('submission insert returned nothing');
      return openSubmission(row);
    });
  }

  async submission(id: string): Promise<FormSubmission | null> {
    const [row] = await this.sql<FormSubmission[]>`
      select ${submissionColumns(this.sql)} from forms_submissions where id = ${id}
    `;
    return row ? openSubmission(row) : null;
  }

  async submissionInGuild(guildId: string, id: string): Promise<FormSubmission | null> {
    const [row] = await this.sql<FormSubmission[]>`
      select ${submissionColumns(this.sql)} from forms_submissions
      where guild_id = ${guildId} and id = ${id}
    `;
    return row ? openSubmission(row) : null;
  }

  async submissionByNumber(guildId: string, number: number): Promise<FormSubmission | null> {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) return null;
    const [row] = await this.sql<FormSubmission[]>`
      select ${submissionColumns(this.sql)} from forms_submissions
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ? openSubmission(row) : null;
  }

  async byReviewMessage(messageId: string): Promise<FormSubmission | null> {
    const [row] = await this.sql<FormSubmission[]>`
      select ${submissionColumns(this.sql)} from forms_submissions
      where review_message_id = ${messageId}
    `;
    return row ? openSubmission(row) : null;
  }

  async setReviewMessage(id: string, channelId: string, messageId: string): Promise<void> {
    await this.sql`
      update forms_submissions set review_channel_id = ${channelId}, review_message_id = ${messageId}
      where id = ${id}
    `;
  }

  async list(
    guildId: string,
    options: {
      status?: SubmissionStatus;
      decided?: boolean;
      formId?: string;
      userId?: string;
      before?: string;
      limit?: number;
    } = {},
  ): Promise<FormSubmission[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.sql<FormSubmission[]>`
      select ${submissionColumns(this.sql)} from forms_submissions
      where guild_id = ${guildId}
        ${options.status ? this.sql`and status = ${options.status}` : this.sql``}
        ${options.decided ? this.sql`and status <> 'pending'` : this.sql``}
        ${options.formId ? this.sql`and form_id = ${options.formId}` : this.sql``}
        ${options.userId ? this.sql`and user_id = ${options.userId}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${limit}
    `.then((rows) => rows.map(openSubmission));
  }

  async counts(
    guildId: string,
  ): Promise<{ formId: string; status: SubmissionStatus; total: number }[]> {
    return this.sql<{ formId: string; status: SubmissionStatus; total: number }[]>`
      select form_id as "formId", status, count(*)::int as total
      from forms_submissions
      where guild_id = ${guildId}
      group by form_id, status
    `;
  }

  async history(
    guildId: string,
    formId: string,
    userId: string,
  ): Promise<{ total: number; accepted: number; pending: number; last: Date | null }> {
    const [row] = await this.sql<
      { total: number; accepted: number; pending: number; last: Date | null }[]
    >`
      select count(*)::int as total,
        count(*) filter (where status = 'accepted')::int as accepted,
        count(*) filter (where status = 'pending')::int as pending,
        max(created_at) as last
      from forms_submissions
      where guild_id = ${guildId} and form_id = ${formId} and user_id = ${userId}
    `;
    return row ?? { total: 0, accepted: 0, pending: 0, last: null };
  }

  async decide(
    id: string,
    status: Exclude<SubmissionStatus, 'pending'>,
    decidedBy: string | null,
    note: string | null,
  ): Promise<FormSubmission | null> {
    const [current] = await this.sql<{ guildId: string }[]>`
      select guild_id::text as "guildId" from forms_submissions where id = ${id}
    `;
    if (!current) return null;
    const [row] = await this.sql<FormSubmission[]>`
      update forms_submissions set
        status = ${status}, decided_by = ${decidedBy}, decided_at = now(),
        note = ${sealText(current.guildId, note)}
      where id = ${id} and status = 'pending'
      returning ${submissionColumns(this.sql)}
    `;
    return row ? openSubmission(row) : null;
  }

  async setApplied(id: string, applied: AppliedActions): Promise<void> {
    await this.sql`
      update forms_submissions set applied = ${this.sql.json(applied as never)} where id = ${id}
    `;
  }

  async reopen(id: string): Promise<FormSubmission | null> {
    const [row] = await this.sql<FormSubmission[]>`
      update forms_submissions set
        status = 'pending', decided_by = null, decided_at = null, note = null, applied = null
      where id = ${id} and status <> 'pending'
      returning ${submissionColumns(this.sql)}
    `;
    return row ? openSubmission(row) : null;
  }

  async vote(submissionId: string, userId: string, vote: FormVote): Promise<void> {
    await this.sql`
      insert into forms_votes (submission_id, user_id, vote)
      values (${submissionId}, ${userId}, ${vote})
      on conflict (submission_id, user_id) do update set vote = excluded.vote, created_at = now()
    `;
  }

  async unvote(submissionId: string, userId: string, vote: FormVote): Promise<boolean> {
    const rows = await this.sql`
      delete from forms_votes
      where submission_id = ${submissionId} and user_id = ${userId} and vote = ${vote}
      returning user_id
    `;
    return rows.length > 0;
  }

  async tally(submissionId: string): Promise<VoteTally> {
    const [row] = await this.sql<VoteTally[]>`
      select count(*) filter (where vote = 'accept')::int as accept,
        count(*) filter (where vote = 'decline')::int as decline
      from forms_votes where submission_id = ${submissionId}
    `;
    return row ?? { accept: 0, decline: 0 };
  }

  async votes(
    submissionId: string,
  ): Promise<{ userId: string; vote: FormVote; createdAt: Date }[]> {
    return this.sql<{ userId: string; vote: FormVote; createdAt: Date }[]>`
      select user_id as "userId", vote, created_at as "createdAt"
      from forms_votes where submission_id = ${submissionId}
      order by created_at
    `;
  }

  async votesFor(
    submissionIds: readonly string[],
  ): Promise<Map<string, { userId: string; vote: FormVote }[]>> {
    const grouped = new Map<string, { userId: string; vote: FormVote }[]>();
    if (submissionIds.length === 0) return grouped;
    const rows = await this.sql<{ submissionId: string; userId: string; vote: FormVote }[]>`
      select submission_id as "submissionId", user_id as "userId", vote
      from forms_votes where submission_id in ${this.sql(submissionIds as string[])}
      order by created_at
    `;
    for (const row of rows) {
      const list = grouped.get(row.submissionId) ?? [];
      list.push({ userId: row.userId, vote: row.vote });
      grouped.set(row.submissionId, list);
    }
    return grouped;
  }

  async reviewTimes(guildId: string): Promise<{ formId: string; medianSeconds: number }[]> {
    return this.sql<{ formId: string; medianSeconds: number }[]>`
      select form_id as "formId",
        (percentile_cont(0.5) within group (
          order by extract(epoch from decided_at - created_at)
        ))::float8 as "medianSeconds"
      from forms_submissions
      where guild_id = ${guildId} and decided_at is not null
      group by form_id
    `;
  }

  async memberSubmissions(guildId: string, userId: string): Promise<FormSubmission[]> {
    return this.sql<FormSubmission[]>`
      select ${submissionColumns(this.sql)} from forms_submissions
      where guild_id = ${guildId} and user_id = ${userId}
      order by id
    `.then((rows) => rows.map(openSubmission));
  }

  async memberVotes(
    guildId: string,
    userId: string,
  ): Promise<{ submissionId: string; formId: string; vote: FormVote; createdAt: Date }[]> {
    return this.sql<{ submissionId: string; formId: string; vote: FormVote; createdAt: Date }[]>`
      select v.submission_id as "submissionId", s.form_id as "formId", v.vote,
        v.created_at as "createdAt"
      from forms_votes v
      join forms_submissions s on s.id = v.submission_id
      where s.guild_id = ${guildId} and v.user_id = ${userId}
      order by v.created_at
    `;
  }

  async forgetMember(
    guildId: string,
    userId: string,
  ): Promise<{
    submissions: number;
    votes: number;
    kept: number;
    reviewMessages: { channelId: string; messageId: string }[];
  }> {
    return this.sql.begin(async (tx) => {
      const submissions = await tx<{ channelId: string | null; messageId: string | null }[]>`
        delete from forms_submissions
        where guild_id = ${guildId} and user_id = ${userId} and status <> 'pending'
        returning review_channel_id as "channelId", review_message_id as "messageId"
      `;
      const votes = await tx`
        delete from forms_votes v
        using forms_submissions s
        where s.id = v.submission_id and s.guild_id = ${guildId} and v.user_id = ${userId}
          and s.status <> 'pending'
        returning v.submission_id
      `;
      const [kept] = await tx<{ total: number }[]>`
        select count(*)::int as total from forms_submissions
        where guild_id = ${guildId} and user_id = ${userId}
      `;
      return {
        submissions: submissions.length,
        votes: votes.length,
        kept: kept?.total ?? 0,
        reviewMessages: submissions.flatMap((row) =>
          row.channelId && row.messageId
            ? [{ channelId: row.channelId, messageId: row.messageId }]
            : [],
        ),
      };
    });
  }

  async purgeGuild(guildId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from forms_sessions where guild_id = ${guildId}`;
      await tx`delete from forms_submissions where guild_id = ${guildId}`;
    });
  }
}
