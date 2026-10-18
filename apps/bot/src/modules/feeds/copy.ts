import type { FeedType } from '@maxwell/core/modules/feeds';
import { localized } from '../../i18n/localized.js';
import de from './copy.de.js';

const en = {
  labels: {
    rss: 'Feed',
    youtube: 'YouTube',
    twitch: 'Twitch',
    reddit: 'Reddit',
    bluesky: 'Bluesky',
    github: 'GitHub releases',
    fluxer: 'Fluxer blog',
  } satisfies Record<FeedType, string>,
  templates: {
    rss: '**{title}**\n{url}',
    youtube: '{author} posted a new video: **{title}**\n{url}',
    twitch: '{author} is live: **{title}**\n{url}',
    reddit: 'New in {feed}: **{title}**\n{url}',
    bluesky: '{author} posted on Bluesky\n{url}',
    github: '{feed} released **{title}**\n{url}',
    fluxer: 'New on the Fluxer blog: **{title}**\n{url}',
  } satisfies Record<FeedType, string>,
  untitledPost: 'New post',
  twitchUntitled: 'Live now',
  twitchPlaying: (game: string) => `Playing ${game}`,
};

export type FeedsCopy = typeof en;

export const copy = localized(en, { de });

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
