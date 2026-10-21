import { type ScheduleRule, schedulerConfig } from '@maxwell/core/modules/scheduler';
import {
  formatLocalDateTime,
  fromLocal,
  isDue,
  nextRun,
  offsetAt,
  resolveTimezone,
  toLocal,
  upcomingRuns,
} from '@maxwell/core/stores/scheduler';
import { describe, expect, it } from 'vitest';
import { changedGuild } from '../../src/modules/scheduler/config.js';
import { LATE_LIMIT, planFire, renderScheduled } from '../../src/modules/scheduler/messages.js';
import { checkReminder } from '../../src/modules/scheduler/reminders.js';

const berlin = 'Europe/Berlin';
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe('zoned time', () => {
  it('converts local wall time to UTC and back', () => {
    const at = fromLocal({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, berlin);
    expect(iso(at)).toBe('2026-07-01T07:30:00.000Z');
    expect(toLocal(at, berlin)).toMatchObject({
      year: 2026,
      month: 7,
      day: 1,
      hour: 9,
      minute: 30,
    });
    expect(offsetAt(at, berlin)).toBe(2 * 3_600_000);
  });

  it('moves times inside the spring gap forward', () => {
    const at = fromLocal({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, berlin);
    expect(iso(at)).toBe('2026-03-29T01:30:00.000Z');
    const ny = fromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    expect(iso(ny)).toBe('2026-03-08T07:30:00.000Z');
  });

  it('falls back to UTC for unknown zones', () => {
    expect(resolveTimezone('Mars/Olympus', null, 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTimezone('nope')).toBe('UTC');
  });

  it('formats local date times for the dashboard', () => {
    expect(formatLocalDateTime(Date.UTC(2026, 0, 5, 23, 15), berlin)).toBe('2026-01-06T00:15');
  });
});

describe('schedule rules', () => {
  const now = Date.UTC(2026, 9, 21, 10, 0);

  it('runs a one-off message once', () => {
    const rule = { type: 'once', at: '2026-10-21T14:00' } as const;
    expect(iso(nextRun(rule, berlin, now))).toBe('2026-10-21T12:00:00.000Z');
    expect(nextRun(rule, berlin, Date.UTC(2026, 9, 21, 12, 0))).toBeNull();
  });

  it('repeats every n hours from the start', () => {
    const rule = { type: 'interval', hours: 6, start: '2026-10-20T00:00' } as const;
    expect(iso(nextRun(rule, 'UTC', now))).toBe('2026-10-21T12:00:00.000Z');
    expect(upcomingRuns(rule, 'UTC', now, 3).map(iso)).toEqual([
      '2026-10-21T12:00:00.000Z',
      '2026-10-21T18:00:00.000Z',
      '2026-10-22T00:00:00.000Z',
    ]);
  });

  it('keeps daily messages on local time across the DST switch', () => {
    const rule = { type: 'daily', time: '09:00' } as const;
    const runs = upcomingRuns(rule, berlin, Date.UTC(2026, 9, 24, 12, 0), 2).map(iso);
    expect(runs).toEqual(['2026-10-25T08:00:00.000Z', '2026-10-26T08:00:00.000Z']);
  });

  it('picks the next matching weekday', () => {
    const rule: ScheduleRule = { type: 'weekly', days: ['mon', 'fri'], time: '18:30' };
    expect(iso(nextRun(rule, berlin, now))).toBe('2026-10-23T16:30:00.000Z');
    expect(iso(nextRun(rule, berlin, Date.UTC(2026, 9, 23, 17, 0)))).toBe(
      '2026-10-26T17:30:00.000Z',
    );
  });

  it('knows whether a queued run still matches the rule', () => {
    const rule = { type: 'daily', time: '09:00' } as const;
    const runAt = nextRun(rule, berlin, now) ?? 0;
    expect(isDue(rule, berlin, runAt)).toBe(true);
    expect(isDue({ type: 'daily', time: '10:00' }, berlin, runAt)).toBe(false);
  });
});

describe('scheduled messages', () => {
  const message = {
    id: 'morning',
    name: 'Morning',
    enabled: true,
    channelId: '100000000000000001',
    content: 'Good morning.',
    embed: false,
    pingRoleId: '100000000000000002',
    rule: { type: 'daily', time: '09:00' } as const,
  };

  it('plans the next run and skips stale or late jobs', () => {
    const runAt = Date.UTC(2026, 9, 22, 7, 0);
    const plan = planFire(message, berlin, runAt, runAt + 1_000);
    expect(plan?.send).toBe(true);
    expect(iso(plan?.next ?? null)).toBe('2026-10-23T07:00:00.000Z');
    expect(planFire(message, berlin, runAt + 60_000, runAt + 60_000)).toBeNull();
    expect(planFire({ ...message, enabled: false }, berlin, runAt, runAt)).toBeNull();
    expect(planFire(message, berlin, runAt, runAt + LATE_LIMIT + 1)?.send).toBe(false);
  });

  it('pings only the configured role', () => {
    expect(renderScheduled(message)).toEqual({
      content: '<@&100000000000000002> Good morning.',
      mentionRoles: ['100000000000000002'],
    });
    const embed = renderScheduled({ ...message, embed: true, pingRoleId: null });
    expect(embed.content).toBeUndefined();
    expect(embed.embeds?.[0]?.description).toBe('Good morning.');
  });

  it('parses an empty config and rejects duplicate ids', () => {
    expect(schedulerConfig.parse({}).messages).toEqual([]);
    const duplicate = schedulerConfig.safeParse({ messages: [message, message] });
    expect(duplicate.success).toBe(false);
  });
});

describe('member reminders', () => {
  const config = { reminders: true, maxReminderDays: 30, maxRemindersPerMember: 2 };

  it('enforces the limits from the dashboard', () => {
    expect(checkReminder(config, 60_000, 0)).toEqual({ ok: true });
    expect(checkReminder(config, 31 * 86_400_000, 0)).toMatchObject({ reason: 'far', limit: 30 });
    expect(checkReminder(config, 60_000, 2)).toMatchObject({ reason: 'many', limit: 2 });
    expect(checkReminder({ ...config, reminders: false }, 60_000, 0)).toMatchObject({
      reason: 'off',
    });
  });
});

describe('settings changes', () => {
  it('picks the guild out of scheduler notifications only', () => {
    expect(changedGuild('123456789012345678:scheduler')).toBe('123456789012345678');
    expect(changedGuild('123456789012345678:events')).toBeNull();
    expect(changedGuild('123456789012345678:prefix')).toBeNull();
    expect(changedGuild('abc:scheduler')).toBeNull();
    expect(changedGuild('1:scheduler:extra')).toBeNull();
  });
});
