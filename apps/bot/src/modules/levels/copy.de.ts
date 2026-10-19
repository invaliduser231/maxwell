import { mention } from '../../commands/mentions.js';
import { code, count, plural } from '../../ui/format.js';
import type { LevelsCopy } from './copy.js';

const de: LevelsCopy = {
  rankDescription: 'Dein Level und Rang oder der von jemand anderem.',
  levelsDescription: 'Die Rangliste.',
  xpDescription: 'Passt XP von Hand an.',
  giveDescription: 'Gibt einem Mitglied XP.',
  takeDescription: 'Nimmt einem Mitglied XP weg.',
  resetDescription: 'Setzt ein Mitglied auf null zurück.',

  noXpSelf: ['Noch keine XP. Schreib erst mal was.', 'Für dich steht noch nichts auf der Liste.'],
  noXpOther: (userId: string) => `${mention.user(userId)} hat noch keine XP.`,
  emptyBoard: [
    'Die Rangliste ist leer. Irgendwer muss erst mal was schreiben.',
    'Noch hat niemand XP. Ganz schön ruhig hier.',
  ],
  pageTooFar: (pages: number) => `Es gibt nur ${plural(pages, 'Seite', 'Seiten')}.`,
  boardTitle: 'Rangliste',
  community: 'Diese Community',
  boardSubtitle: (community: string, page: number, pages: number) =>
    pages > 1 ? `${community}, Seite ${page} von ${pages}` : community,
  boardYou: (rank: number, level: number) => `Du: #${count(rank)}, Level ${count(level)}`,
  boardNotYou: 'Du stehst noch nicht auf der Liste',
  boardNext: (prefix: string, page: number) => `Nächste Seite: ${code(`${prefix}levels ${page}`)}`,
  levelValue: (level: number) => `Level ${count(level)}`,
  xpValue: (xp: number) => `${count(xp)} XP`,
  rankLine: (level: number, into: number, needed: number) =>
    `**Level ${count(level)}**  ${count(into)} / ${count(needed)} XP bis ${count(level + 1)}`,
  rankPlace: (rank: number, total: number) => `**Rang** #${count(rank)} von ${count(total)}`,
  totalXp: (xp: number) => `**Gesamt** ${count(xp)} XP`,

  gave: (amount: number, userId: string, level: number) =>
    `${mention.user(userId)} hat ${count(amount)} XP bekommen und ist jetzt Level ${count(level)}.`,
  took: (amount: number, userId: string, level: number) =>
    `${mention.user(userId)} hat ${count(amount)} XP verloren. Jetzt Level ${count(level)}.`,
  reset: (userId: string) => `${mention.user(userId)} steht wieder bei null.`,
  nothingToReset: (userId: string) => `${mention.user(userId)} hat keine XP zum Zurücksetzen.`,
  botTarget: 'Bots sammeln keine XP.',

  rewardReason: (level: number) => `Belohnung für Level ${level}`,
  levelUp: '**{name}** ist jetzt Level {level}.',
  levelUpReward: '**{name}** ist jetzt Level {level} und bekommt **{role}**.',
};

export default de;
