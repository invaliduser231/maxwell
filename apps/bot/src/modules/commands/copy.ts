import { localized } from '../../i18n/localized.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  notHere: 'That command does not work here.',
  notForYou: 'That command is for certain roles only.',
  needsMember: 'Mention the member.',
  rolesFailed: 'I could not change those roles. My role has to be above them.',
  sampleUser: 'Member',
  sampleServer: 'Server',
};

export type CommandsCopy = typeof en;

export const copy = localized(en, { de, es });

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
