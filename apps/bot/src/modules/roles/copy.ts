import type { MenuType } from '@maxwell/core/modules/roles';
import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/roles.json' with { type: 'json' };
import { code, subtext } from '../../ui/format.js';

function hint(text: string): string | null {
  return text ? subtext(text) : null;
}

export type BulkMode = 'add' | 'remove';

export const copy = catalog('roles', en, (m) => ({
  menuHint: (type: MenuType, minutes: number, limit = 1) =>
    hint(m.menuHint({ type, duration: formatDuration(minutes * 60_000), limit })),
  bulk: {
    confirm: (mode: BulkMode, roleId: string, members: number, minutes: number) =>
      m.bulk.confirm({ mode, role: mention.role(roleId), members, minutes }),
    confirmHint: (icon: string) => subtext(m.bulk.confirmHint({ icon })),
    progress: (mode: BulkMode, roleId: string, done: number, changed: number) =>
      m.bulk.progress({ mode, role: mention.role(roleId), done, changed }),
    done: (mode: BulkMode, roleId: string, changed: number) =>
      m.bulk.done({ mode, role: mention.role(roleId), changed }),
    failed: (failed: number) => subtext(m.bulk.failed({ failed })),
    stopped: (changed: number) => m.bulk.stopped({ changed }),
    stopHint: (prefix: string) => subtext(m.bulk.stopHint({ command: code(`${prefix}role stop`) })),
    running: (roleId: string, prefix: string) =>
      m.bulk.running({ role: mention.role(roleId), command: code(`${prefix}role stop`) }),
    managed: (roleId: string) => m.bulk.managed({ role: mention.role(roleId) }),
    dangerous: (roleId: string, permissions: string) =>
      m.bulk.dangerous({ role: mention.role(roleId), permissions }),
    tooHighBot: (roleId: string) => m.bulk.tooHighBot({ role: mention.role(roleId) }),
    tooHighYou: (roleId: string) => m.bulk.tooHighYou({ role: mention.role(roleId) }),
  },
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
  bulkAdd: 'Role given to everyone',
  bulkRemove: 'Role taken from everyone',
};

export const audit = {
  bulkStarted: (mode: BulkMode, role: string) =>
    mode === 'add' ? `Started giving ${role} to everyone` : `Started taking ${role} from everyone`,
  bulkFinished: (mode: BulkMode, role: string, changed: number) =>
    mode === 'add'
      ? `Gave ${role} to ${changed} ${changed === 1 ? 'member' : 'members'}`
      : `Took ${role} from ${changed} ${changed === 1 ? 'member' : 'members'}`,
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
