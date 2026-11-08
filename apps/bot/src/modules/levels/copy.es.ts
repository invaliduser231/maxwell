import { mention } from '../../commands/mentions.js';
import { code, count, plural } from '../../ui/format.js';
import type { LevelsCopy } from './copy.js';

const es: LevelsCopy = {
  rankDescription: 'Tu nivel y rango, o los de otra persona.',
  levelsDescription: 'La clasificación.',
  xpDescription: 'Ajusta XP a mano.',
  giveDescription: 'Da XP a un miembro.',
  takeDescription: 'Quita XP a un miembro.',
  resetDescription: 'Devuelve a un miembro a cero.',
  hideDescription: 'Te oculta de la página pública de la comunidad.',
  showDescription: 'Vuelve a mostrarte en la página pública de la comunidad.',

  noXpSelf: ['Todavía no tienes XP. Primero di algo.', 'Todavía no apareces en la clasificación.'],
  noXpOther: (userId: string) => `${mention.user(userId)} todavía no tiene XP.`,
  emptyBoard: [
    'La clasificación está vacía. Alguien tiene que decir algo primero.',
    'Nadie tiene XP todavía. Esto está tranquilo.',
  ],
  pageTooFar: (pages: number) => `Solo hay ${plural(pages, 'página', 'páginas')}.`,
  boardTitle: 'Clasificación',
  community: 'Esta comunidad',
  boardSubtitle: (community: string, page: number, pages: number) =>
    pages > 1 ? `${community}, página ${page} de ${pages}` : community,
  boardYou: (rank: number, level: number) => `Tú: #${count(rank)}, nivel ${count(level)}`,
  boardNotYou: 'Todavía no apareces en la clasificación',
  boardNext: (prefix: string, page: number) =>
    `Página siguiente: ${code(`${prefix}levels ${page}`)}`,
  levelValue: (level: number) => `Nivel ${count(level)}`,
  xpValue: (xp: number) => `${count(xp)} XP`,
  rankLine: (level: number, into: number, needed: number) =>
    `**Nivel ${count(level)}**  ${count(into)} / ${count(needed)} XP para el ${count(level + 1)}`,
  rankPlace: (rank: number, total: number) => `**Rango** #${count(rank)} de ${count(total)}`,
  totalXp: (xp: number) => `**Total** ${count(xp)} XP`,

  gave: (amount: number, userId: string, level: number) =>
    `${mention.user(userId)} recibió ${count(amount)} XP y está en el nivel ${count(level)}.`,
  took: (amount: number, userId: string, level: number) =>
    `Le quité ${count(amount)} XP a ${mention.user(userId)}. Ahora está en el nivel ${count(level)}.`,
  reset: (userId: string) => `${mention.user(userId)} vuelve a estar en cero.`,
  nothingToReset: (userId: string) => `${mention.user(userId)} no tiene XP que reiniciar.`,
  botTarget: 'Los bots no acumulan XP.',
  hidden:
    'Ya no apareces en la página pública de la comunidad. Las clasificaciones en el chat te siguen mostrando.',
  alreadyHidden: 'Ya estás fuera de la página pública de la comunidad.',
  shown: 'Puedes volver a aparecer en la página pública de la comunidad.',
  alreadyShown: 'Ya apareces en la página pública de la comunidad.',

  rewardReason: (level: number) => `Recompensa del nivel ${level}`,
  levelUp: '**{name}** ahora está en el nivel {level}.',
  levelUpReward: '**{name}** ahora está en el nivel {level} y recibe **{role}**.',
};

export default es;
