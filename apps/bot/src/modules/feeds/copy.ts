import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/feeds.json' with { type: 'json' };

export const copy = catalog('feeds', en, (m) => ({
  twitchPlaying: (game: string) => m.twitchPlaying({ game }),
}));

export const audit = {
  pausedSummary: (label: string, error: string) =>
    `Paused the feed ${label} after repeated errors (${error})`,
  resumedSummary: (label: string) => `Resumed the feed ${label}`,
  errors: {
    invalid_source: 'The source is not a valid address or name.',
    blocked_url: 'The address is not a public https address.',
    not_found: 'The feed does not exist anymore.',
    not_a_feed: 'The address does not return a feed.',
    too_large: 'The feed is larger than 2 MB.',
    timeout: 'The feed took too long to answer.',
    unreachable: 'The feed could not be reached.',
    rate_limited: 'The feed is rate limiting requests.',
    redirects: 'The feed redirects too often.',
    twitch_unconfigured: 'Twitch is not set up on this Maxwell instance.',
    twitch_auth: 'Twitch rejected the credentials.',
    send_failed: 'I could not post in the target channel.',
    no_channel: 'No target channel is set.',
    http: 'The feed answered with an error.',
  } as Record<string, string>,
};
