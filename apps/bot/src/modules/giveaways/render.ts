import type { Giveaway, Winner } from '@maxwell/core/stores/giveaways';
import type { Embed } from '../../platform/types.js';
import { lines, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';
import { displayEmoji } from './draw.js';

function requirements(giveaway: Giveaway): string | null {
  const parts = [
    giveaway.requiredRoleId && copy.needRole(giveaway.requiredRoleId),
    giveaway.minLevel > 0 && copy.needLevel(giveaway.minLevel),
    giveaway.minMemberDays > 0 && copy.needDays(giveaway.minMemberDays),
  ].filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? copy.needs(parts) : null;
}

export function runningEmbed(giveaway: Giveaway): Embed {
  return {
    color: palette.north,
    title: truncate(giveaway.prize, 256),
    description: lines(
      giveaway.description && truncate(giveaway.description, 1000),
      giveaway.description && '',
      copy.enter(displayEmoji(giveaway.emoji)),
      '',
      copy.ends(giveaway.endsAt),
      copy.winnersCount(giveaway.winners),
      giveaway.hostId && copy.host(giveaway.hostId),
      requirements(giveaway),
      giveaway.excludedRoleId && copy.notFor(giveaway.excludedRoleId),
      giveaway.bonus.length > 0 && copy.bonus(giveaway.bonus),
    ),
    footer: copy.footer(giveaway.number),
  };
}

export function endedEmbed(giveaway: Giveaway, winners: readonly Winner[], entries: number): Embed {
  const first = winners.filter((winner) => winner.round === 1).map((winner) => winner.userId);
  const later = winners.filter((winner) => winner.round > 1).map((winner) => winner.userId);
  return {
    color: palette.muted,
    title: truncate(giveaway.prize, 256),
    description: lines(
      first.length > 0 ? copy.winnersList(first) : copy.noWinners,
      later.length > 0 && copy.rerolled(later),
      '',
      copy.ended(giveaway.endedAt ?? new Date()),
      copy.entries(entries),
      giveaway.hostId && copy.host(giveaway.hostId),
    ),
    footer: copy.footer(giveaway.number),
  };
}
