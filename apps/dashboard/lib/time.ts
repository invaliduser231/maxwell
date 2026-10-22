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

export function count(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

export function bytes(value: number): string {
  if (value <= 0) return '0 KB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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

function weekday(at: Moment, timeZone: string, style: 'short' | 'long'): string {
  return formatter('en-GB', { timeZone: zone(timeZone), weekday: style }).format(
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

export function shortDate(at: Moment, timeZone = 'UTC', now?: Moment): string {
  return formatter('en-GB', {
    timeZone: zone(timeZone),
    day: 'numeric',
    month: 'short',
    year: now === undefined || year(at, timeZone) === year(now, timeZone) ? undefined : 'numeric',
  }).format(new Date(toMs(at)));
}

export function date(at: Moment, timeZone: string): string {
  return formatter('en-GB', {
    timeZone: zone(timeZone),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(toMs(at)));
}

export function fullDate(at: Moment, timeZone: string): string {
  return formatter('en-GB', {
    timeZone: zone(timeZone),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(toMs(at)));
}

export function longDate(at: Moment, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const part of formatter('en-GB', {
    timeZone: zone(timeZone),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(toMs(at)))) {
    parts[part.type] = part.value;
  }
  return `${parts.weekday} ${parts.day} ${parts.month}, ${clock(at, timeZone)}`;
}

function offsetDay(now: Moment, timeZone: string, days: number): string {
  return dayKey(toMs(now) + days * DAY, timeZone);
}

export function dayName(at: Moment, now: Moment, timeZone: string): string {
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return 'Today';
  if (key === offsetDay(now, timeZone, 1)) return 'Tomorrow';
  if (key === offsetDay(now, timeZone, -1)) return 'Yesterday';
  return weekday(at, timeZone, 'long');
}

export function dayTime(at: Moment, now: Moment, timeZone: string): string {
  const time = clock(at, timeZone);
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return `Today ${time}`;
  if (key === offsetDay(now, timeZone, -1)) return `Yesterday ${time}`;
  if (key === offsetDay(now, timeZone, 1)) return `Tomorrow ${time}`;
  if (Math.abs(toMs(now) - toMs(at)) < 6 * DAY) return `${weekday(at, timeZone, 'short')} ${time}`;
  return `${shortDate(at, timeZone, now)} ${time}`;
}

export function when(at: Moment, now: Moment, timeZone: string): string {
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return clock(at, timeZone);
  if (key === offsetDay(now, timeZone, -1)) return 'Yesterday';
  const diff = toMs(now) - toMs(at);
  if (diff >= 0 && diff < 6 * DAY) return weekday(at, timeZone, 'long');
  return shortDate(at, timeZone, now);
}

export function until(at: Moment, now: Moment, timeZone: string): string {
  if (dayKey(at, timeZone) === dayKey(now, timeZone)) return clock(at, timeZone);
  return shortDate(at, timeZone);
}

export function ago(at: Moment, now: Moment, timeZone?: string): string {
  const diff = Math.max(0, toMs(now) - toMs(at));
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), 'minute')} ago`;
  if (timeZone === undefined) {
    if (diff < DAY) return `${plural(Math.floor(diff / HOUR), 'hour')} ago`;
    const days = Math.floor(diff / DAY);
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return shortDate(at, 'UTC', now);
  }
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return `${plural(Math.floor(diff / HOUR), 'hour')} ago`;
  if (key === offsetDay(now, timeZone, -1)) return 'Yesterday';
  if (diff < 6 * DAY) return weekday(at, timeZone, 'long');
  return shortDate(at, timeZone, now);
}

export function relative(at: Moment, now: Moment): string {
  const diff = toMs(at) - toMs(now);
  const abs = Math.abs(diff);
  for (const [size, unit] of [
    [DAY, 'day'],
    [HOUR, 'hour'],
    [MINUTE, 'minute'],
  ] as const) {
    if (abs >= size) {
      const label = plural(Math.round(abs / size), unit);
      return diff >= 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return diff >= 0 ? 'in a moment' : 'just now';
}

export function inSentence(text: string): string {
  return text.replace(/^(Today|Tomorrow|Yesterday|Just now)/, (word) => word.toLowerCase());
}

export function span(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  return days === 1 ? '1 day' : `${days} days`;
}

export function waited(at: Moment, now: Moment): string {
  const diff = Math.max(0, toMs(now) - toMs(at));
  if (diff < HOUR) return plural(Math.max(1, Math.round(diff / MINUTE)), 'minute');
  if (diff < DAY) return plural(Math.round(diff / HOUR), 'hour');
  return plural(Math.round(diff / DAY), 'day');
}

const units: [string, number][] = [
  ['year', 365 * DAY],
  ['week', 7 * DAY],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
];

export function duration(ms: number): string {
  let left = Math.max(ms, MINUTE);
  const out: string[] = [];
  for (const [label, size] of units) {
    const value = Math.floor(left / size);
    if (value > 0) {
      out.push(plural(value, label));
      left -= value * size;
    }
    if (out.length === 2) break;
  }
  return out.join(' ');
}

export function age(ms: number): string {
  if (ms < HOUR) return plural(Math.max(1, Math.floor(ms / MINUTE)), 'minute');
  if (ms < 2 * DAY) return plural(Math.floor(ms / HOUR), 'hour');
  if (ms < 60 * DAY) return plural(Math.floor(ms / DAY), 'day');
  if (ms < 730 * DAY) return plural(Math.floor(ms / (30 * DAY)), 'month');
  return plural(Math.floor(ms / (365 * DAY)), 'year');
}

export function minutesLabel(minutes: number): string {
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  if (minutes > 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return plural(minutes, 'minute');
}

export function hoursLabel(hours: number): string {
  return minutesLabel(hours * 60);
}
