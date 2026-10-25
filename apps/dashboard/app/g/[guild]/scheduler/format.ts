import type { ScheduleRule, Weekday } from '@maxwell/core/modules/scheduler';

export const weekdayLabels: Record<Weekday, string> = {
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

export function ruleLabel(rule: ScheduleRule, order: readonly Weekday[]): string {
  switch (rule.type) {
    case 'once':
      return `once at ${timeOf(rule)}`;
    case 'daily':
      return `daily at ${rule.time}`;
    case 'weekly': {
      const days = order.filter((day) => rule.days.includes(day)).map((day) => weekdayLabels[day]);
      return `every ${days.join(', ')} at ${rule.time}`;
    }
    case 'interval':
      return rule.hours === 1 ? 'every hour' : `every ${rule.hours} hours`;
  }
}

export function ruleShort(rule: ScheduleRule): string {
  switch (rule.type) {
    case 'once':
      return 'Once';
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'interval':
      return `Every ${rule.hours} h`;
  }
}
