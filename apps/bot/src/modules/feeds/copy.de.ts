import type { FeedsCopy } from './copy.js';

const de: FeedsCopy = {
  labels: {
    rss: 'Feed',
    youtube: 'YouTube',
    twitch: 'Twitch',
    reddit: 'Reddit',
    bluesky: 'Bluesky',
    github: 'GitHub-Releases',
    fluxer: 'Fluxer-Blog',
  },
  templates: {
    rss: '**{title}**\n{url}',
    youtube: '{author} hat ein neues Video hochgeladen: **{title}**\n{url}',
    twitch: '{author} ist live: **{title}**\n{url}',
    reddit: 'Neu in {feed}: **{title}**\n{url}',
    bluesky: '{author} hat auf Bluesky gepostet\n{url}',
    github: '{feed} hat **{title}** veröffentlicht\n{url}',
    fluxer: 'Neu im Fluxer-Blog: **{title}**\n{url}',
  },
  untitledPost: 'Neuer Beitrag',
  twitchUntitled: 'Jetzt live',
  twitchPlaying: (game: string) => `Spielt ${game}`,
};

export default de;
