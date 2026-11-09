import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/backups.json' with { type: 'json' };

export const copy = catalog('backups', en, (m) => ({
  saved: (number: number, roles: number, channels: number) =>
    m.saved({ number: String(number), roles: String(roles), channels: String(channels) }),
  listLine: (number: number, kind: string, when: string, roles: number, channels: number) =>
    m.listLine({
      number: String(number),
      kind,
      when,
      roles: String(roles),
      channels: String(channels),
    }),
  listLabel: (label: string) => m.listLabel({ label }),
  empty: (prefix: string) => m.empty({ prefix }),
}));

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
  afterRestore: 'After an automatic restore',
  auditRoleDeleted: (name: string) => `Role ${name} was deleted`,
  auditChannelDeleted: (name: string) => `Channel #${name} was deleted`,
  auditImport: (name: string) => `Imported the Discord template ${name}`,
  auditImportTemplate: (name: string) => `Imported the template ${name}`,

  restoreReason: (number: number) => `Restore from snapshot #${number}`,
  recreateReason: 'Undo of a deletion',
  importReason: (name: string) => `Discord template ${name}`,
  templateReason: (name: string) => `Template ${name}`,
  undoReason: 'Undo',

  templateNotFound: 'That template does not exist or is no longer shared.',
  templateUnavailable: 'Discord did not answer. Try again in a few minutes.',
  templateInvalid: 'That does not look like a Discord template link.',
  templateGone: 'That template is no longer published.',
  templateBroken: 'That template could not be loaded. Try again in a few minutes.',
  skippedType: (type: number) => `Channel type ${type} has no match here`,
  skippedLimit: 'Over the limit',
  importFailed: 'The import stopped partway. What was created can be undone in the audit trail.',
};
