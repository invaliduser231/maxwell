import type { Recurrence } from '@maxwell/core/modules/events';
import {
  addDays,
  fromLocal,
  type LocalDate,
  toLocal,
  weekdayOf,
} from '@maxwell/core/stores/scheduler';

const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function isoDate(date: LocalDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function parseIsoDate(value: string | undefined): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -order.indexOf(weekdayOf(date)));
}

export function weekOf(ms: number, timezone: string): string {
  return isoDate(mondayOf(toLocal(ms, timezone)));
}

export function weekBounds(monday: LocalDate, timezone: string): { from: number; to: number } {
  return {
    from: fromLocal({ ...monday, hour: 0, minute: 0 }, timezone),
    to: fromLocal({ ...addDays(monday, 7), hour: 0, minute: 0 }, timezone),
  };
}

export function dayHeading(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

export function weekHeading(monday: LocalDate): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(monday.year, monday.month - 1, monday.day)));
}

export const recurrenceLabels: Record<Recurrence, string> = {
  none: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
