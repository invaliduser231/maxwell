import type { ModuleCopy } from './modules.js';

const es: ModuleCopy = {
  moderation: {
    name: 'Moderación',
    description: 'Casos, advertencias, aislamientos, expulsiones y baneos.',
  },
  automod: { name: 'AutoMod', description: 'Filtros y la protección contra raids.' },
  security: {
    name: 'Seguridad',
    description: 'Evaluación de riesgo, captcha, protección contra raids y nukes, honeypots.',
  },
  logs: {
    name: 'Registros',
    description: 'Registros de mensajes, miembros, roles y canales.',
  },
  backups: {
    name: 'Copias de seguridad',
    description: 'Copias de roles, canales y ajustes.',
  },
  welcome: { name: 'Bienvenida', description: 'Mensajes, tarjetas y roles para miembros nuevos.' },
  invites: { name: 'Invitaciones', description: 'Quién invitó a quién y quién se quedó.' },
  levels: { name: 'Niveles', description: 'XP, roles como recompensa y la clasificación.' },
  roles: { name: 'Roles', description: 'Menús de roles, roles automáticos y roles persistentes.' },
  tickets: { name: 'Tickets', description: 'Tickets de soporte y modmail.' },
  forms: { name: 'Formularios', description: 'Solicitudes y formularios con acciones.' },
  suggestions: { name: 'Sugerencias', description: 'Sugerencias con votación y estado.' },
  giveaways: { name: 'Sorteos', description: 'Sorteos con requisitos y participaciones extra.' },
  events: { name: 'Eventos y encuestas', description: 'Eventos con confirmaciones, y encuestas.' },
  starboard: {
    name: 'Starboard',
    description: 'Destaca los mensajes con más estrellas.',
  },
  counters: { name: 'Contadores', description: 'Nombres de canal que cuentan.' },
  economy: { name: 'Economía', description: 'Joules, la tienda y recompensas diarias.' },
  collection: { name: 'Colección', description: 'Colecciona tu comunidad.' },
  games: { name: 'Juegos', description: 'Trivia, conteo y otros juegos pequeños.' },
  feeds: { name: 'Feeds', description: 'RSS, YouTube, Twitch y más en tus canales.' },
  commands: {
    name: 'Comandos personalizados',
    description: 'Tus propios comandos y respuestas automáticas.',
  },
  scheduler: { name: 'Programador', description: 'Mensajes programados y recurrentes.' },
  insights: { name: 'Estadísticas', description: 'Actividad, retención y cifras de moderación.' },
  voice: { name: 'Salas de voz', description: 'Entra para crear canales de voz.' },
  cards: { name: 'Tarjetas', description: 'Colores y fondos de las tarjetas de imagen.' },
  general: { name: 'General', description: 'Prefijo, idioma, zona horaria y privacidad.' },
};

export default es;
