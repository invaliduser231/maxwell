import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/welcome.json' with { type: 'json' };
import { subtext } from '../../ui/format.js';

export const copy = catalog('welcome', en, (m) => ({
  rulesHint: (emoji: string) => subtext(m.rulesHint({ emoji })),
}));

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
