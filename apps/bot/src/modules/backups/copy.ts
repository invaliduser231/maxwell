import { localized } from '../../i18n/localized.js';
import { code } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  commands: {
    backup: 'Snapshots of roles, channels and settings.',
    now: 'Takes a snapshot of roles, channels and settings.',
    list: 'Lists the saved snapshots.',
  },
  kinds: {
    daily: 'daily',
    manual: 'manual',
  },
  saved: (number: number, roles: number, channels: number) =>
    `Snapshot #${number} saved with **${roles}** roles and **${channels}** channels.`,
  listTitle: 'Snapshots',
  listLine: (number: number, kind: string, when: string, roles: number, channels: number) =>
    `\`#${number}\`  ${when}  ${kind}  ${roles} roles, ${channels} channels`,
  listLabel: (label: string) => `*${label}*`,
  listFooter: 'Compare and restore them in the dashboard.',
  empty: (prefix: string) => [
    `No snapshots yet. ${code(`${prefix}backup now`)} takes one.`,
    `Nothing saved yet. ${code(`${prefix}backup now`)} takes the first snapshot.`,
  ],
  failed: 'The snapshot failed. Check that I can see all channels and roles, then try again.',
};

export type BackupsCopy = typeof en;

export const copy = localized(en, { de });

export const audit = {
  auditSnapshot: (number: number) => `Took snapshot #${number}`,
  auditRestoreFull: (number: number) => `Restored snapshot #${number}`,
  auditRestoreRole: (name: string, number: number) =>
    `Restored role ${name} from snapshot #${number}`,
  auditRestoreChannel: (name: string, number: number) =>
    `Restored channel #${name} from snapshot #${number}`,
  auditRestoreModules: (number: number) => `Restored settings from snapshot #${number}`,
  auditRestorePick: (count: number, number: number) =>
    `Restored ${count} ${count === 1 ? 'item' : 'items'} from snapshot #${number}`,
  beforeRestore: 'Before restore',
  auditRoleDeleted: (name: string) => `Role ${name} was deleted`,
  auditChannelDeleted: (name: string) => `Channel #${name} was deleted`,
  auditImport: (name: string) => `Imported the Discord template ${name}`,

  restoreReason: (number: number) => `Restore from snapshot #${number}`,
  recreateReason: 'Undo of a deletion',
  importReason: (name: string) => `Discord template ${name}`,
  undoReason: 'Undo',

  templateNotFound: 'That template does not exist or is no longer shared.',
  templateUnavailable: 'Discord did not answer. Try again in a few minutes.',
  templateInvalid: 'That does not look like a Discord template link.',
  skippedType: (type: number) => `Channel type ${type} has no match here`,
  skippedLimit: 'Over the limit',
  importFailed: 'The import stopped partway. What was created can be undone in the audit trail.',
};
