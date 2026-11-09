import { catalog } from '../i18n/catalog.js';
import en from '../locales/en/cards.json' with { type: 'json' };

export const cardCopy = catalog('cards', en, (m) => ({
  digest: {
    range: (from: string, to: string) => m.digest.range({ from, to }),
    versus: (change: string) => m.digest.versus({ change }),
  },
  activity: {
    title: (days: number) => m.activity.title({ days: String(days) }),
    range: (from: string, to: string) => m.activity.range({ from, to }),
    peak: (count: string) => m.activity.peak({ count }),
    joined: (count: string) => m.activity.joined({ count }),
    left: (count: string) => m.activity.left({ count }),
  },
}));
