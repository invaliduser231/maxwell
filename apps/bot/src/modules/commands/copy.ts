import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/commands.json' with { type: 'json' };

export const copy = catalog('commands', en, () => ({}));

export const reasons = {
  role: (name: string) => `Custom command ${name}`,
  undo: 'Undone from the audit trail',
  rolesSummary: (name: string, userId: string, added: number, removed: number) => {
    const parts = [
      added > 0 ? `gave <@${userId}> ${added === 1 ? 'a role' : `${added} roles`}` : null,
      removed > 0
        ? `took ${removed === 1 ? 'a role' : `${removed} roles`} from <@${userId}>`
        : null,
    ].filter(Boolean);
    return `Custom command ${name} ${parts.join(' and ')}`;
  },
};
