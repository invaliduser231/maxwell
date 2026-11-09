import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/forms.json' with { type: 'json' };
import { code, escapeMarkdown, lines, orList, subtext, timestamp } from '../../ui/format.js';

export const audit = {
  accept: (form: string) => `Accepted a ${form} submission`,
  decline: (form: string) => `Declined a ${form} submission`,
};

export const formsCopy = catalog('forms', en, (m) => ({
  listLine: (name: string, id: string, questions: number) =>
    m.listLine({ name: escapeMarkdown(name), id: code(id), questions }),
  listHint: (prefix: string) => m.listHint({ prefix }),
  pickForm: (prefix: string) => m.pickForm({ prefix }),
  unknownForm: (names: string[]) =>
    m.unknownForm({
      known: names.length ? 'yes' : 'no',
      names: names.map((name) => code(name)).join(', '),
    }),
  closed: (name: string) => m.closed({ name: escapeMarkdown(name) }),
  needsRole: (roleIds: string[]) =>
    m.needsRole({ roles: orList(roleIds.map((id) => mention.role(id))) }),
  alreadyFilling: (name: string) => m.alreadyFilling({ name: escapeMarkdown(name) }),
  pending: (name: string) => m.pending({ name: escapeMarkdown(name) }),
  once: (name: string) => m.once({ name: escapeMarkdown(name) }),
  cooldown: (at: Date) => m.cooldown({ when: timestamp(at, 'R') }),
  continueIn: (channelId: string) => m.continueIn({ channel: mention.channel(channelId) }),
  intro: (form: string, guild: string, description: string) =>
    lines(
      m.intro({ form: escapeMarkdown(form), guild: escapeMarkdown(guild) }),
      description || null,
      subtext(m.introHint()),
    ),
  questionHeader: (index: number, total: number) => subtext(m.questionHeader({ index, total })),
  option: (index: number, text: string) => m.option({ index: code(String(index)), text }),
  hintNumber: (min: number | null, max: number | null) =>
    m.hintNumber({
      range:
        min !== null && max !== null
          ? 'both'
          : min !== null
            ? 'min'
            : max !== null
              ? 'max'
              : 'none',
      min: String(min ?? ''),
      max: String(max ?? ''),
    }),
  problemTooSmall: (min: number) => m.problemTooSmall({ min: String(min) }),
  problemTooLarge: (max: number) => m.problemTooLarge({ max: String(max) }),
  problemTooShort: (min: number) => m.problemTooShort({ min }),
  problemTooLong: (max: number) => m.problemTooLong({ max }),
  expired: (form: string) => m.expired({ form: escapeMarkdown(form) }),
  reviewHint: (accept: string, decline: string) => m.reviewHint({ accept, decline }),
  reviewVotes: (accept: number, decline: number) => m.reviewVotes({ accept, decline }),
  reviewFooter: (number: number, userId: string) =>
    m.reviewFooter({ number: String(number), userId }),
  statusAccepted: (by: string | null) =>
    m.statusAccepted({ source: by ? 'member' : 'votes', user: by ? mention.user(by) : '' }),
  statusDeclined: (by: string | null) =>
    m.statusDeclined({ source: by ? 'member' : 'votes', user: by ? mention.user(by) : '' }),
  statusNote: (text: string) => m.statusNote({ text }),
  dmAccepted: (form: string, guild: string) =>
    m.dmAccepted({ form: escapeMarkdown(form), guild: escapeMarkdown(guild) }),
  dmDeclined: (form: string, guild: string) =>
    m.dmDeclined({ form: escapeMarkdown(form), guild: escapeMarkdown(guild) }),
  ticketIntro: (form: string, userId: string) =>
    m.ticketIntro({ form: escapeMarkdown(form), user: mention.user(userId) }),
}));
