import type { ScheduleRule, Weekday } from '@maxwell/core/modules/scheduler';
import type { Key, Translator } from '@/lib/i18n';

export const weekdayLabels: Record<Weekday, Key> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export function timeOf(rule: ScheduleRule): string {
  switch (rule.type) {
    case 'once':
      return rule.at.slice(11);
    case 'interval':
      return rule.start.slice(11);
    default:
      return rule.time;
  }
}

export function ruleLabel(t: Translator, rule: ScheduleRule, order: readonly Weekday[]): string {
  switch (rule.type) {
    case 'once':
      return t('once at {time}', { time: timeOf(rule) });
    case 'daily':
      return t('daily at {time}', { time: rule.time });
    case 'weekly': {
      const days = order
        .filter((day) => rule.days.includes(day))
        .map((day) => t(weekdayLabels[day]));
      return t('every {days} at {time}', { days: days.join(', '), time: rule.time });
    }
    case 'interval':
      return t('{n, plural, one {every hour} other {every # hours}}', { n: rule.hours });
  }
}

export function ruleShort(t: Translator, rule: ScheduleRule): string {
  switch (rule.type) {
    case 'once':
      return t('Once');
    case 'daily':
      return t('Daily');
    case 'weekly':
      return t('Weekly');
    case 'interval':
      return t('Every {n} h', { n: rule.hours });
  }
}
