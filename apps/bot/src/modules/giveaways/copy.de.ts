import { mention } from '../../commands/mentions.js';
import { bold, count, plural, timestamp } from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import type { GiveawaysCopy } from './copy.js';
import type { Unmet } from './draw.js';

const de: GiveawaysCopy = {
  giveawayDescription: 'Startet, beendet und verlost Giveaways neu.',
  startDescription: 'Startet ein Giveaway hier oder in einem anderen Kanal.',
  endDescription: 'Beendet ein Giveaway sofort und lost die Gewinner aus.',
  rerollDescription: 'Lost für ein beendetes Giveaway neue Gewinner aus.',
  listDescription: 'Laufende und geplante Giveaways.',

  enter: (emoji: string) => `Reagier mit ${emoji}, um mitzumachen.`,
  ends: (at: Date) => `**Endet** ${timestamp(at, 'R')} (${timestamp(at, 'f')})`,
  ended: (at: Date) => `**Beendet** ${timestamp(at, 'R')}`,
  winnersCount: (n: number) => `**Gewinner** ${count(n)}`,
  winnersList: (ids: readonly string[]) => `**Gewinner** ${ids.map(mention.user).join(', ')}`,
  rerolled: (ids: readonly string[]) => `**Neu gelost** ${ids.map(mention.user).join(', ')}`,
  noWinners: 'Keine gültigen Teilnahmen, also hat niemand gewonnen.',
  host: (id: string) => `**Veranstaltet von** ${mention.user(id)}`,
  entries: (n: number) => `**Teilnahmen** ${count(n)}`,
  needs: (parts: readonly string[]) => `**Braucht** ${parts.join(', ')}`,
  needRole: (roleId: string) => mention.role(roleId),
  needLevel: (level: number) => `Level ${count(level)}`,
  needDays: (days: number) => `${plural(days, 'Tag', 'Tage')} in der Community`,
  notFor: (roleId: string) => `**Nicht für** ${mention.role(roleId)}`,
  bonus: (parts: readonly { roleId: string; entries: number }[]) =>
    `**Extra-Lose** ${parts.map((part) => `${mention.role(part.roleId)} +${part.entries}`).join(', ')}`,
  footer: (number: number) => `Giveaway ${number}`,

  won: (ids: readonly string[], prize: string) =>
    `${andList(ids.map(mention.user))} ${ids.length === 1 ? 'hat' : 'haben'} ${bold(prize)} gewonnen.`,
  nobodyWon: (prize: string) =>
    `Beim Giveaway für ${bold(prize)} hat niemand mitgemacht, also gibt es keinen Gewinner.`,
  newWinners: (ids: readonly string[], prize: string) =>
    `${ids.length === 1 ? 'Neuer Gewinner' : 'Neue Gewinner'} für ${bold(prize)}: ${andList(ids.map(mention.user))}.`,
  nobodyLeft: (prize: string) =>
    `Für ${bold(prize)} ist niemand mehr übrig, der gezogen werden kann.`,
  wonDirect: (prize: string, server: string) =>
    `Du hast ${bold(prize)} in ${bold(server)} gewonnen.`,
  theCommunity: 'der Community',
  inChannel: (channelId: string) => `in ${mention.channel(channelId)}`,

  unmet: (
    reason: Unmet,
    prize: string,
    detail: { role: string | null; level: number; days: number },
  ) => {
    const lead = `Beim Giveaway für ${bold(prize)} kannst du noch nicht mitmachen.`;
    switch (reason) {
      case 'excluded':
        return detail.role
          ? `${lead} Mitglieder mit der Rolle ${bold(detail.role)} sind ausgeschlossen.`
          : `${lead} Eine deiner Rollen ist ausgeschlossen.`;
      case 'role':
        return detail.role
          ? `${lead} Dafür brauchst du die Rolle ${bold(detail.role)}.`
          : `${lead} Dafür brauchst du eine Rolle, die du nicht hast.`;
      case 'level':
        return `${lead} Dafür brauchst du Level ${count(detail.level)}.`;
      case 'age':
        return `${lead} Dafür musst du ${plural(detail.days, 'Tag', 'Tage')} in der Community sein.`;
    }
  },

  started: (number: number, channelId: string) =>
    `Giveaway ${number} läuft in ${mention.channel(channelId)}.`,
  endedNow: (number: number) => `Giveaway ${number} ist beendet.`,
  rerolledNow: (number: number) => `Die neuen Gewinner für Giveaway ${number} stehen fest.`,
  tooShort: 'Ein Giveaway läuft mindestens eine Minute.',
  tooLong: 'Ein Giveaway läuft höchstens 60 Tage.',
  prizeTooLong: 'Der Preis darf höchstens 256 Zeichen lang sein.',
  badOption: (flag: string) =>
    `\`--${flag}\` kenne ich nicht. Es gibt \`--role\`, \`--not\` und \`--ping\` mit einer Rolle, \`--level\` und \`--days\` mit einer Zahl und \`--nodm\`.`,
  notFound: (number: number) => `Ein Giveaway ${number} gibt es hier nicht.`,
  noneRunning: 'Gerade läuft kein Giveaway.',
  noneEnded: 'Es ist noch kein Giveaway beendet.',
  notRunning: (number: number) => `Giveaway ${number} läuft nicht.`,
  notEnded: (number: number) => `Giveaway ${number} ist noch nicht beendet.`,
  channelGone: 'Diesen Kanal sehe ich nicht.',
  listTitle: 'Giveaways',
  listRunning: (number: number, prize: string, channelId: string, endsAt: Date, winners: number) =>
    `\`${number}\` ${bold(prize)} in ${mention.channel(channelId)}, endet ${timestamp(endsAt, 'R')}, ${plural(winners, 'Gewinner', 'Gewinner')}`,
  listScheduled: (number: number, prize: string, channelId: string, startsAt: Date) =>
    `\`${number}\` ${bold(prize)} in ${mention.channel(channelId)}, startet ${timestamp(startsAt, 'R')}`,
  emptyList: ['Gerade läuft kein Giveaway. Die Großzügigkeit macht Pause.', 'Gerade läuft nichts.'],
};

export default de;
