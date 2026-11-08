import type { FeedsCopy } from './copy.js';

const es: FeedsCopy = {
  labels: {
    rss: 'Feed',
    youtube: 'YouTube',
    twitch: 'Twitch',
    reddit: 'Reddit',
    bluesky: 'Bluesky',
    github: 'Versiones de GitHub',
    fluxer: 'Blog de Fluxer',
  },
  templates: {
    rss: '**{title}**\n{url}',
    youtube: '{author} subió un video nuevo: **{title}**\n{url}',
    twitch: '{author} está en directo: **{title}**\n{url}',
    reddit: 'Nuevo en {feed}: **{title}**\n{url}',
    bluesky: '{author} publicó en Bluesky\n{url}',
    github: '{feed} publicó **{title}**\n{url}',
    fluxer: 'Nuevo en el blog de Fluxer: **{title}**\n{url}',
  },
  untitledPost: 'Nueva publicación',
  twitchUntitled: 'En directo',
  twitchPlaying: (game: string) => `Jugando ${game}`,
};

export default es;
