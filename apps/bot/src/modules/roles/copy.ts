import type { MenuType } from '@maxwell/core/modules/roles';
import { formatDuration } from '../../commands/duration.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/roles.json' with { type: 'json' };
import { subtext } from '../../ui/format.js';

function hint(text: string): string | null {
  return text ? subtext(text) : null;
}

export const copy = catalog('roles', en, (m) => ({
  menuHint: (type: MenuType, minutes: number, limit = 1) =>
    hint(m.menuHint({ type, duration: formatDuration(minutes * 60_000), limit })),
}));

export const reasons = {
  menu: 'Role menu',
  menuSwap: 'Role menu, swapped for another role',
  temporaryEnded: 'Temporary role ran out',
  autorole: 'Autorole',
  timeRole: 'Time in the server',
  sticky: 'Sticky role from before',
  stickyUndo: 'Sticky roles undone',
  activityRole: 'Active in the community',
  activityRoleEnded: 'No longer active enough',
};

export const audit = {
  menuPosted: (title: string) => `Posted the role menu "${title}"`,
  menuUpdated: (title: string) => `Updated the role menu "${title}"`,
  menuRemoved: (title: string) => `Removed the role menu "${title}"`,
  menuRoleGone: (count: number) =>
    count === 1
      ? 'Removed a deleted role from a role menu'
      : `Removed a deleted role from ${count} role menus`,
  stickyRestored: (name: string, count: number) =>
    `Gave ${name} back ${count === 1 ? 'a sticky role' : `${count} sticky roles`} after a rejoin`,
};
