import { describe, expect, it } from 'vitest';
import {
  parseEventDraft,
  parsePollDraft,
  parseTimeOfDay,
  parseWhen,
} from '../../src/modules/events/parse.js';

const berlin = 'Europe/Berlin';
const now = Date.UTC(2026, 9, 21, 16, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe('event times', () => {
  it('reads clock times', () => {
    expect(parseTimeOfDay('20:00')).toEqual({ hour: 20, minute: 0 });
    expect(parseTimeOfDay('8pm')).toEqual({ hour: 20, minute: 0 });
    expect(parseTimeOfDay('12am')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeOfDay('7:45am')).toEqual({ hour: 7, minute: 45 });
    expect(parseTimeOfDay('20')).toBeNull();
    expect(parseTimeOfDay('25:00')).toBeNull();
  });

  it('understands weekdays, relative days, dates and durations', () => {
    const fri = parseWhen(['fri', '20:00'], berlin, now);
    expect(fri.ok && iso(fri.at)).toBe('2026-10-23T18:00:00.000Z');
    const wed = parseWhen(['wed', '20:00'], berlin, now);
    expect(wed.ok && iso(wed.at)).toBe('2026-10-21T18:00:00.000Z');
    const nextWed = parseWhen(['wed', '17:00'], berlin, now);
    expect(nextWed.ok && iso(nextWed.at)).toBe('2026-10-28T16:00:00.000Z');
    const tomorrow = parseWhen(['tomorrow', '9:30'], berlin, now);
    expect(tomorrow.ok && iso(tomorrow.at)).toBe('2026-10-22T07:30:00.000Z');
    const date = parseWhen(['2026-11-02', '19:30'], berlin, now);
    expect(date.ok && iso(date.at)).toBe('2026-11-02T18:30:00.000Z');
    const joined = parseWhen(['2026-11-02T19:30'], berlin, now);
    expect(joined).toMatchObject({ ok: true, used: 1 });
    const dotted = parseWhen(['24.12.', '18:00'], berlin, now);
    expect(dotted.ok && iso(dotted.at)).toBe('2026-12-24T17:00:00.000Z');
    const relative = parseWhen(['in', '3h'], berlin, now);
    expect(relative.ok && relative.at - now).toBe(3 * 3_600_000);
    const bare = parseWhen(['2h30m'], berlin, now);
    expect(bare.ok && bare.at - now).toBe(9_000_000);
  });

  it('rejects the past and nonsense', () => {
    expect(parseWhen(['today', '10:00'], berlin, now)).toEqual({ ok: false, problem: 'past' });
    expect(parseWhen(['2026-02-30', '10:00'], berlin, now)).toEqual({
      ok: false,
      problem: 'invalid',
    });
    expect(parseWhen(['soon'], berlin, now)).toEqual({ ok: false, problem: 'invalid' });
    expect(parseWhen([], berlin, now)).toEqual({ ok: false, problem: 'missing' });
  });
});

describe('event drafts', () => {
  it('splits time, title and description', () => {
    const result = parseEventDraft('weekly fri 20:00 Movie night | Bring snacks.', berlin, now);
    expect(result).toEqual({
      ok: true,
      draft: {
        title: 'Movie night',
        description: 'Bring snacks.',
        startsAt: Date.UTC(2026, 9, 23, 18, 0),
        recurrence: 'weekly',
      },
    });
  });

  it('accepts quoted titles and needs one', () => {
    const quoted = parseEventDraft('tomorrow 18:00 "Board games"', berlin, now);
    expect(quoted.ok && quoted.draft.title).toBe('Board games');
    expect(parseEventDraft('tomorrow 18:00', berlin, now)).toEqual({ ok: false, problem: 'title' });
    expect(parseEventDraft('', berlin, now)).toEqual({ ok: false, problem: 'missing' });
  });
});

describe('poll drafts', () => {
  const yesNo = ['Yes', 'No'];

  it('reads modifiers, question and options with pipes', () => {
    expect(parsePollDraft('anon multi 2h What do we play? | Chess | Go | Poker', yesNo)).toEqual({
      ok: true,
      draft: {
        question: 'What do we play?',
        options: ['Chess', 'Go', 'Poker'],
        anonymous: true,
        multiple: true,
        durationMs: 7_200_000,
      },
    });
  });

  it('reads quoted options', () => {
    const result = parsePollDraft('1d "Which days work?" "Fri" "Sat" "Sun"', yesNo);
    expect(result.ok && result.draft).toMatchObject({
      question: 'Which days work?',
      options: ['Fri', 'Sat', 'Sun'],
      durationMs: 86_400_000,
      anonymous: false,
    });
  });

  it('turns a bare question into yes or no', () => {
    const result = parsePollDraft("Pizza tonight? Let's decide", yesNo);
    expect(result.ok && result.draft.options).toEqual(['Yes', 'No']);
    expect(result.ok && result.draft.question).toBe("Pizza tonight? Let's decide");
  });

  it('explains what is wrong', () => {
    expect(parsePollDraft('Lunch? | Pizza', yesNo)).toEqual({ ok: false, problem: 'few' });
    expect(parsePollDraft('Q | a | A', yesNo)).toEqual({ ok: false, problem: 'duplicate' });
    const eleven = Array.from({ length: 11 }, (_, i) => `o${i}`).join(' | ');
    expect(parsePollDraft(`Q | ${eleven}`, yesNo)).toEqual({ ok: false, problem: 'many' });
    expect(parsePollDraft('anon', yesNo)).toEqual({ ok: false, problem: 'question' });
    expect(parsePollDraft(`${'x'.repeat(300)} | a | b`, yesNo)).toEqual({
      ok: false,
      problem: 'long',
    });
  });
});
