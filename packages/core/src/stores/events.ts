import type { Sql } from '../db/sql.js';
import type { Recurrence } from '../modules/events.js';
import { addDays, daysInMonth, fromLocal, toLocal } from './scheduler.js';

export type EventStatus = 'scheduled' | 'cancelled' | 'ended';

export type RsvpStatus = 'going' | 'maybe' | 'no';

export const rsvpStatuses: readonly RsvpStatus[] = ['going', 'maybe', 'no'];

export interface EventRow {
  id: string;
  number: number;
  guildId: string;
  title: string;
  description: string;
  anchorAt: Date;
  startsAt: Date;
  sequence: number;
  durationMinutes: number | null;
  timezone: string;
  recurrence: Recurrence;
  location: string | null;
  voiceChannelId: string | null;
  channelId: string | null;
  pingRoleId: string | null;
  messageId: string | null;
  status: EventStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventInput {
  guildId: string;
  title: string;
  description?: string;
  startsAt: Date;
  durationMinutes?: number | null;
  timezone: string;
  recurrence?: Recurrence;
  location?: string | null;
  voiceChannelId?: string | null;
  channelId?: string | null;
  pingRoleId?: string | null;
  createdBy?: string | null;
}

export type EventPatch = Partial<Omit<EventInput, 'guildId' | 'createdBy'>>;

export interface RsvpCounts {
  going: number;
  maybe: number;
  no: number;
}

const DAY = 86_400_000;

function validNumber(number: number): boolean {
  return Number.isSafeInteger(number) && number >= 1 && number <= 2_147_483_647;
}

export function occurrenceStart(
  anchor: number,
  timezone: string,
  recurrence: Recurrence,
  index: number,
): number {
  if (recurrence === 'none' || index === 0) return anchor;
  const local = toLocal(anchor, timezone);
  const clock = { hour: local.hour, minute: local.minute };
  if (recurrence === 'daily' || recurrence === 'weekly') {
    const date = addDays(local, recurrence === 'daily' ? index : index * 7);
    return fromLocal({ ...date, ...clock }, timezone);
  }
  const months = local.month - 1 + index;
  const year = local.year + Math.floor(months / 12);
  const month = (months % 12) + 1;
  const day = Math.min(local.day, daysInMonth(year, month));
  return fromLocal({ year, month, day, ...clock }, timezone);
}

export function nextOccurrence(
  anchor: number,
  timezone: string,
  recurrence: Recurrence,
  after: number,
): number | null {
  if (recurrence === 'none') return anchor > after ? anchor : null;
  if (anchor > after) return anchor;
  const period = recurrence === 'daily' ? DAY : recurrence === 'weekly' ? 7 * DAY : 28 * DAY;
  let index = Math.max(0, Math.floor((after - anchor) / period) - 2);
  if (recurrence === 'monthly') {
    const from = toLocal(anchor, timezone);
    const to = toLocal(after, timezone);
    index = Math.max(0, (to.year - from.year) * 12 + (to.month - from.month) - 1);
  }
  for (let guard = 0; guard < 64; guard++, index++) {
    const start = occurrenceStart(anchor, timezone, recurrence, index);
    if (start > after) return start;
  }
  return null;
}

const eventColumns = (sql: Sql) => sql`
  id, number, guild_id as "guildId", title, description, anchor_at as "anchorAt", starts_at as "startsAt",
  sequence, duration_minutes as "durationMinutes", timezone, recurrence, location,
  voice_channel_id as "voiceChannelId", channel_id as "channelId", ping_role_id as "pingRoleId",
  message_id as "messageId", status, created_by as "createdBy", created_at as "createdAt",
  updated_at as "updatedAt"
`;

export class EventStore {
  constructor(private readonly sql: Sql) {}

  async create(input: EventInput): Promise<EventRow> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`events:${input.guildId}`}))`;
      const [row] = await tx<EventRow[]>`
        insert into events_events (
          guild_id, number, title, description, anchor_at, starts_at, duration_minutes, timezone,
          recurrence, location, voice_channel_id, channel_id, ping_role_id, created_by
        ) values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from events_events where guild_id = ${input.guildId}),
          ${input.title}, ${input.description ?? ''}, ${input.startsAt},
          ${input.startsAt}, ${input.durationMinutes ?? null}, ${input.timezone},
          ${input.recurrence ?? 'none'}, ${input.location ?? null}, ${input.voiceChannelId ?? null},
          ${input.channelId ?? null}, ${input.pingRoleId ?? null}, ${input.createdBy ?? null}
        )
        returning ${eventColumns(this.sql)}
      `;
      if (!row) throw new Error('event insert returned nothing');
      return row;
    });
  }

  async byNumber(guildId: string, number: number): Promise<EventRow | null> {
    if (!validNumber(number)) return null;
    const [row] = await this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async get(guildId: string, id: string): Promise<EventRow | null> {
    if (!/^\d+$/.test(id)) return null;
    const [row] = await this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async byId(id: string): Promise<EventRow | null> {
    if (!/^\d+$/.test(id)) return null;
    const [row] = await this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events where id = ${id}
    `;
    return row ?? null;
  }

  async byMessage(messageId: string): Promise<EventRow | null> {
    const [row] = await this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events where message_id = ${messageId}
    `;
    return row ?? null;
  }

  async upcoming(guildId: string, limit = 25): Promise<EventRow[]> {
    return this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events
      where guild_id = ${guildId} and status = 'scheduled'
      order by starts_at, id
      limit ${limit}
    `;
  }

  async between(guildId: string, from: Date, to: Date): Promise<EventRow[]> {
    return this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events
      where guild_id = ${guildId} and status <> 'cancelled'
        and (starts_at < ${to} and (recurrence <> 'none' or starts_at >= ${from}))
      order by starts_at, id
    `;
  }

  async scheduled(limit = 5_000): Promise<EventRow[]> {
    return this.sql<EventRow[]>`
      select ${eventColumns(this.sql)} from events_events
      where status = 'scheduled'
      order by starts_at
      limit ${limit}
    `;
  }

  async update(guildId: string, id: string, patch: EventPatch): Promise<EventRow | null> {
    const current = await this.get(guildId, id);
    if (!current) return null;
    const startsAt = patch.startsAt ?? current.startsAt;
    const moved =
      startsAt.getTime() !== current.startsAt.getTime() ||
      (patch.recurrence !== undefined && patch.recurrence !== current.recurrence) ||
      (patch.timezone !== undefined && patch.timezone !== current.timezone);
    const [row] = await this.sql<EventRow[]>`
      update events_events set
        title = ${patch.title ?? current.title},
        description = ${patch.description ?? current.description},
        starts_at = ${startsAt},
        anchor_at = ${moved ? startsAt : current.anchorAt},
        duration_minutes = ${patch.durationMinutes === undefined ? current.durationMinutes : patch.durationMinutes},
        timezone = ${patch.timezone ?? current.timezone},
        recurrence = ${patch.recurrence ?? current.recurrence},
        location = ${patch.location === undefined ? current.location : patch.location},
        voice_channel_id = ${patch.voiceChannelId === undefined ? current.voiceChannelId : patch.voiceChannelId},
        channel_id = ${patch.channelId === undefined ? current.channelId : patch.channelId},
        ping_role_id = ${patch.pingRoleId === undefined ? current.pingRoleId : patch.pingRoleId},
        updated_at = now()
      where guild_id = ${guildId} and id = ${id}
      returning ${eventColumns(this.sql)}
    `;
    return row ?? null;
  }

  async setMessage(id: string, channelId: string | null, messageId: string | null): Promise<void> {
    await this.sql`
      update events_events set channel_id = coalesce(${channelId}, channel_id),
        message_id = ${messageId}, updated_at = now()
      where id = ${id}
    `;
  }

  async setStatus(guildId: string, id: string, status: EventStatus): Promise<EventRow | null> {
    const [row] = await this.sql<EventRow[]>`
      update events_events set status = ${status}, updated_at = now()
      where guild_id = ${guildId} and id = ${id}
      returning ${eventColumns(this.sql)}
    `;
    return row ?? null;
  }

  async advance(id: string, from: Date, startsAt: Date): Promise<EventRow | null> {
    const [row] = await this.sql<EventRow[]>`
      update events_events set starts_at = ${startsAt}, sequence = sequence + 1,
        message_id = null, updated_at = now()
      where id = ${id} and starts_at = ${from} and status = 'scheduled'
      returning ${eventColumns(this.sql)}
    `;
    return row ?? null;
  }

  async finish(id: string, from: Date): Promise<EventRow | null> {
    const [row] = await this.sql<EventRow[]>`
      update events_events set status = 'ended', updated_at = now()
      where id = ${id} and starts_at = ${from} and status = 'scheduled'
      returning ${eventColumns(this.sql)}
    `;
    return row ?? null;
  }

  async remove(guildId: string, id: string): Promise<EventRow | null> {
    const [row] = await this.sql<EventRow[]>`
      delete from events_events where guild_id = ${guildId} and id = ${id}
      returning ${eventColumns(this.sql)}
    `;
    return row ?? null;
  }

  async setRsvp(
    event: Pick<EventRow, 'id' | 'guildId' | 'sequence'>,
    userId: string,
    status: RsvpStatus,
  ): Promise<RsvpStatus | null> {
    const [row] = await this.sql<{ previous: RsvpStatus | null }[]>`
      with previous as (
        select status from events_rsvps
        where event_id = ${event.id} and sequence = ${event.sequence} and user_id = ${userId}
      ), upsert as (
        insert into events_rsvps (event_id, sequence, guild_id, user_id, status)
        values (${event.id}, ${event.sequence}, ${event.guildId}, ${userId}, ${status})
        on conflict (event_id, sequence, user_id)
        do update set status = excluded.status, updated_at = now()
      )
      select (select status from previous) as previous
    `;
    return row?.previous ?? null;
  }

  async clearRsvp(
    event: Pick<EventRow, 'id' | 'sequence'>,
    userId: string,
    status: RsvpStatus,
  ): Promise<boolean> {
    const rows = await this.sql`
      delete from events_rsvps
      where event_id = ${event.id} and sequence = ${event.sequence} and user_id = ${userId}
        and status = ${status}
      returning user_id
    `;
    return rows.length > 0;
  }

  async rsvpOf(
    event: Pick<EventRow, 'id' | 'sequence'>,
    userId: string,
  ): Promise<RsvpStatus | null> {
    const [row] = await this.sql<{ status: RsvpStatus }[]>`
      select status from events_rsvps
      where event_id = ${event.id} and sequence = ${event.sequence} and user_id = ${userId}
    `;
    return row?.status ?? null;
  }

  async rsvpCounts(event: Pick<EventRow, 'id' | 'sequence'>): Promise<RsvpCounts> {
    const rows = await this.sql<{ status: RsvpStatus; count: number }[]>`
      select status, count(*)::int as count from events_rsvps
      where event_id = ${event.id} and sequence = ${event.sequence}
      group by status
    `;
    const counts: RsvpCounts = { going: 0, maybe: 0, no: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  async rsvpCountsFor(
    events: readonly Pick<EventRow, 'id' | 'sequence'>[],
  ): Promise<Map<string, RsvpCounts>> {
    const out = new Map<string, RsvpCounts>();
    if (events.length === 0) return out;
    const ids = events.map((event) => event.id);
    const sequences = events.map((event) => event.sequence);
    const rows = await this.sql<{ eventId: string; status: RsvpStatus; count: number }[]>`
      select r.event_id as "eventId", r.status, count(*)::int as count
      from events_rsvps r
      join unnest(${this.sql.array(ids)}::bigint[], ${this.sql.array(sequences)}::int[]) as k(event_id, sequence)
        on k.event_id = r.event_id and k.sequence = r.sequence
      group by r.event_id, r.status
    `;
    for (const event of events) out.set(event.id, { going: 0, maybe: 0, no: 0 });
    for (const row of rows) {
      const counts = out.get(row.eventId);
      if (counts) counts[row.status] = row.count;
    }
    return out;
  }

  async rsvpUsers(
    event: Pick<EventRow, 'id' | 'sequence'>,
    status: RsvpStatus,
    limit = 1_000,
  ): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select user_id as "userId" from events_rsvps
      where event_id = ${event.id} and sequence = ${event.sequence} and status = ${status}
      order by updated_at, user_id
      limit ${limit}
    `;
    return rows.map((row) => row.userId);
  }

  async rsvpMap(event: Pick<EventRow, 'id' | 'sequence'>): Promise<Map<string, RsvpStatus>> {
    const rows = await this.sql<{ userId: string; status: RsvpStatus }[]>`
      select user_id as "userId", status from events_rsvps
      where event_id = ${event.id} and sequence = ${event.sequence}
    `;
    return new Map(rows.map((row) => [row.userId, row.status]));
  }

  async rsvpsOfMember(guildId: string, userId: string): Promise<MemberRsvp[]> {
    return this.sql<MemberRsvp[]>`
      select e.id as "eventId", e.number, e.title, r.sequence, r.status, r.updated_at as "updatedAt",
        (r.sequence = e.sequence and e.status = 'scheduled') as current,
        e.starts_at as "startsAt", e.channel_id as "channelId", e.message_id as "messageId"
      from events_rsvps r
      join events_events e on e.id = r.event_id
      where r.guild_id = ${guildId} and r.user_id = ${userId}
      order by r.updated_at, e.id
    `;
  }

  async createdBy(
    guildId: string,
    userId: string,
  ): Promise<{ id: string; number: number; title: string }[]> {
    return this.sql<{ id: string; number: number; title: string }[]>`
      select id, number, title from events_events
      where guild_id = ${guildId} and created_by = ${userId}
      order by id
    `;
  }

  async forgetCreator(guildId: string, userId: string): Promise<number> {
    const rows = await this.sql`
      update events_events set created_by = null
      where guild_id = ${guildId} and created_by = ${userId}
      returning id
    `;
    return rows.length;
  }

  async forgetMember(guildId: string, userId: string): Promise<number> {
    const rows = await this.sql`
      delete from events_rsvps where guild_id = ${guildId} and user_id = ${userId} returning user_id
    `;
    return rows.length;
  }
}

export interface MemberRsvp {
  eventId: string;
  number: number;
  title: string;
  sequence: number;
  status: RsvpStatus;
  updatedAt: Date;
  current: boolean;
  startsAt: Date;
  channelId: string | null;
  messageId: string | null;
}

export interface MemberVote {
  pollId: string;
  number: number;
  question: string;
  options: string[];
  option: number;
  anonymous: boolean;
  status: PollStatus;
  channelId: string | null;
  messageId: string | null;
  createdAt: Date;
}

export type PollStatus = 'draft' | 'open' | 'closed' | 'cancelled';

export interface PollRow {
  id: string;
  number: number;
  guildId: string;
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  endsAt: Date | null;
  channelId: string | null;
  messageId: string | null;
  status: PollStatus;
  createdBy: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface PollInput {
  guildId: string;
  question: string;
  options: string[];
  anonymous?: boolean;
  multiple?: boolean;
  endsAt?: Date | null;
  channelId?: string | null;
  createdBy?: string | null;
}

export type PollPatch = Partial<Omit<PollInput, 'guildId' | 'createdBy'>>;

export type VoteOutcome = 'added' | 'moved' | 'removed' | 'kept';

export interface PollResults {
  counts: number[];
  voters: number;
  votes: number;
}

export const POLL_OPTION_LIMIT = 10;

const pollColumns = (sql: Sql) => sql`
  id, number, guild_id as "guildId", question, options, anonymous, multiple, ends_at as "endsAt",
  channel_id as "channelId", message_id as "messageId", status, created_by as "createdBy",
  created_at as "createdAt", closed_at as "closedAt"
`;

export class PollStore {
  constructor(private readonly sql: Sql) {}

  async create(input: PollInput): Promise<PollRow> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`events.polls:${input.guildId}`}))`;
      const [row] = await tx<PollRow[]>`
        insert into events_polls (
          guild_id, number, question, options, anonymous, multiple, ends_at, channel_id, created_by
        )
        values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from events_polls where guild_id = ${input.guildId}),
          ${input.question}, ${tx.json(input.options)},
          ${input.anonymous ?? false}, ${input.multiple ?? false}, ${input.endsAt ?? null},
          ${input.channelId ?? null}, ${input.createdBy ?? null}
        )
        returning ${pollColumns(this.sql)}
      `;
      if (!row) throw new Error('poll insert returned nothing');
      return row;
    });
  }

  async byNumber(guildId: string, number: number): Promise<PollRow | null> {
    if (!validNumber(number)) return null;
    const [row] = await this.sql<PollRow[]>`
      select ${pollColumns(this.sql)} from events_polls
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async get(guildId: string, id: string): Promise<PollRow | null> {
    if (!/^\d+$/.test(id)) return null;
    const [row] = await this.sql<PollRow[]>`
      select ${pollColumns(this.sql)} from events_polls where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async byMessage(messageId: string): Promise<PollRow | null> {
    const [row] = await this.sql<PollRow[]>`
      select ${pollColumns(this.sql)} from events_polls where message_id = ${messageId}
    `;
    return row ?? null;
  }

  async list(
    guildId: string,
    options: { status?: PollStatus; limit?: number; before?: string } = {},
  ): Promise<PollRow[]> {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    return this.sql<PollRow[]>`
      select ${pollColumns(this.sql)} from events_polls
      where guild_id = ${guildId}
        ${options.status ? this.sql`and status = ${options.status}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${limit}
    `;
  }

  async active(limit = 5_000): Promise<PollRow[]> {
    return this.sql<PollRow[]>`
      select ${pollColumns(this.sql)} from events_polls
      where status = 'open' and message_id is not null
      order by id desc
      limit ${limit}
    `;
  }

  async update(guildId: string, id: string, patch: PollPatch): Promise<PollRow | null> {
    const current = await this.get(guildId, id);
    if (current?.status !== 'draft') return null;
    const [row] = await this.sql<PollRow[]>`
      update events_polls set
        question = ${patch.question ?? current.question},
        options = ${this.sql.json(patch.options ?? current.options)},
        anonymous = ${patch.anonymous ?? current.anonymous},
        multiple = ${patch.multiple ?? current.multiple},
        ends_at = ${patch.endsAt === undefined ? current.endsAt : patch.endsAt},
        channel_id = ${patch.channelId === undefined ? current.channelId : patch.channelId}
      where guild_id = ${guildId} and id = ${id} and status = 'draft'
      returning ${pollColumns(this.sql)}
    `;
    return row ?? null;
  }

  async open(id: string, channelId: string, messageId: string): Promise<PollRow | null> {
    const [row] = await this.sql<PollRow[]>`
      update events_polls set status = 'open', channel_id = ${channelId}, message_id = ${messageId}
      where id = ${id} and status = 'draft'
      returning ${pollColumns(this.sql)}
    `;
    return row ?? null;
  }

  async close(guildId: string, id: string): Promise<PollRow | null> {
    const [row] = await this.sql<PollRow[]>`
      update events_polls set status = 'closed', closed_at = now()
      where guild_id = ${guildId} and id = ${id} and status = 'open'
      returning ${pollColumns(this.sql)}
    `;
    return row ?? null;
  }

  async cancel(guildId: string, id: string): Promise<PollRow | null> {
    const [row] = await this.sql<PollRow[]>`
      update events_polls set status = 'cancelled', closed_at = now()
      where guild_id = ${guildId} and id = ${id} and status in ('draft', 'open')
      returning ${pollColumns(this.sql)}
    `;
    return row ?? null;
  }

  async remove(guildId: string, id: string): Promise<PollRow | null> {
    const [row] = await this.sql<PollRow[]>`
      delete from events_polls where guild_id = ${guildId} and id = ${id}
      returning ${pollColumns(this.sql)}
    `;
    return row ?? null;
  }

  async vote(
    poll: Pick<PollRow, 'id' | 'guildId' | 'multiple'>,
    userId: string,
    option: number,
    toggle: boolean,
  ): Promise<VoteOutcome> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`events.poll:${poll.id}:${userId}`}))`;
      const existing = await tx<{ option: number }[]>`
        select option from events_poll_votes where poll_id = ${poll.id} and user_id = ${userId}
      `;
      const has = existing.some((row) => row.option === option);
      if (has && toggle) {
        await tx`
          delete from events_poll_votes
          where poll_id = ${poll.id} and user_id = ${userId} and option = ${option}
        `;
        return 'removed';
      }
      if (has) return 'kept';
      let moved = false;
      if (!poll.multiple && existing.length > 0) {
        await tx`delete from events_poll_votes where poll_id = ${poll.id} and user_id = ${userId}`;
        moved = true;
      }
      await tx`
        insert into events_poll_votes (poll_id, guild_id, user_id, option)
        values (${poll.id}, ${poll.guildId}, ${userId}, ${option})
        on conflict do nothing
      `;
      return moved ? 'moved' : 'added';
    }) as Promise<VoteOutcome>;
  }

  async unvote(pollId: string, userId: string, option: number): Promise<boolean> {
    const rows = await this.sql`
      delete from events_poll_votes
      where poll_id = ${pollId} and user_id = ${userId} and option = ${option}
      returning option
    `;
    return rows.length > 0;
  }

  async votesOf(pollId: string, userId: string): Promise<number[]> {
    const rows = await this.sql<{ option: number }[]>`
      select option from events_poll_votes where poll_id = ${pollId} and user_id = ${userId}
      order by option
    `;
    return rows.map((row) => row.option);
  }

  async results(poll: Pick<PollRow, 'id' | 'options'>): Promise<PollResults> {
    const rows = await this.sql<{ option: number; count: number }[]>`
      select option, count(*)::int as count from events_poll_votes
      where poll_id = ${poll.id}
      group by option
    `;
    const [voters] = await this.sql<{ count: number }[]>`
      select count(distinct user_id)::int as count from events_poll_votes where poll_id = ${poll.id}
    `;
    const counts = poll.options.map(() => 0);
    for (const row of rows) {
      if (row.option >= 0 && row.option < counts.length) counts[row.option] = row.count;
    }
    return {
      counts,
      voters: voters?.count ?? 0,
      votes: counts.reduce((sum, value) => sum + value, 0),
    };
  }

  async ballots(pollId: string): Promise<Map<string, number[]>> {
    const rows = await this.sql<{ userId: string; option: number }[]>`
      select user_id as "userId", option from events_poll_votes
      where poll_id = ${pollId}
      order by user_id, option
    `;
    const out = new Map<string, number[]>();
    for (const row of rows) {
      const list = out.get(row.userId);
      if (list) list.push(row.option);
      else out.set(row.userId, [row.option]);
    }
    return out;
  }

  async setVotes(
    poll: Pick<PollRow, 'id' | 'guildId'>,
    userId: string,
    options: readonly number[],
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`events.poll:${poll.id}:${userId}`}))`;
      await tx`delete from events_poll_votes where poll_id = ${poll.id} and user_id = ${userId}`;
      for (const option of new Set(options)) {
        await tx`
          insert into events_poll_votes (poll_id, guild_id, user_id, option)
          values (${poll.id}, ${poll.guildId}, ${userId}, ${option})
        `;
      }
    });
  }

  async votesOfMember(guildId: string, userId: string): Promise<MemberVote[]> {
    return this.sql<MemberVote[]>`
      select p.id as "pollId", p.number, p.question, p.options, v.option, p.anonymous, p.status,
        p.channel_id as "channelId", p.message_id as "messageId", v.created_at as "createdAt"
      from events_poll_votes v
      join events_polls p on p.id = v.poll_id
      where v.guild_id = ${guildId} and v.user_id = ${userId}
      order by v.created_at, p.id, v.option
    `;
  }

  async createdBy(
    guildId: string,
    userId: string,
  ): Promise<{ id: string; number: number; question: string }[]> {
    return this.sql<{ id: string; number: number; question: string }[]>`
      select id, number, question from events_polls
      where guild_id = ${guildId} and created_by = ${userId}
      order by id
    `;
  }

  async forgetCreator(guildId: string, userId: string): Promise<number> {
    const rows = await this.sql`
      update events_polls set created_by = null
      where guild_id = ${guildId} and created_by = ${userId}
      returning id
    `;
    return rows.length;
  }

  async forgetMember(guildId: string, userId: string): Promise<number> {
    const rows = await this.sql`
      delete from events_poll_votes where guild_id = ${guildId} and user_id = ${userId}
      returning poll_id
    `;
    return rows.length;
  }
}

export interface IcsEvent {
  id: string;
  title: string;
  description?: string;
  startsAt: Date;
  durationMinutes: number | null;
  timezone: string;
  recurrence: Recurrence;
  location?: string | null;
  status?: EventStatus;
  sequence?: number;
  updatedAt?: Date;
}

export interface IcsOptions {
  domain?: string;
  name?: string;
  now?: Date;
  defaultDurationMinutes?: number;
  url?: string | null;
}

export function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = out.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function localStamp(ms: number, timezone: string): string {
  const local = toLocal(ms, timezone);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(local.year, 4)}${pad(local.month)}${pad(local.day)}T${pad(local.hour)}${pad(local.minute)}00`;
}

const rrules: Record<Exclude<Recurrence, 'none'>, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
};

function eventLines(event: IcsEvent, options: IcsOptions): string[] {
  const domain = options.domain ?? 'maxwell';
  const now = options.now ?? new Date();
  const start = event.startsAt.getTime();
  const minutes = event.durationMinutes ?? options.defaultDurationMinutes ?? 60;
  const end = start + minutes * 60_000;
  const recurring = event.recurrence !== 'none';
  const out = [
    'BEGIN:VEVENT',
    `UID:event-${event.id}@${domain}`,
    `DTSTAMP:${utcStamp((event.updatedAt ?? now).getTime())}`,
  ];
  if (recurring) {
    out.push(`DTSTART;TZID=${event.timezone}:${localStamp(start, event.timezone)}`);
    out.push(`DTEND;TZID=${event.timezone}:${localStamp(end, event.timezone)}`);
    out.push(`RRULE:${rrules[event.recurrence as Exclude<Recurrence, 'none'>]}`);
  } else {
    out.push(`DTSTART:${utcStamp(start)}`);
    out.push(`DTEND:${utcStamp(end)}`);
  }
  out.push(`SUMMARY:${escapeIcs(event.title)}`);
  if (event.description) out.push(`DESCRIPTION:${escapeIcs(event.description)}`);
  if (event.location) out.push(`LOCATION:${escapeIcs(event.location)}`);
  if (options.url) out.push(`URL:${options.url}`);
  if (event.sequence) out.push(`SEQUENCE:${event.sequence}`);
  out.push(`STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);
  out.push('END:VEVENT');
  return out;
}

export function toIcs(events: IcsEvent | readonly IcsEvent[], options: IcsOptions = {}): string {
  const list = Array.isArray(events) ? (events as readonly IcsEvent[]) : [events as IcsEvent];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Maxwell//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (options.name) lines.push(`X-WR-CALNAME:${escapeIcs(options.name)}`);
  for (const event of list) lines.push(...eventLines(event, options));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
