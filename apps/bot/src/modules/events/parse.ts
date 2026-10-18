import type { Recurrence } from '@maxwell/core/modules/events';
import { POLL_OPTION_LIMIT } from '@maxwell/core/stores/events';
import {
  addDays,
  daysInMonth,
  fromLocal,
  type LocalDate,
  toLocal,
  weekdayOf,
} from '@maxwell/core/stores/scheduler';
import { parseDuration } from '../../commands/duration.js';
import { type Token, tokenize } from '../../commands/tokenize.js';

export type WhenProblem = 'missing' | 'invalid' | 'past';

export type WhenResult =
  | { ok: true; at: number; used: number }
  | { ok: false; problem: WhenProblem };

const weekdayNames: Record<string, ReturnType<typeof weekdayOf>> = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tues: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
  mo: 'mon',
  montag: 'mon',
  di: 'tue',
  dienstag: 'tue',
  mi: 'wed',
  mittwoch: 'wed',
  do: 'thu',
  donnerstag: 'thu',
  fr: 'fri',
  freitag: 'fri',
  sa: 'sat',
  samstag: 'sat',
  so: 'sun',
  sonntag: 'sun',
};

const todayWords = new Set(['today', 'tonight', 'heute']);
const tomorrowWords = new Set(['tomorrow', 'morgen']);

export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(input.trim());
  if (!match) return null;
  const [, rawHour, rawMinute, meridiem] = match;
  if (rawMinute === undefined && meridiem === undefined) return null;
  let hour = Number(rawHour);
  const minute = rawMinute === undefined ? 0 : Number(rawMinute);
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 23) return null;
  return { hour, minute };
}

function parseDate(input: string, today: LocalDate): LocalDate | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(input);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dotted) {
    day = Number(dotted[1]);
    month = Number(dotted[2]);
    year = dotted[3] ? Number(dotted[3]) : today.year;
    if (!dotted[3] && (month < today.month || (month === today.month && day < today.day))) {
      year++;
    }
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function parseWhen(tokens: readonly string[], timezone: string, now: number): WhenResult {
  const [first, second] = tokens.map((token) => token.toLowerCase());
  if (!first) return { ok: false, problem: 'missing' };

  if (first === 'in' && second) {
    const delay = parseDuration(second);
    return delay ? { ok: true, at: now + delay, used: 2 } : { ok: false, problem: 'invalid' };
  }

  const isoJoined = /^(\d{4}-\d{1,2}-\d{1,2})t(\d{1,2}:\d{2})$/.exec(first);
  const today = toLocal(now, timezone);
  const parts = isoJoined ? [isoJoined[1] ?? '', isoJoined[2] ?? ''] : [first, second ?? ''];
  const used = isoJoined ? 1 : 2;
  const time = parseTimeOfDay(parts[1] ?? '');

  if (todayWords.has(first) || tomorrowWords.has(first)) {
    if (!time) return { ok: false, problem: 'invalid' };
    const date = tomorrowWords.has(first) ? addDays(today, 1) : today;
    const at = fromLocal({ ...date, ...time }, timezone);
    return at > now ? { ok: true, at, used } : { ok: false, problem: 'past' };
  }

  const weekday = weekdayNames[first];
  if (weekday) {
    if (!time) return { ok: false, problem: 'invalid' };
    for (let i = 0; i <= 7; i++) {
      const date = addDays(today, i);
      if (weekdayOf(date) !== weekday) continue;
      const at = fromLocal({ ...date, ...time }, timezone);
      if (at > now) return { ok: true, at, used };
    }
    return { ok: false, problem: 'invalid' };
  }

  const date = parseDate(parts[0] ?? '', today);
  if (date) {
    if (!time) return { ok: false, problem: 'invalid' };
    const at = fromLocal({ ...date, ...time }, timezone);
    return at > now ? { ok: true, at, used } : { ok: false, problem: 'past' };
  }

  const onlyTime = parseTimeOfDay(first);
  if (onlyTime) {
    const at = fromLocal({ ...today, ...onlyTime }, timezone);
    const next = at > now ? at : fromLocal({ ...addDays(today, 1), ...onlyTime }, timezone);
    return { ok: true, at: next, used: 1 };
  }

  const delay = parseDuration(first);
  if (delay) return { ok: true, at: now + delay, used: 1 };
  return { ok: false, problem: 'invalid' };
}

export const TITLE_LIMIT = 200;
export const DESCRIPTION_LIMIT = 2_000;

export type EventDraft = {
  title: string;
  description: string;
  startsAt: number;
  recurrence: Recurrence;
};

export type EventDraftResult =
  | { ok: true; draft: EventDraft }
  | { ok: false; problem: WhenProblem | 'title' | 'long' };

const recurrenceWords: Record<string, Recurrence> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  täglich: 'daily',
  wöchentlich: 'weekly',
  monatlich: 'monthly',
};

export function parseEventDraft(input: string, timezone: string, now: number): EventDraftResult {
  const tokens = tokenize(input);
  let index = 0;
  let recurrence: Recurrence = 'none';
  const word = tokens[0]?.value.toLowerCase();
  if (word && recurrenceWords[word]) {
    recurrence = recurrenceWords[word];
    index = 1;
  }
  const when = parseWhen(
    tokens.slice(index, index + 2).map((token) => token.value),
    timezone,
    now,
  );
  if (!when.ok) return when;
  const rest = tokens[index + when.used]?.rest ?? '';
  const [rawTitle = '', ...description] = rest.split('|');
  const title = unquote(rawTitle.trim());
  if (!title) return { ok: false, problem: 'title' };
  const body = description.join('|').trim();
  if (title.length > TITLE_LIMIT || body.length > DESCRIPTION_LIMIT) {
    return { ok: false, problem: 'long' };
  }
  return { ok: true, draft: { title, description: body, startsAt: when.at, recurrence } };
}

function unquote(value: string): string {
  const match = /^["“](.*)["”]$/.exec(value);
  return (match ? (match[1] ?? '') : value).trim();
}

export const QUESTION_LIMIT = 250;
export const OPTION_LIMIT = 100;

export interface PollDraft {
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  durationMs: number | null;
}

export type PollProblem = 'question' | 'few' | 'many' | 'long' | 'duplicate';

export type PollDraftResult = { ok: true; draft: PollDraft } | { ok: false; problem: PollProblem };

const anonymousWords = new Set(['anon', 'anonymous', 'secret', 'anonym', 'geheim']);
const multipleWords = new Set(['multi', 'multiple', 'many', 'mehrfach']);

export function parsePollDraft(input: string, defaults: readonly string[] = []): PollDraftResult {
  const tokens = tokenize(input);
  let anonymous = false;
  let multiple = false;
  let durationMs: number | null = null;
  let start: Token | undefined;
  for (const token of tokens) {
    const word = token.value.toLowerCase();
    if (token.rest.startsWith('"') || token.rest.startsWith('“')) {
      start = token;
      break;
    }
    if (anonymousWords.has(word)) anonymous = true;
    else if (multipleWords.has(word)) multiple = true;
    else if (durationMs === null && parseDuration(word)) durationMs = parseDuration(word);
    else {
      start = token;
      break;
    }
  }
  const body = start?.rest.trim() ?? '';
  let parts: string[];
  if (body.includes('|')) {
    parts = body.split('|').map((part) => unquote(part.trim()));
  } else {
    const quoted = [...body.matchAll(/["“]([^"“”]*)["”]/g)].map((m) => (m[1] ?? '').trim());
    parts = quoted.length > 0 ? quoted : [body];
  }
  const [question = '', ...rawOptions] = parts;
  const options = rawOptions.filter((option) => option.length > 0);
  if (!question) return { ok: false, problem: 'question' };
  if (options.length === 0) options.push(...defaults);
  if (options.length < 2) return { ok: false, problem: 'few' };
  if (options.length > POLL_OPTION_LIMIT) return { ok: false, problem: 'many' };
  if (question.length > QUESTION_LIMIT || options.some((option) => option.length > OPTION_LIMIT)) {
    return { ok: false, problem: 'long' };
  }
  const seen = new Set(options.map((option) => option.toLowerCase()));
  if (seen.size !== options.length) return { ok: false, problem: 'duplicate' };
  return { ok: true, draft: { question, options, anonymous, multiple, durationMs } };
}
