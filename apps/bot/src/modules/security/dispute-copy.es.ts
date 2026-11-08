import type { DisputeCopy } from './dispute-copy.js';

const es: DisputeCopy = {
  removed: 'Se aceptó tu reclamación a Maxwell Shield. Ya no apareces en la lista.',
  kept: 'Se rechazó tu reclamación a Maxwell Shield. La entrada se mantiene.',
  note: (note: string) => `Nota: ${note}`,
  link: (url: string) => `Detalles: ${url}`,
};

export default es;
