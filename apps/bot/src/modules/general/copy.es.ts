import { code } from '../../ui/format.js';
import type { GeneralCopy } from './copy.js';

const es: GeneralCopy = {
  commands: {
    ping: 'Comprueba que estoy despierto y lo rápido que respondo.',
    help: 'Muestra lo que puedo hacer o explica un módulo o comando.',
    prefix: 'Muestra el prefijo o lo cambia para esta comunidad.',
    about: 'Quién soy y cómo estoy.',
    entropy: 'Qué tan ordenado está esto.',
    vote: 'Vota por Maxwell en fluxerlist y desbloquea para ti todos los módulos bloqueados.',
    mydata: 'Te envía todo lo que Maxwell guarda sobre ti en esta comunidad.',
    forgetme: 'Borra tus niveles, moneda, cartas y otros datos en esta comunidad.',
    afk: 'Te marca como ausente. Quien te mencione verá tu nota hasta que vuelvas a escribir.',
  },
  ping: {
    first: 'Pong.',
    measuring: 'midiendo',
    result: (gateway: string, api: string) => `Pong. Gateway **${gateway}**, API **${api}**.`,
  },
  help: {
    nothing: (query: string, prefix: string) =>
      `No hay nada llamado ${code(query)}. ${code(`${prefix}help`)} lo muestra todo.`,
    examples: 'Ejemplos',
    needs: 'Requiere',
    also: 'También',
    title: 'Comandos',
    prefix: (prefix: string) => `El prefijo aquí es ${code(prefix)}.`,
    details: (prefix: string) =>
      `${prefix}help <módulo> o ${prefix}help <comando> para más detalles`,
  },
  prefix: {
    current: (prefix: string) => `El prefijo aquí es ${code(prefix)}.`,
    change: (prefix: string) => `Cámbialo con ${prefix}prefix <nuevo>.`,
    tooLong: 'Máximo 8 caracteres.',
    reset: (prefix: string) => `De vuelta a ${code(prefix)}.`,
    set: (prefix: string) => `Ahora aquí respondo a ${code(prefix)}.`,
  },
  about: {
    tagline: 'Aquí mantengo el orden.',
    communities: 'Comunidades',
    online: 'En línea desde',
    memory: 'Memoria',
  },
  entropy: 'Entropía aquí: baja. Que siga así.',
  vote: {
    done: 'Tu voto ya cuenta. Los módulos bloqueados están abiertos para ti en el panel.',
    ask: (link: string) =>
      `Vota una vez por Maxwell en fluxerlist y todos los módulos bloqueados se abren para ti.${link}`,
    again: (prefix: string) => `Después de votar, vuelve a usar ${code(`${prefix}vote`)}.`,
  },
  greet: {
    hello: 'Hola, soy Maxwell. Aquí mantengo el orden.',
    prefix: (prefix: string) =>
      `El prefijo es ${code(prefix)}. Empieza con ${code(`${prefix}help`)}.`,
    mention: 'Mencióname cuando olvides el prefijo.',
    missing: (permission: string, feature: string) =>
      `> Me falta **${permission}**, así que todavía no funciona: ${feature}.`,
    features: {
      ManageGuild: 'el seguimiento de invitaciones',
      EmbedLinks: 'todo lo que no sea texto plano',
      AddReactions: 'las reacciones',
    },
  },
  afk: {
    set: (reason: string) => (reason ? `Estás ausente: ${reason}` : 'Estás ausente.'),
    back: (duration: string) => `Hola de nuevo. Estuviste fuera ${duration}.`,
    away: (who: string, reason: string, since: string) =>
      reason
        ? `${who} está ausente desde hace ${since}: ${reason}`
        : `${who} está ausente desde hace ${since}.`,
  },
  privacy: {
    exported: 'Todo lo que guardo sobre ti en esa comunidad.',
    nothingStored: 'No guardo nada sobre ti en esa comunidad.',
    noDm: 'No puedo enviarte DMs. Abre tus DMs y vuelve a intentarlo.',
    sent: 'Enviado a tus DMs.',
    warning:
      'Esto borra tus niveles, moneda, cartas, notas y todo lo demás que guardo sobre ti aquí. Los casos de moderación se quedan.',
    confirm: (prefix: string) => `Usa ${code(`${prefix}forgetme confirm`)} para continuar.`,
    partial: (modules: string) =>
      `Casi todo está borrado. Falló ${modules}, vuelve a intentarlo más tarde.`,
    forgotten: 'Olvidado.',
  },
};

export default es;
