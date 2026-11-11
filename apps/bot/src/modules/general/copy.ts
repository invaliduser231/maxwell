import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/general.json' with { type: 'json' };
import { code, timestamp } from '../../ui/format.js';

export const copy = catalog('general', en, (m) => ({
  ping: {
    result: (gateway: string, api: string) => m.ping.result({ gateway, api }),
  },
  help: {
    nothing: (query: string, prefix: string) => m.help.nothing({ query: code(query), prefix }),
    prefix: (prefix: string) => m.help.prefix({ prefix: code(prefix) }),
    details: (prefix: string) => m.help.details({ prefix }),
  },
  prefix: {
    current: (prefix: string) => m.prefix.current({ prefix: code(prefix) }),
    change: (prefix: string) => m.prefix.change({ prefix }),
    reset: (prefix: string) => m.prefix.reset({ prefix: code(prefix) }),
    set: (prefix: string) => m.prefix.set({ prefix: code(prefix) }),
  },
  vote: {
    ask: (link: string) => m.vote.ask({ link }),
    again: (prefix: string) => m.vote.again({ prefix }),
  },
  greet: {
    prefix: (prefix: string) => m.greet.prefix({ prefix: code(prefix) }),
    missing: (permission: string, feature: string) => m.greet.missing({ permission, feature }),
  },
  afk: {
    set: (reason: string) => m.afk.set({ hasReason: reason ? 'yes' : 'no', reason }),
    back: (duration: string) => m.afk.back({ duration }),
    away: (who: string, reason: string, since: Date) =>
      m.afk.away({ hasReason: reason ? 'yes' : 'no', who, reason, since: timestamp(since, 'R') }),
  },
  privacy: {
    confirm: (emoji: string, prefix: string) => m.privacy.confirm({ emoji, prefix }),
    partial: (modules: string) => m.privacy.partial({ modules }),
  },
}));
