import { localized } from '../../i18n/localized.js';
import { code } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  commands: {
    ping: 'Checks that I am awake and how fast I answer.',
    help: 'Lists what I can do, or explains a module or command.',
    prefix: 'Shows the prefix, or changes it for this community.',
    about: 'Who I am and how I am doing.',
    entropy: 'How orderly it is here.',
    vote: 'Vote for Maxwell on fluxerlist and unlock every locked module for you.',
    mydata: 'Sends you everything Maxwell stores about you in this community.',
    forgetme: 'Deletes your levels, currency, cards and other data in this community.',
    afk: 'Marks you as away. Mentions of you get your note until you write again.',
  },
  ping: {
    first: 'Pong.',
    measuring: 'measuring',
    result: (gateway: string, api: string) => `Pong. Gateway **${gateway}**, API **${api}**.`,
  },
  help: {
    nothing: (query: string, prefix: string) =>
      `Nothing called ${code(query)}. ${code(`${prefix}help`)} lists everything.`,
    examples: 'Examples',
    needs: 'Needs',
    also: 'Also',
    title: 'Commands',
    prefix: (prefix: string) => `Prefix here is ${code(prefix)}.`,
    details: (prefix: string) => `${prefix}help <module> or ${prefix}help <command> for details`,
  },
  prefix: {
    current: (prefix: string) => `Prefix here is ${code(prefix)}.`,
    change: (prefix: string) => `Change it with ${prefix}prefix <new>.`,
    tooLong: 'Keep it to 8 characters or fewer.',
    reset: (prefix: string) => `Back to ${code(prefix)}.`,
    set: (prefix: string) => `I answer to ${code(prefix)} here now.`,
  },
  about: {
    tagline: 'I keep things in order around here.',
    communities: 'Communities',
    online: 'Online since',
    memory: 'Memory',
  },
  entropy: 'Entropy here: low. Keep it that way.',
  vote: {
    done: 'Your vote is in. Locked modules are open for you in the dashboard.',
    ask: (link: string) =>
      `Vote for Maxwell on fluxerlist once and every locked module opens for you.${link}`,
    again: (prefix: string) => `Run ${code(`${prefix}vote`)} again after voting.`,
  },
  greet: {
    hello: "Hi, I'm Maxwell. I keep things in order around here.",
    prefix: (prefix: string) => `Prefix is ${code(prefix)}. Start with ${code(`${prefix}help`)}.`,
    mention: 'Mention me any time you forget the prefix.',
    missing: (permission: string, feature: string) =>
      `> I'm missing **${permission}**, so ${feature} won't work yet.`,
    features: {
      ManageGuild: 'invite tracking',
      EmbedLinks: 'anything richer than plain text',
      AddReactions: 'reactions',
    },
  },
  afk: {
    set: (reason: string) => (reason ? `You are away: ${reason}` : 'You are away.'),
    back: (duration: string) => `Welcome back. You were away for ${duration}.`,
    away: (who: string, reason: string, since: string) =>
      reason
        ? `${who} has been away for ${since}: ${reason}`
        : `${who} has been away for ${since}.`,
  },
  privacy: {
    exported: 'Everything I store about you in that community.',
    nothingStored: 'I store nothing about you in that community.',
    noDm: "I can't DM you. Open your DMs and try again.",
    sent: 'Sent to your DMs.',
    warning:
      'This deletes your levels, currency, cards, notes and everything else I keep about you here. Moderation cases stay.',
    confirm: (prefix: string) => `Run ${code(`${prefix}forgetme confirm`)} to go ahead.`,
    partial: (modules: string) => `Most of it is gone. ${modules} failed, try again later.`,
    forgotten: 'Forgotten.',
  },
};

export type GeneralCopy = typeof en;

export const copy = localized(en, { de });
