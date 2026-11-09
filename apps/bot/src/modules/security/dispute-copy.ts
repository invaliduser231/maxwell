import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/security-dispute.json' with { type: 'json' };

export const disputeCopy = catalog('security-dispute', en, (m) => ({
  note: (note: string) => m.note({ note }),
  link: (url: string) => m.link({ url }),
}));
