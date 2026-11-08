import { localized } from '../../i18n/localized.js';
import de from './dispute-copy.de.js';
import es from './dispute-copy.es.js';

const en = {
  removed: 'Your Maxwell Shield dispute was accepted. You are no longer listed.',
  kept: 'Your Maxwell Shield dispute was declined. The listing stays.',
  note: (note: string) => `Note: ${note}`,
  link: (url: string) => `Details: ${url}`,
};

export type DisputeCopy = typeof en;

export const disputeCopy = localized(en, { de, es });
