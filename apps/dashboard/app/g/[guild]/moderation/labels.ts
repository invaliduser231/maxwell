import type { Key } from '@/lib/i18n';

export const ACTION_COLORS: Record<string, string> = {
  ban: '#EC5B78',
  kick: '#EC5B78',
  timeout: '#F2C14E',
  warn: '#F2C14E',
  flag: '#3A9EEA',
  unban: '#2EB67D',
  untimeout: '#2EB67D',
};

export const ACTION_NAMES: Record<string, Key> = {
  ban: 'Ban',
  unban: 'Unban',
  kick: 'Kick',
  timeout: 'Timeout',
  untimeout: 'Timeout lifted',
  warn: 'Warn',
  flag: 'Review',
};
