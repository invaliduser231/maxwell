import { subtext } from '../../ui/format.js';
import type { WelcomeCopy } from './copy.js';

const de: WelcomeCopy = {
  unknownServer: 'die Community',
  rulesHint: (emoji: string) => subtext(`Reagiere mit ${emoji}, um Zugang zu bekommen.`),
};

export default de;
