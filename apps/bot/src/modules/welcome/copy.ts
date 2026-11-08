import { localized } from '../../i18n/localized.js';
import { subtext } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  unknownServer: 'the server',
  rulesHint: (emoji: string) => subtext(`React with ${emoji} to get access.`),
};

export type WelcomeCopy = typeof en;

export const copy = localized(en, { de, es });

export const reasons = {
  accepted: 'Accepted the rules',
  unaccepted: 'Took back the rules reaction',
  returning: 'Accepted the rules before',
  delayed: 'Welcome roles after a delay',
  audit: {
    rulesPosted: 'Posted the rules message',
    rulesUpdated: 'Updated the rules message',
    rulesAttached: 'Linked the rules reaction to an existing message',
    rulesRemoved: 'Removed the rules message',
  },
};
