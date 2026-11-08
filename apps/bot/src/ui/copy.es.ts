import type { UiCopy } from './copy.js';
import { code } from './format.js';

const es: UiCopy = {
  done: ['Listo.', 'Hecho.', 'Guardado.'],
  missingPermissions: (list: string) => `Para eso necesitas ${list}.`,
  botMissingPermissions: (list: string, where: string) => `Para eso necesito ${list} ${where}.`,
  here: 'aquí',
  there: 'allí',
  inCommunity: 'en esta comunidad',
  moduleOff: (name: string) =>
    `${name} está desactivado aquí. Un admin puede activarlo en el panel.`,
  guildOnly: 'Eso solo funciona dentro de una comunidad.',
  cooldown: ['Con calma.', 'De uno en uno.'],
  tryAgain: (when: string) => `Vuelve a intentarlo ${when}.`,
  failed: (errorCode: string) =>
    `Eso falló de mi lado. Quedó registrado como ${code(errorCode)}. Vuelve a intentarlo en un minuto.`,
  pickOne: 'Elige uno.',
  args: {
    missing: (name: string) => `Para eso me falta ${code(name)}.`,
    user: (name: string) => `No encuentro a nadie para ${code(name)}.`,
    channel: 'Ese canal no lo veo.',
    role: 'Ese rol no existe aquí.',
    durationMissing: (name: string) =>
      `Me falta ${code(name)}, por ejemplo ${code('10m')} o ${code('2h')}.`,
    duration: `No conozco esa duración. Prueba ${code('10m')}, ${code('2h')} o ${code('3d')}.`,
    between: (name: string, min: number, max: number) =>
      `${code(name)} tiene que estar entre ${min} y ${max}.`,
    whole: (name: string) => `${code(name)} tiene que ser un número entero.`,
  },
  unknownCommand: (typed: string, suggestion: string) =>
    `No hay ningún comando ${code(typed)}. ¿Quisiste decir ${code(suggestion)}?`,
  prefixHint: (prefix: string) =>
    `El prefijo aquí es ${code(prefix)}. ${code(`${prefix}help`)} lo muestra todo.`,
  prefixAgain: (prefix: string) => `Sigo aquí. Sigue siendo ${code(prefix)}.`,
  prefixThird: 'Te oí las dos primeras veces.',
  page: (index: number, total: number) => `Página ${index} de ${total}`,
  eggs: {
    demon: 'Solo del tipo termodinámico.',
    sort: 'Las rápidas a la izquierda, las lentas a la derecha. Ordenado.',
    who: 'Maxwell. Aquí mantengo el orden.',
  },
};

export default es;
