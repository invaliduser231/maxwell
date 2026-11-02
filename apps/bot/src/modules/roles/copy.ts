import type { MenuType } from '@maxwell/core/modules/roles';
import { formatDuration } from '../../commands/duration.js';
import { localized } from '../../i18n/localized.js';
import { subtext } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  menuHint(type: MenuType, minutes: number, limit = 1): string | null {
    switch (type) {
      case 'unique':
        return subtext('One role at a time.');
      case 'add':
        return subtext('Roles stay when you remove the reaction.');
      case 'temporary':
        return subtext(`Roles last ${formatDuration(minutes * 60_000)}.`);
      case 'verify':
        return subtext('React to get the role.');
      case 'remove':
        return subtext('React to drop the role.');
      case 'binding':
        return subtext('Pick once. The choice is final.');
      case 'limit':
        return subtext(limit === 1 ? 'Up to 1 role.' : `Up to ${limit} roles.`);
      default:
        return null;
    }
  },
};

export type RolesCopy = typeof en;

export const copy = localized(en, { de });

export const reasons = {
  menu: 'Role menu',
  menuSwap: 'Role menu, swapped for another role',
  temporaryEnded: 'Temporary role ran out',
  autorole: 'Autorole',
  timeRole: 'Time in the server',
  sticky: 'Sticky role from before',
  stickyUndo: 'Sticky roles undone',
};

export const audit = {
  menuPosted: (title: string) => `Posted the role menu "${title}"`,
  menuUpdated: (title: string) => `Updated the role menu "${title}"`,
  menuRemoved: (title: string) => `Removed the role menu "${title}"`,
  stickyRestored: (name: string, count: number) =>
    `Gave ${name} back ${count === 1 ? 'a sticky role' : `${count} sticky roles`} after a rejoin`,
};
