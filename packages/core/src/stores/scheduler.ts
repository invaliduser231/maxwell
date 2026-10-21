import type { Sql } from '../db/sql.js';
import type { ScheduleRule, Weekday } from '../modules/scheduler.js';

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalTime extends LocalDate {
  hour: number;
  minute: number;
}

const MINUTE = 60_000;
const FORMATTER_LIMIT = 500;
const formatters = new Map<string, Intl.DateTimeFormat>();
const dayNames: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (candidate && isTimezone(candidate)) return candidate;
  }
  return 'UTC';
}

function formatter(timezone: string): Intl.DateTimeFormat {
  const hit = formatters.get(timezone);
  if (hit) return hit;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  if (formatters.size >= FORMATTER_LIMIT) formatters.clear();
  formatters.set(timezone, created);
  return created;
}

export function toLocal(ms: number, timezone: string): LocalTime & { second: number } {
  const parts: Record<string, number> = {};
  for (const part of formatter(timezone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

export function offsetAt(ms: number, timezone: string): number {
  const base = Math.floor(ms / 1000) * 1000;
  const local = toLocal(base, timezone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - base;
}

export function fromLocal(local: LocalTime, timezone: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const first = offsetAt(guess, timezone);
  const second = offsetAt(guess - first, timezone);
  if (first === second) return guess - first;
  const alternative = guess - second;
  if (offsetAt(alternative, timezone) === second) return alternative;
  return guess - Math.min(first, second);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekdayOf(date: LocalDate): Weekday {
  return dayNames[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()] ?? 'mon';
}

export function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function parseLocalDateTime(value: string): LocalTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

export function formatLocalDateTime(ms: number, timezone: string): string {
  const local = toLocal(ms, timezone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
}

export function nextRun(rule: ScheduleRule, timezone: string, after: number): number | null {
  switch (rule.type) {
    case 'once': {
      const local = parseLocalDateTime(rule.at);
      if (!local) return null;
      const at = fromLocal(local, timezone);
      return at > after ? at : null;
    }
    case 'interval': {
      const local = parseLocalDateTime(rule.start);
      if (!local) return null;
      const anchor = fromLocal(local, timezone);
      if (anchor > after) return anchor;
      const step = rule.hours * 60 * MINUTE;
      return anchor + (Math.floor((after - anchor) / step) + 1) * step;
    }
    case 'daily':
    case 'weekly': {
      const clock = parseClock(rule.time);
      if (!clock) return null;
      const today = toLocal(after, timezone);
      for (let i = 0; i <= 8; i++) {
        const date = addDays(today, i);
        if (rule.type === 'weekly' && !rule.days.includes(weekdayOf(date))) continue;
        const at = fromLocal({ ...date, ...clock }, timezone);
        if (at > after) return at;
      }
      return null;
    }
  }
}

export function isDue(rule: ScheduleRule, timezone: string, runAt: number): boolean {
  return nextRun(rule, timezone, runAt - 1_000) === runAt;
}

export function upcomingRuns(
  rule: ScheduleRule,
  timezone: string,
  after: number,
  count: number,
): number[] {
  const out: number[] = [];
  let cursor = after;
  while (out.length < count) {
    const next = nextRun(rule, timezone, cursor);
    if (next === null) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

export interface ReminderRow {
  id: string;
  number: number;
  guildId: string;
  channelId: string;
  userId: string;
  content: string;
  dueAt: Date;
  createdAt: Date;
}

const reminderColumns = (sql: Sql) => sql`
  id, number, guild_id as "guildId", channel_id as "channelId", user_id as "userId", content,
  due_at as "dueAt", created_at as "createdAt"
`;

export class ReminderStore {
  constructor(private readonly sql: Sql) {}

  async create(input: {
    guildId: string;
    channelId: string;
    userId: string;
    content: string;
    dueAt: Date;
  }): Promise<ReminderRow> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`scheduler.reminders:${input.guildId}`}))`;
      const [row] = await tx<ReminderRow[]>`
        insert into scheduler_reminders (guild_id, number, channel_id, user_id, content, due_at)
        values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from scheduler_reminders where guild_id = ${input.guildId}),
          ${input.channelId}, ${input.userId}, ${input.content}, ${input.dueAt}
        )
        returning ${reminderColumns(this.sql)}
      `;
      if (!row) throw new Error('reminder insert returned nothing');
      return row;
    });
  }

  async byNumber(guildId: string, number: number): Promise<ReminderRow | null> {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) return null;
    const [row] = await this.sql<ReminderRow[]>`
      select ${reminderColumns(this.sql)} from scheduler_reminders
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async get(id: string): Promise<ReminderRow | null> {
    const [row] = await this.sql<ReminderRow[]>`
      select ${reminderColumns(this.sql)} from scheduler_reminders where id = ${id}
    `;
    return row ?? null;
  }

  async forMember(guildId: string, userId: string, limit = 100): Promise<ReminderRow[]> {
    return this.sql<ReminderRow[]>`
      select ${reminderColumns(this.sql)} from scheduler_reminders
      where guild_id = ${guildId} and user_id = ${userId}
      order by due_at
      limit ${limit}
    `;
  }

  async countForMember(guildId: string, userId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from scheduler_reminders
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.count ?? 0;
  }

  async forGuild(
    guildId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<ReminderRow[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.sql<ReminderRow[]>`
      select ${reminderColumns(this.sql)} from scheduler_reminders
      where guild_id = ${guildId}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by due_at, id
      limit ${limit}
    `;
  }

  async countForGuild(guildId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from scheduler_reminders where guild_id = ${guildId}
    `;
    return row?.count ?? 0;
  }

  async pending(guildId: string, limit = 1_000): Promise<ReminderRow[]> {
    return this.sql<ReminderRow[]>`
      select ${reminderColumns(this.sql)} from scheduler_reminders
      where guild_id = ${guildId}
      order by due_at
      limit ${limit}
    `;
  }

  async remove(guildId: string, id: string, userId?: string): Promise<ReminderRow | null> {
    const [row] = await this.sql<ReminderRow[]>`
      delete from scheduler_reminders
      where guild_id = ${guildId} and id = ${id}
        ${userId ? this.sql`and user_id = ${userId}` : this.sql``}
      returning ${reminderColumns(this.sql)}
    `;
    return row ?? null;
  }

  async forgetMember(guildId: string, userId: string): Promise<number> {
    const rows = await this.sql`
      delete from scheduler_reminders where guild_id = ${guildId} and user_id = ${userId} returning id
    `;
    return rows.length;
  }
}

export interface MessageStateRow {
  messageId: string;
  nextRunAt: Date | null;
  lastSentAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

export class MessageStateStore {
  constructor(private readonly sql: Sql) {}

  async list(guildId: string): Promise<MessageStateRow[]> {
    return this.sql<MessageStateRow[]>`
      select message_id as "messageId", next_run_at as "nextRunAt", last_sent_at as "lastSentAt",
        last_error as "lastError", updated_at as "updatedAt"
      from scheduler_message_state where guild_id = ${guildId}
      order by message_id
    `;
  }

  async planned(guildId: string, messageId: string, nextRunAt: Date | null): Promise<void> {
    await this.sql`
      insert into scheduler_message_state (guild_id, message_id, next_run_at)
      values (${guildId}, ${messageId}, ${nextRunAt})
      on conflict (guild_id, message_id) do update set next_run_at = excluded.next_run_at, updated_at = now()
    `;
  }

  async sent(
    guildId: string,
    messageId: string,
    at: Date,
    error: string | null,
    nextRunAt: Date | null,
  ): Promise<void> {
    await this.sql`
      insert into scheduler_message_state (guild_id, message_id, next_run_at, last_sent_at, last_error)
      values (${guildId}, ${messageId}, ${nextRunAt}, ${error ? null : at}, ${error})
      on conflict (guild_id, message_id) do update set
        next_run_at = excluded.next_run_at,
        last_sent_at = coalesce(excluded.last_sent_at, scheduler_message_state.last_sent_at),
        last_error = excluded.last_error,
        updated_at = now()
    `;
  }

  async prune(guildId: string, keep: readonly string[]): Promise<void> {
    await this.sql`
      delete from scheduler_message_state
      where guild_id = ${guildId} and not (message_id = any(${this.sql.array([...keep])}::text[]))
    `;
  }
}
