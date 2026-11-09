import { catalog } from '../i18n/catalog.js';
import en from '../locales/en/ui.json' with { type: 'json' };
import { code } from './format.js';

export const uiCopy = catalog('ui', en, (m) => ({
  ordinal: (n: number) => m.ordinal({ n, value: String(n) }),
  missingPermissions: (list: string) => m.missingPermissions({ list }),
  botMissingPermissions: (list: string, where: string) => m.botMissingPermissions({ list, where }),
  moduleOff: (name: string) => m.moduleOff({ name }),
  tryAgain: (when: string) => m.tryAgain({ when }),
  failed: (errorCode: string) => m.failed({ errorCode: code(errorCode) }),
  args: {
    missing: (name: string) => m.args.missing({ name }),
    user: (name: string) => m.args.user({ name }),
    durationMissing: (name: string) => m.args.durationMissing({ name }),
    between: (name: string, min: number, max: number) =>
      m.args.between({ name, min: String(min), max: String(max) }),
    whole: (name: string) => m.args.whole({ name }),
  },
  unknownCommand: (typed: string, suggestion: string) =>
    m.unknownCommand({ typed: code(typed), suggestion: code(suggestion) }),
  prefixHint: (prefix: string) => m.prefixHint({ prefix: code(prefix) }),
  prefixAgain: (prefix: string) => m.prefixAgain({ prefix: code(prefix) }),
  page: (index: number, total: number) => m.page({ index: String(index), total: String(total) }),
}));
