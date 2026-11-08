import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { count, plural } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  commands: {
    invites: 'How many members someone brought in.',
    top: 'Who brought in the most members that stayed.',
    who: 'How a member got here and who invited them.',
    log: 'Posts every join with its invite to a channel.',
  },
  top: {
    empty: [
      'Nobody has brought anyone in yet.',
      'The board is empty. Someone has to start.',
      'No invites on the board yet. Quiet in here.',
    ],
    you: (rank: number, active: number) => `You: #${rank} with ${plural(active, 'member')}`,
    notOnBoard: "You're not on the board yet",
    title: 'Top inviters',
    left: (n: number) => `${count(n)} left`,
  },
  who: {
    before: (who: string) => `${who} was here before me, so I don't know how they joined.`,
    looking: (who: string, when: string) => `${who} joined ${when}. I'm still looking up how.`,
    unknown: (who: string, when: string) => `${who} joined ${when}. Fluxer didn't tell me how.`,
    through: (who: string, when: string, source: string) =>
      `${who} joined ${when} through ${source}.`,
  },
  log: {
    current: (channel: string) => `Joins are posted to ${channel}.`,
    off: 'Join posts are off.',
    turnOn: (prefix: string) => `Turn them on with ${prefix}invites log #channel.`,
    notChannel: "That's not a channel I can see.",
    where: (channel: string) => `in ${channel}`,
    set: (channel: string) => `Joins go to ${channel} from now on.`,
  },
  stats: {
    selfEmpty: ["You haven't brought anyone in yet.", 'Nobody joined through you yet.'],
    otherEmpty: (who: string) => `${who} hasn't brought anyone in yet.`,
    you: 'You',
    stayedOne: 'They stayed.',
    stayedAll: 'All of them stayed.',
    stillHere: (n: number) => `${count(n)} still here.`,
    brought: (subject: string, total: number, stayed: string) =>
      `${subject} brought in **${plural(total, 'member')}**. ${stayed}`,
    leftAgain: (n: number) => `${count(n)} left again`,
  },
  source: {
    inviteFrom: (code: string, inviterId: string) => `\`${code}\` from ${mention.user(inviterId)}`,
    invite: 'an invite',
    vanity: 'the vanity link',
    discovery: 'discovery',
    bot: 'a bot invite',
    creator: 'creating the community',
    admin: 'an instance admin',
    unknown: 'an unknown route',
  },
  join: {
    through: (who: string, source: string) => `${who} joined through ${source}.`,
    plain: (who: string) => `${who} joined.`,
    needsPermission: 'I need Manage Community to see which invite was used.',
    notTold: 'Fluxer did not tell me which invite was used.',
    botTitle: 'Bot added',
    memberTitle: 'Member joined',
    inviterNow: (inviter: string, active: number) =>
      `${inviter} now has **${plural(active, 'member')}** here.`,
    created: 'Account created',
    young: (age: number) => `The account is only ${formatDuration(age)} old.`,
    number: (n: number) => `Member #${count(n)}`,
  },
};

export type InvitesCopy = typeof en;

export const copy = localized(en, { de, es });

export const audit = {
  logOff: 'Turned off join posts',
  logChannel: 'Changed the join post channel',
};
