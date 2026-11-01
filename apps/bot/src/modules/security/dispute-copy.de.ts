import type { DisputeCopy } from './dispute-copy.js';

const de: DisputeCopy = {
  removed: 'Dein Widerspruch zu Maxwell Shield wurde angenommen. Du bist nicht mehr gelistet.',
  kept: 'Dein Widerspruch zu Maxwell Shield wurde abgelehnt. Der Eintrag bleibt.',
  note: (note: string) => `Hinweis: ${note}`,
  link: (url: string) => `Details: ${url}`,
};

export default de;
