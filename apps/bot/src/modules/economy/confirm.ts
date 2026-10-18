import type { IconSet } from '../../ui/icons.js';

const fallback = { yes: '✅', no: '❌' };

export interface Confirm {
  yes: string;
  no: string;
  yesLabel: string;
  noLabel: string;
}

function label(emoji: string, inline: string): string {
  const trimmed = inline.trim();
  return trimmed || emoji;
}

export function confirmEmojis(icons: IconSet): Confirm {
  const yes = icons.reaction('ok') ?? fallback.yes;
  const no = icons.reaction('no') ?? fallback.no;
  return {
    yes,
    no,
    yesLabel: label(yes, icons.inline('ok')),
    noLabel: label(no, icons.inline('no')),
  };
}
