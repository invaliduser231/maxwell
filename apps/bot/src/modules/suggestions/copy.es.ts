import { mention } from '../../commands/mentions.js';
import { bold, count, truncate } from '../../ui/format.js';
import type { SuggestionsCopy } from './copy.js';

const es: SuggestionsCopy = {
  statusNames: {
    open: 'Abierta',
    planned: 'Planeada',
    done: 'Hecha',
    declined: 'Rechazada',
  },
  suggestDescription: 'Publica una sugerencia para que todos voten.',
  title: (id: string) => `Sugerencia ${id}`,
  status: (name: string) => `**Estado** ${name}`,
  reason: (reason: string) => `**Motivo** ${reason}`,
  votes: (up: number, down: number) => `**Votos** ${count(up)} a favor, ${count(down)} en contra`,
  author: (name: string, username: string) => `${name} (@${username})`,
  threadName: (id: string, content: string) =>
    truncate(`${id}: ${content.replace(/\s+/g, ' ').trim()}`, 100),

  posted: (channelId: string) => `Publicada en ${mention.channel(channelId)}.`,
  inChannel: (channelId: string) => `en ${mention.channel(channelId)}`,
  noChannel: 'Las sugerencias todavía no tienen canal. Un admin puede elegir uno en el panel.',
  channelGone: 'El canal de sugerencias ya no existe. Un admin puede elegir otro en el panel.',
  tooLong: 'Máximo 2000 caracteres.',
  empty: 'Me falta la sugerencia.',

  statusDirect: (number: number, server: string, name: string, content: string) =>
    `Tu sugerencia ${number} en ${bold(server)} ahora está ${bold(name)}.\n> ${truncate(content.replace(/\s+/g, ' '), 200)}`,
  statusDirectReason: (reason: string) => `**Motivo** ${reason}`,
};

export default es;
