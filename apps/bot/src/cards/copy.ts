import { localized } from '../i18n/localized.js';
import de from './copy.de.js';

const en = {
  level: 'Level',
  rank: 'Rank',
  levelWord: 'Level ',
  unlocked: 'Unlocked ',
};

export type CardCopy = typeof en;

export const cardCopy = localized(en, { de });
