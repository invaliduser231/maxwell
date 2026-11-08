import { subtext } from '../../ui/format.js';
import type { WelcomeCopy } from './copy.js';

const es: WelcomeCopy = {
  unknownServer: 'la comunidad',
  rulesHint: (emoji: string) => subtext(`Reacciona con ${emoji} para obtener acceso.`),
};

export default es;
