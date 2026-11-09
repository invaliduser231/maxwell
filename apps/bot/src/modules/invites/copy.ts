import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/invites.json' with { type: 'json' };

export const copy = catalog('invites', en, (m) => ({
  top: {
    you: (rank: number, active: number) => m.top.you({ rank: String(rank), active }),
    left: (n: number) => m.top.left({ n }),
  },
  who: {
    before: (who: string) => m.who.before({ who }),
    looking: (who: string, when: string) => m.who.looking({ who, when }),
    unknown: (who: string, when: string) => m.who.unknown({ who, when }),
    through: (who: string, when: string, source: string) => m.who.through({ who, when, source }),
  },
  log: {
    current: (channel: string) => m.log.current({ channel }),
    turnOn: (prefix: string) => m.log.turnOn({ prefix }),
    where: (channel: string) => m.log.where({ channel }),
    set: (channel: string) => m.log.set({ channel }),
  },
  stats: {
    otherEmpty: (who: string) => m.stats.otherEmpty({ who }),
    stillHere: (n: number) => m.stats.stillHere({ n }),
    brought: (subject: string, total: number, stayed: string) =>
      m.stats.brought({ subject, total, stayed }),
    leftAgain: (n: number) => m.stats.leftAgain({ n }),
  },
  source: {
    inviteFrom: (code: string, inviterId: string) =>
      m.source.inviteFrom({ code, inviter: mention.user(inviterId) }),
  },
  join: {
    through: (who: string, source: string) => m.join.through({ who, source }),
    plain: (who: string) => m.join.plain({ who }),
    inviterNow: (inviter: string, active: number) => m.join.inviterNow({ inviter, active }),
    young: (age: number) => m.join.young({ age: formatDuration(age) }),
    number: (n: number) => m.join.number({ n }),
  },
}));

export const audit = {
  logOff: 'Turned off join posts',
  logChannel: 'Changed the join post channel',
};
