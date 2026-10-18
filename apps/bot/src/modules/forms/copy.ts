import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { bold, code, count, lines, orList, subtext, timestamp } from '../../ui/format.js';
import de from './copy.de.js';

export const audit = {
  accept: (form: string) => `Accepted a ${form} submission`,
  decline: (form: string) => `Declined a ${form} submission`,
};

const en = {
  commands: {
    form: 'Applications and other forms.',
    start: 'Fills out a form, question by question in DMs.',
    list: 'Shows the forms you can fill out here.',
  },
  listTitle: 'Forms',
  listEmpty: 'No forms here yet.',
  listLine: (name: string, id: string, questions: number) =>
    `${bold(name)} ${code(id)}  ${count(questions)} ${questions === 1 ? 'question' : 'questions'}`,
  listHint: (prefix: string) => `Start one with ${code(`${prefix}form start <name>`)}.`,
  pickForm: (prefix: string) => `Which one? ${code(`${prefix}form list`)} shows them.`,
  unknownForm: (names: string[]) =>
    names.length
      ? `No form by that name. Try ${names.map((name) => code(name)).join(', ')}.`
      : 'No forms here yet.',
  closed: (name: string) => `${bold(name)} isn't taking answers right now.`,
  needsRole: (roleIds: string[]) =>
    `You need ${orList(roleIds.map((id) => mention.role(id)))} for that form.`,
  alreadyFilling: (name: string) =>
    `You're already filling out ${bold(name)}. Finish it or reply ${code('cancel')}.`,
  pending: (name: string) => `Your ${bold(name)} is still being reviewed.`,
  once: (name: string) => `You already sent ${bold(name)}.`,
  cooldown: (at: Date) => `You can send it again ${timestamp(at, 'R')}.`,
  checkDms: 'Check your DMs.',
  continueIn: (channelId: string) => `Continue in ${mention.channel(channelId)}.`,
  unreachable:
    "I can't DM you and couldn't open a channel. Allow DMs from this community and try again.",
  intro: (form: string, guild: string, description: string) =>
    lines(
      `${bold(form)} for ${bold(guild)}`,
      description || null,
      subtext(`Answer each question in a message. ${code('cancel')} stops.`),
    ),
  questionHeader: (index: number, total: number) => subtext(`Question ${index} of ${total}`),
  option: (index: number, text: string) => `${code(String(index))} ${text}`,
  hintChoice: 'Reply with the number or the option.',
  hintYesNo: 'Reply yes or no.',
  hintNumber: (min: number | null, max: number | null) =>
    min !== null && max !== null
      ? `Reply with a number from ${min} to ${max}.`
      : min !== null
        ? `Reply with a number of at least ${min}.`
        : max !== null
          ? `Reply with a number up to ${max}.`
          : 'Reply with a number.',
  hintOptional: `Optional, ${code('skip')} skips it.`,
  problemRequired: 'This one needs an answer.',
  problemNumber: "That's not a number.",
  problemTooSmall: (min: number) => `It has to be at least ${min}.`,
  problemTooLarge: (max: number) => `It can be ${max} at most.`,
  problemTooShort: (min: number) => `That's too short. At least ${count(min)} characters.`,
  problemTooLong: (max: number) => `That's too long. ${count(max)} characters at most.`,
  problemChoice: 'Pick one of the options, by number or name.',
  problemYesNo: 'Answer with yes or no.',
  cancelled: 'Cancelled. Nothing was sent.',
  expired: (form: string) => `Your ${bold(form)} timed out. Nothing was sent.`,
  gone: 'That form is closed now. Nothing was sent.',
  submitted: "Sent. You'll hear back here.",
  submittedChannel: 'Sent. This channel closes in a minute.',
  reviewHint: (accept: string, decline: string) =>
    `React with ${accept} to accept or ${decline} to decline.`,
  reviewVotes: (accept: number, decline: number) =>
    `${count(accept)} accept, ${count(decline)} decline`,
  reviewFooter: (number: number, userId: string) => `Submission ${number} / User ${userId}`,
  statusAccepted: (by: string | null) =>
    by ? `**Accepted** by ${mention.user(by)}` : '**Accepted** by votes',
  statusDeclined: (by: string | null) =>
    by ? `**Declined** by ${mention.user(by)}` : '**Declined** by votes',
  statusNote: (text: string) => `**Note** ${text}`,
  dmAccepted: (form: string, guild: string) =>
    `Your ${bold(form)} for ${bold(guild)} was accepted.`,
  dmDeclined: (form: string, guild: string) =>
    `Your ${bold(form)} for ${bold(guild)} was declined.`,
  ticketIntro: (form: string, userId: string) => `${bold(form)} from ${mention.user(userId)}`,
  skipped: 'Skipped',
  yes: 'Yes',
  no: 'No',
};

export type FormsCopy = typeof en;

export const formsCopy = localized(en, { de });
