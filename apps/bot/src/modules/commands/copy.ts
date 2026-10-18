import { localized } from '../../i18n/localized.js';
import de from './copy.de.js';

const en = {
  notHere: 'That command does not work here.',
  notForYou: 'That command is for certain roles only.',
  sampleUser: 'Member',
  sampleServer: 'Server',
};

export type CommandsCopy = typeof en;

export const copy = localized(en, { de });

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
