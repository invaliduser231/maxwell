import type { Translator } from './i18n';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type Moment = string | number | Date;

const FLUXER_EPOCH = 1_420_070_400_000n;

export function toMs(value: Moment): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return value.getTime();
}

export function bytes(t: Translator, value: number): string {
  if (value <= 0) return '0 KB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toLocaleString(t.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
}

export function snowflakeTime(id: string): number | null {
  try {
    return Number((BigInt(id) >> 22n) + FLUXER_EPOCH);
  } catch {
    return null;
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formats.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    if (formats.size > 200) formats.clear();
    formats.set(key, found);
  }
  return found;
}

export function zone(timeZone: string): string {
  try {
    formatter('en-GB', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function dayKey(at: Moment, timeZone: string): string {
  return formatter('en-CA', {
    timeZone: zone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(toMs(at)));
}

function year(at: Moment, timeZone: string): string {
  return formatter('en-GB', { timeZone: zone(timeZone), year: 'numeric' }).format(
    new Date(toMs(at)),
  );
}

function weekday(t: Translator, at: Moment, timeZone: string, style: 'short' | 'long'): string {
  return formatter(t.locale, { timeZone: zone(timeZone), weekday: style }).format(
    new Date(toMs(at)),
  );
}

export function clock(at: Moment, timeZone: string): string {
  return formatter('en-GB', {
    timeZone: zone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(toMs(at)));
}

export function shortDate(t: Translator, at: Moment, timeZone = 'UTC', now?: Moment): string {
  return formatter(t.locale, {
    timeZone: zone(timeZone),
    day: 'numeric',
    month: 'short',
    year: now === undefined || year(at, timeZone) === year(now, timeZone) ? undefined : 'numeric',
  }).format(new Date(toMs(at)));
}

export function date(t: Translator, at: Moment, timeZone: string): string {
  return formatter(t.locale, {
    timeZone: zone(timeZone),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(toMs(at)));
}

export function fullDate(t: Translator, at: Moment, timeZone: string): string {
  return formatter(t.locale, {
    timeZone: zone(timeZone),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(toMs(at)));
}

export function longDate(t: Translator, at: Moment, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const part of formatter(t.locale, {
    timeZone: zone(timeZone),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(toMs(at)))) {
    parts[part.type] = part.value;
  }
  const day = t.lang === 'de' ? `${parts.day}.` : parts.day;
  return `${parts.weekday} ${day} ${parts.month}, ${clock(at, timeZone)}`;
}

function offsetDay(now: Moment, timeZone: string, days: number): string {
  return dayKey(toMs(now) + days * DAY, timeZone);
}

export function dayName(t: Translator, at: Moment, now: Moment, timeZone: string): string {
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return t('Today');
  if (key === offsetDay(now, timeZone, 1)) return t('Tomorrow');
  if (key === offsetDay(now, timeZone, -1)) return t('Yesterday');
  return weekday(t, at, timeZone, 'long');
}

export function dayTime(t: Translator, at: Moment, now: Moment, timeZone: string): string {
  const time = clock(at, timeZone);
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return t('Today {time}', { time });
  if (key === offsetDay(now, timeZone, -1)) return t('Yesterday {time}', { time });
  if (key === offsetDay(now, timeZone, 1)) return t('Tomorrow {time}', { time });
  if (Math.abs(toMs(now) - toMs(at)) < 6 * DAY) {
    return `${weekday(t, at, timeZone, 'short')} ${time}`;
  }
  return `${shortDate(t, at, timeZone, now)} ${time}`;
}

export function when(t: Translator, at: Moment, now: Moment, timeZone: string): string {
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return clock(at, timeZone);
  if (key === offsetDay(now, timeZone, -1)) return t('Yesterday');
  const diff = toMs(now) - toMs(at);
  if (diff >= 0 && diff < 6 * DAY) return weekday(t, at, timeZone, 'long');
  return shortDate(t, at, timeZone, now);
}

export function until(t: Translator, at: Moment, now: Moment, timeZone: string): string {
  if (dayKey(at, timeZone) === dayKey(now, timeZone)) return clock(at, timeZone);
  return shortDate(t, at, timeZone);
}

function minutes(t: Translator, value: number): string {
  return t('{n, plural, one {# minute} other {# minutes}}', { n: value });
}

function hours(t: Translator, value: number): string {
  return t('{n, plural, one {# hour} other {# hours}}', { n: value });
}

function days(t: Translator, value: number): string {
  return t('{n, plural, one {# day} other {# days}}', { n: value });
}

type Unit = 'minute' | 'hour' | 'day';

function past(t: Translator, unit: Unit, value: number): string {
  if (unit === 'minute')
    return t('{n, plural, one {# minute ago} other {# minutes ago}}', { n: value });
  if (unit === 'hour') return t('{n, plural, one {# hour ago} other {# hours ago}}', { n: value });
  return t('{n, plural, one {# day ago} other {# days ago}}', { n: value });
}

function future(t: Translator, unit: Unit, value: number): string {
  if (unit === 'minute')
    return t('{n, plural, one {in # minute} other {in # minutes}}', { n: value });
  if (unit === 'hour') return t('{n, plural, one {in # hour} other {in # hours}}', { n: value });
  return t('{n, plural, one {in # day} other {in # days}}', { n: value });
}

export function ago(t: Translator, at: Moment, now: Moment, timeZone?: string): string {
  const diff = Math.max(0, toMs(now) - toMs(at));
  if (diff < MINUTE) return t('Just now');
  if (diff < HOUR) return past(t, 'minute', Math.floor(diff / MINUTE));
  if (timeZone === undefined) {
    if (diff < DAY) return past(t, 'hour', Math.floor(diff / HOUR));
    const count = Math.floor(diff / DAY);
    if (count === 1) return t('Yesterday');
    if (count < 30) return past(t, 'day', count);
    return shortDate(t, at, 'UTC', now);
  }
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return past(t, 'hour', Math.floor(diff / HOUR));
  if (key === offsetDay(now, timeZone, -1)) return t('Yesterday');
  if (diff < 6 * DAY) return weekday(t, at, timeZone, 'long');
  return shortDate(t, at, timeZone, now);
}

export function relative(t: Translator, at: Moment, now: Moment): string {
  const diff = toMs(at) - toMs(now);
  const abs = Math.abs(diff);
  const sizes: [number, Unit][] = [
    [DAY, 'day'],
    [HOUR, 'hour'],
    [MINUTE, 'minute'],
  ];
  for (const [size, unit] of sizes) {
    if (abs >= size) {
      const value = Math.round(abs / size);
      return diff >= 0 ? future(t, unit, value) : past(t, unit, value);
    }
  }
  return diff >= 0 ? t('in a moment') : t('just now');
}

export function inSentence(t: Translator, text: string): string {
  const words = [t('Today'), t('Tomorrow'), t('Yesterday'), t('Just now')];
  const word = words.find((entry) => text.startsWith(entry));
  return word ? word.toLowerCase() + text.slice(word.length) : text;
}

export function span(t: Translator, ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return days(t, Math.round(ms / DAY));
}

export function since(t: Translator, ms: number): string {
  if (ms < HOUR) return past(t, 'minute', Math.max(1, Math.floor(ms / MINUTE)));
  if (ms < 2 * DAY) return past(t, 'hour', Math.floor(ms / HOUR));
  if (ms < 60 * DAY) return past(t, 'day', Math.floor(ms / DAY));
  if (ms < 730 * DAY) {
    return t('{n, plural, one {# month ago} other {# months ago}}', {
      n: Math.floor(ms / (30 * DAY)),
    });
  }
  return t('{n, plural, one {# year ago} other {# years ago}}', {
    n: Math.floor(ms / (365 * DAY)),
  });
}

export function waited(t: Translator, at: Moment, now: Moment): string {
  const diff = Math.max(0, toMs(now) - toMs(at));
  if (diff < HOUR) return minutes(t, Math.max(1, Math.round(diff / MINUTE)));
  if (diff < DAY) return hours(t, Math.round(diff / HOUR));
  return days(t, Math.round(diff / DAY));
}

const units: [(t: Translator, value: number) => string, number][] = [
  [(t, value) => t('{n, plural, one {# year} other {# years}}', { n: value }), 365 * DAY],
  [(t, value) => t('{n, plural, one {# week} other {# weeks}}', { n: value }), 7 * DAY],
  [days, DAY],
  [hours, HOUR],
  [minutes, MINUTE],
];

export function duration(t: Translator, ms: number): string {
  let left = Math.max(ms, MINUTE);
  const out: string[] = [];
  for (const [label, size] of units) {
    const value = Math.floor(left / size);
    if (value > 0) {
      out.push(label(t, value));
      left -= value * size;
    }
    if (out.length === 2) break;
  }
  return out.join(' ');
}

export function age(t: Translator, ms: number): string {
  if (ms < HOUR) return minutes(t, Math.max(1, Math.floor(ms / MINUTE)));
  if (ms < 2 * DAY) return hours(t, Math.floor(ms / HOUR));
  if (ms < 60 * DAY) return days(t, Math.floor(ms / DAY));
  if (ms < 730 * DAY)
    return t('{n, plural, one {# month} other {# months}}', { n: Math.floor(ms / (30 * DAY)) });
  return t('{n, plural, one {# year} other {# years}}', { n: Math.floor(ms / (365 * DAY)) });
}

export function minutesLabel(t: Translator, value: number): string {
  if (value % 1440 === 0) return days(t, value / 1440);
  if (value % 60 === 0) return hours(t, value / 60);
  if (value > 60) return `${Math.floor(value / 60)} h ${value % 60} min`;
  return minutes(t, value);
}

export function hoursLabel(t: Translator, value: number): string {
  return minutesLabel(t, value * 60);
}
