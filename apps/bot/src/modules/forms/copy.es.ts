import { mention } from '../../commands/mentions.js';
import { bold, code, count, lines, orList, subtext, timestamp } from '../../ui/format.js';
import type { FormsCopy } from './copy.js';

const es: FormsCopy = {
  commands: {
    form: 'Solicitudes y otros formularios.',
    start: 'Rellena un formulario, pregunta por pregunta por DM.',
    list: 'Muestra los formularios que puedes rellenar aquí.',
  },
  listTitle: 'Formularios',
  listEmpty: 'Aquí todavía no hay formularios.',
  listLine: (name: string, id: string, questions: number) =>
    `${bold(name)} ${code(id)}  ${count(questions)} ${questions === 1 ? 'pregunta' : 'preguntas'}`,
  listHint: (prefix: string) => `Empieza uno con ${code(`${prefix}form start <name>`)}.`,
  pickForm: (prefix: string) => `¿Cuál? ${code(`${prefix}form list`)} los muestra.`,
  unknownForm: (names: string[]) =>
    names.length
      ? `No hay ningún formulario con ese nombre. Prueba ${names.map((name) => code(name)).join(', ')}.`
      : 'Aquí todavía no hay formularios.',
  closed: (name: string) => `${bold(name)} no acepta respuestas ahora mismo.`,
  needsRole: (roleIds: string[]) =>
    `Para ese formulario necesitas ${orList(roleIds.map((id) => mention.role(id)))}.`,
  alreadyFilling: (name: string) =>
    `Ya estás rellenando ${bold(name)}. Termínalo o responde ${code('cancelar')}.`,
  pending: (name: string) => `Tu ${bold(name)} todavía está en revisión.`,
  once: (name: string) => `Ya enviaste ${bold(name)}.`,
  cooldown: (at: Date) => `Puedes volver a enviarlo ${timestamp(at, 'R')}.`,
  checkDms: 'Revisa tus DMs.',
  continueIn: (channelId: string) => `Sigue en ${mention.channel(channelId)}.`,
  unreachable:
    'No puedo enviarte DMs y no pude abrir un canal. Permite DMs de esta comunidad y vuelve a intentarlo.',
  intro: (form: string, guild: string, description: string) =>
    lines(
      `${bold(form)} para ${bold(guild)}`,
      description || null,
      subtext(`Responde cada pregunta en un mensaje. ${code('cancelar')} lo detiene.`),
    ),
  questionHeader: (index: number, total: number) => subtext(`Pregunta ${index} de ${total}`),
  option: (index: number, text: string) => `${code(String(index))} ${text}`,
  hintChoice: 'Responde con el número o la opción.',
  hintYesNo: 'Responde sí o no.',
  hintNumber: (min: number | null, max: number | null) =>
    min !== null && max !== null
      ? `Responde con un número del ${min} al ${max}.`
      : min !== null
        ? `Responde con un número de al menos ${min}.`
        : max !== null
          ? `Responde con un número hasta ${max}.`
          : 'Responde con un número.',
  hintOptional: `Opcional, ${code('omitir')} la salta.`,
  problemRequired: 'Esta necesita una respuesta.',
  problemNumber: 'Eso no es un número.',
  problemTooSmall: (min: number) => `Tiene que ser al menos ${min}.`,
  problemTooLarge: (max: number) => `Puede ser ${max} como máximo.`,
  problemTooShort: (min: number) => `Es demasiado corto. Al menos ${count(min)} caracteres.`,
  problemTooLong: (max: number) => `Es demasiado largo. ${count(max)} caracteres como máximo.`,
  problemChoice: 'Elige una de las opciones, por número o por nombre.',
  problemYesNo: 'Responde con sí o no.',
  cancelled: 'Cancelado. No se envió nada.',
  expired: (form: string) => `Se acabó el tiempo para ${bold(form)}. No se envió nada.`,
  gone: 'Ese formulario ya está cerrado. No se envió nada.',
  submitted: 'Enviado. Tendrás respuesta aquí.',
  submittedChannel: 'Enviado. Este canal se cierra en un minuto.',
  reviewHint: (accept: string, decline: string) =>
    `Reacciona con ${accept} para aceptar o con ${decline} para rechazar.`,
  reviewVotes: (accept: number, decline: number) =>
    `${count(accept)} a favor, ${count(decline)} en contra`,
  reviewFooter: (number: number, userId: string) => `Envío ${number} / Usuario ${userId}`,
  statusAccepted: (by: string | null) =>
    by ? `**Aceptado** por ${mention.user(by)}` : '**Aceptado** por votación',
  statusDeclined: (by: string | null) =>
    by ? `**Rechazado** por ${mention.user(by)}` : '**Rechazado** por votación',
  statusNote: (text: string) => `**Nota** ${text}`,
  dmAccepted: (form: string, guild: string) => `Tu ${bold(form)} para ${bold(guild)} fue aceptado.`,
  dmDeclined: (form: string, guild: string) =>
    `Tu ${bold(form)} para ${bold(guild)} fue rechazado.`,
  ticketIntro: (form: string, userId: string) => `${bold(form)} de ${mention.user(userId)}`,
  skipped: 'Omitida',
  yes: 'Sí',
  no: 'No',
};

export default es;
