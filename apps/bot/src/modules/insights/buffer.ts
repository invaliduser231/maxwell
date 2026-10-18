import type { NativeAction } from '@maxwell/core/modules/insights';
import {
  type ActiveRow,
  hourStart,
  type InsightsBatch,
  type MemberRow,
  type MessageRow,
  type ModerationRow,
  utcDay,
  type VoiceRow,
} from '@maxwell/core/stores/insights';

const DAY = 86_400_000;

export interface Accrual {
  guildId: string;
  channelId: string;
  day: string;
  seconds: number;
}

export function splitByDay(from: number, to: number): { day: string; seconds: number }[] {
  const out: { day: string; seconds: number }[] = [];
  let start = from;
  while (start < to) {
    const boundary = (Math.floor(start / DAY) + 1) * DAY;
    const end = Math.min(boundary, to);
    out.push({ day: utcDay(new Date(start)), seconds: (end - start) / 1000 });
    start = end;
  }
  return out;
}

export class InsightsBuffer {
  readonly #messages = new Map<string, MessageRow>();
  readonly #active = new Map<string, ActiveRow>();
  readonly #members = new Map<string, MemberRow>();
  readonly #voice = new Map<string, VoiceRow>();
  readonly #moderation = new Map<string, ModerationRow>();

  constructor(readonly limit = 50_000) {}

  size(): number {
    return (
      this.#messages.size +
      this.#active.size +
      this.#members.size +
      this.#voice.size +
      this.#moderation.size
    );
  }

  message(guildId: string, channelId: string, userId: string, at: Date, count = 1): void {
    const hour = hourStart(at);
    const key = `${guildId}|${hour.getTime()}|${channelId}`;
    const row = this.#messages.get(key);
    if (row) row.count += count;
    else this.#messages.set(key, { guildId, hour, channelId, count });

    const day = utcDay(at);
    const activeKey = `${guildId}|${day}|${userId}`;
    const active = this.#active.get(activeKey);
    if (active) active.count += count;
    else this.#active.set(activeKey, { guildId, day, userId, count });
  }

  member(guildId: string, at: Date, joins: number, leaves: number): void {
    const day = utcDay(at);
    const key = `${guildId}|${day}`;
    const row = this.#members.get(key);
    if (row) {
      row.joins += joins;
      row.leaves += leaves;
    } else {
      this.#members.set(key, { guildId, day, joins, leaves });
    }
  }

  voice(accrual: Accrual): void {
    if (accrual.seconds <= 0) return;
    const key = `${accrual.guildId}|${accrual.day}|${accrual.channelId}`;
    const row = this.#voice.get(key);
    if (row) row.seconds += accrual.seconds;
    else this.#voice.set(key, { ...accrual });
  }

  moderation(
    guildId: string,
    at: Date,
    action: NativeAction,
    actorId: string | null,
    count = 1,
  ): void {
    const day = utcDay(at);
    const key = `${guildId}|${day}|${action}|${actorId ?? ''}`;
    const row = this.#moderation.get(key);
    if (row) row.count += count;
    else this.#moderation.set(key, { guildId, day, action, actorId, count });
  }

  forget(guildId: string, userId: string): void {
    for (const [key, row] of this.#active) {
      if (row.guildId === guildId && row.userId === userId) this.#active.delete(key);
    }
    for (const [key, row] of this.#moderation) {
      if (row.guildId === guildId && row.actorId === userId) {
        this.#moderation.delete(key);
        this.moderation(guildId, new Date(`${row.day}T00:00:00Z`), row.action, null, row.count);
      }
    }
  }

  drain(): InsightsBatch {
    const batch: InsightsBatch = {
      messages: [...this.#messages.values()],
      active: [...this.#active.values()],
      members: [...this.#members.values()],
      voice: [...this.#voice.values()],
      moderation: [...this.#moderation.values()],
    };
    this.#messages.clear();
    this.#active.clear();
    this.#members.clear();
    this.#voice.clear();
    this.#moderation.clear();
    return batch;
  }

  restore(batch: InsightsBatch): boolean {
    const moderation = batch.moderation ?? [];
    const incoming =
      batch.messages.length +
      batch.active.length +
      batch.members.length +
      batch.voice.length +
      moderation.length;
    if (this.size() + incoming > this.limit * 2) return false;
    for (const row of batch.messages) {
      const key = `${row.guildId}|${row.hour.getTime()}|${row.channelId}`;
      const current = this.#messages.get(key);
      if (current) current.count += row.count;
      else this.#messages.set(key, { ...row });
    }
    for (const row of batch.active) {
      const key = `${row.guildId}|${row.day}|${row.userId}`;
      const current = this.#active.get(key);
      if (current) current.count += row.count;
      else this.#active.set(key, { ...row });
    }
    for (const row of batch.members)
      this.member(row.guildId, new Date(`${row.day}T00:00:00Z`), row.joins, row.leaves);
    for (const row of batch.voice) this.voice({ ...row });
    for (const row of moderation)
      this.moderation(
        row.guildId,
        new Date(`${row.day}T00:00:00Z`),
        row.action,
        row.actorId,
        row.count,
      );
    return true;
  }
}

interface Session {
  guildId: string;
  channelId: string;
  started: number;
  since: number;
}

export class VoiceSessions {
  readonly #sessions = new Map<string, Session>();

  constructor(
    readonly limit = 100_000,
    readonly maxAge = 24 * 60 * 60 * 1000,
  ) {}

  size(): number {
    return this.#sessions.size;
  }

  #close(key: string, now: number): Accrual[] {
    const session = this.#sessions.get(key);
    if (!session) return [];
    this.#sessions.delete(key);
    const from = Math.max(session.since, now - this.maxAge);
    return splitByDay(from, now).map((part) => ({
      guildId: session.guildId,
      channelId: session.channelId,
      ...part,
    }));
  }

  update(guildId: string, userId: string, channelId: string | null, now: number): Accrual[] {
    const key = `${guildId}:${userId}`;
    const current = this.#sessions.get(key);
    if (current && current.channelId === channelId) return [];
    const accruals = this.#close(key, now);
    if (channelId) {
      if (this.#sessions.size >= this.limit) {
        const oldest = this.#sessions.keys().next().value;
        if (oldest !== undefined) this.#sessions.delete(oldest);
      }
      this.#sessions.set(key, { guildId, channelId, started: now, since: now });
    }
    return accruals;
  }

  settle(now: number): Accrual[] {
    const out: Accrual[] = [];
    for (const [key, session] of this.#sessions) {
      const from = Math.max(session.since, now - this.maxAge);
      for (const part of splitByDay(from, now)) {
        out.push({ guildId: session.guildId, channelId: session.channelId, ...part });
      }
      session.since = now;
      if (now - session.started > this.maxAge) this.#sessions.delete(key);
    }
    return out;
  }

  clear(): void {
    this.#sessions.clear();
  }
}
