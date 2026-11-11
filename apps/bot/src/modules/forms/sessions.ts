import type { FormDefinition, FormQuestion, FormsConfig } from '@maxwell/core/modules/forms';
import type { FormSession, FormStore } from '@maxwell/core/stores/forms';
import { mention } from '../../commands/mentions.js';
import { inGuild } from '../../i18n/language.js';
import {
  ChannelKind,
  type IncomingMessage,
  type ReactionEvent,
  type UserRef,
} from '../../platform/types.js';
import { lines } from '../../ui/format.js';
import { KeyedQueue } from '../tickets/cache.js';
import { cleanChannelName } from '../tickets/naming.js';
import { formsCopy as copy } from './copy.js';
import { type Answers, buildAnswers, isCancel, nextQuestion, parseAnswer } from './engine.js';
import type { FormInbox } from './inbox.js';
import { problemText, questionText } from './render.js';
import type { FormsContext, Reviews } from './review.js';

const CLEANUP_DELAY = 60_000;

export type StartResult =
  | { ok: true; mode: 'dm' }
  | { ok: true; mode: 'channel'; channelId: string }
  | { ok: false; reason: 'closed' | 'pending' | 'once' | 'unreachable' }
  | { ok: false; reason: 'role'; roleIds: string[] }
  | { ok: false; reason: 'active'; formName: string }
  | { ok: false; reason: 'cooldown'; until: Date };

export function findForm(config: FormsConfig, query: string): FormDefinition | null {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  return (
    config.forms.find((form) => form.id === wanted) ??
    config.forms.find((form) => form.name.toLowerCase() === wanted) ??
    null
  );
}

export function openForms(config: FormsConfig): FormDefinition[] {
  return config.forms.filter((form) => form.enabled && form.questions.length > 0);
}

const BUTTON_LIMIT = 5_000;
const VARIATION = String.fromCodePoint(0xfe0f);
const bare = (emoji: string) => emoji.replaceAll(VARIATION, '');
const digit = (n: number) => String.fromCodePoint(0x30 + n, 0xfe0f, 0x20e3);

export function answerKeys(question: FormQuestion): { emoji: string; answer: string }[] {
  const keys: { emoji: string; answer: string }[] = [];
  if (question.type === 'yesno') {
    keys.push({ emoji: String.fromCodePoint(0x2705), answer: 'yes' });
    keys.push({ emoji: String.fromCodePoint(0x274c), answer: 'no' });
  }
  if (question.type === 'choice' && question.options.length <= 9) {
    question.options.forEach((_, i) => {
      keys.push({ emoji: digit(i + 1), answer: String(i + 1) });
    });
  }
  if (!question.required && keys.length > 0) {
    keys.push({ emoji: String.fromCodePoint(0x23ed, 0xfe0f), answer: 'skip' });
  }
  return keys;
}

interface Button {
  userId: string;
  questionId: string;
  channelId: string;
  keys: { emoji: string; answer: string }[];
}

export class FormRunner {
  readonly #queue = new KeyedQueue();
  readonly #buttons = new Map<string, Button>();

  constructor(
    private readonly ctx: FormsContext,
    private readonly store: FormStore,
    private readonly inbox: FormInbox,
    private readonly reviews: Reviews,
  ) {}

  async start(
    guildId: string,
    user: UserRef,
    roles: readonly string[],
    form: FormDefinition,
  ): Promise<StartResult> {
    const { platform, log } = this.ctx.services;
    const config = await this.ctx.config(guildId);
    const first = form.enabled ? nextQuestion(form, {}, null) : null;
    if (!first) return { ok: false, reason: 'closed' };

    if (form.requiredRoleIds.length && !roles.some((id) => form.requiredRoleIds.includes(id))) {
      return { ok: false, reason: 'role', roleIds: form.requiredRoleIds };
    }

    const active = await this.store.session(user.id);
    if (active) {
      const name = (await this.ctx.config(active.guildId)).forms.find(
        (candidate) => candidate.id === active.formId,
      )?.name;
      return { ok: false, reason: 'active', formName: name ?? active.formId };
    }

    const history = await this.store.history(guildId, form.id, user.id);
    if (history.pending > 0) return { ok: false, reason: 'pending' };
    if (form.oncePerMember && history.accepted > 0) return { ok: false, reason: 'once' };
    if (form.cooldownHours > 0 && history.last) {
      const until = new Date(history.last.getTime() + form.cooldownHours * 3_600_000);
      if (until.getTime() > Date.now()) return { ok: false, reason: 'cooldown', until };
    }

    const session = await this.store.startSession({
      guildId,
      formId: form.id,
      userId: user.id,
      mode: 'dm',
      channelId: null,
      questionId: first.id,
      expiresAt: this.#expiry(config),
    });
    if (!session) return { ok: false, reason: 'active', formName: form.name };
    this.inbox.add(user.id, null);
    await this.#watch(session);

    const guild = await platform.guild(guildId);
    const opening = lines(
      copy.intro(form.name, guild?.name ?? '', form.description),
      '',
      questionText(form, {}, first),
    );
    const dm = await Promise.resolve()
      .then(() => platform.openDirect(user.id))
      .catch(() => null);
    const sent = dm ? await platform.send(dm, opening).catch(() => null) : null;
    if (dm && sent) {
      await this.#offer(dm, sent, first, user.id);
      return { ok: true, mode: 'dm' };
    }
    if (!dm && (await platform.sendDirect(user.id, opening))) return { ok: true, mode: 'dm' };

    const channelId = await this.#fallbackChannel(guildId, user, config).catch((error) => {
      log.warn({ err: error, guild: guildId }, 'form channel create failed');
      return null;
    });
    if (!channelId) {
      await this.store.endSession(session.id);
      this.inbox.remove(user.id);
      return { ok: false, reason: 'unreachable' };
    }
    await this.store.moveSessionToChannel(session.id, channelId);
    this.inbox.add(user.id, channelId);
    const posted = await platform.send(channelId, {
      content: lines(mention.user(user.id), opening),
      mentionUsers: [user.id],
    });
    await this.#offer(channelId, posted, first, user.id);
    return { ok: true, mode: 'channel', channelId };
  }

  async #offer(
    channelId: string,
    messageId: string,
    question: FormQuestion,
    userId: string,
  ): Promise<void> {
    const keys = answerKeys(question);
    if (keys.length === 0) return;
    if (this.#buttons.size >= BUTTON_LIMIT) {
      const oldest = this.#buttons.keys().next().value;
      if (oldest !== undefined) this.#buttons.delete(oldest);
    }
    this.#buttons.set(messageId, { userId, questionId: question.id, channelId, keys });
    const { platform } = this.ctx.services;
    for (const key of keys) await platform.react(channelId, messageId, key.emoji).catch(() => {});
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    const button = this.#buttons.get(reaction.messageId);
    if (!button || reaction.bot || reaction.userId !== button.userId) return;
    const key = button.keys.find((entry) => bare(entry.emoji) === bare(reaction.emoji));
    if (!key) return;
    await this.#queue.run(button.userId, async () => {
      const session = await this.store.session(button.userId);
      if (!session || session.questionId !== button.questionId) return;
      this.#buttons.delete(reaction.messageId);
      const { platform } = this.ctx.services;
      for (const entry of button.keys) {
        await platform.unreact(button.channelId, reaction.messageId, entry.emoji).catch(() => {});
      }
      const answer = {
        id: reaction.messageId,
        channelId: button.channelId,
        guildId: reaction.guildId,
        content: key.answer,
        attachments: [],
        author: { id: button.userId, bot: false },
        fromWebhook: false,
      } as unknown as IncomingMessage;
      await inGuild(session.guildId, () => this.#continue(session, answer));
    });
  }

  #expiry(config: FormsConfig): Date {
    return new Date(Date.now() + config.sessionMinutes * 60_000);
  }

  async #watch(session: FormSession): Promise<void> {
    await this.ctx.schedule('session.expire', {
      guildId: session.guildId,
      payload: { sessionId: session.id },
      runAt: session.expiresAt,
      dedupeKey: `forms.expire:${session.id}:${session.expiresAt.getTime()}`,
    });
  }

  async #fallbackChannel(
    guildId: string,
    user: UserRef,
    config: FormsConfig,
  ): Promise<string | null> {
    const { platform } = this.ctx.services;
    const missing = await platform.missingBotPermissions(guildId, null, [
      'ManageChannels',
      'ManageRoles',
      'SendMessages',
    ]);
    if (missing.length) return null;
    const channels = await platform.channels(guildId);
    const parent = channels.find(
      (channel) =>
        channel.id === config.fallbackCategoryId && channel.type === ChannelKind.Category,
    );
    const self = platform.selfId;
    const allow = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] as const;
    return platform.createChannel(
      guildId,
      {
        name: cleanChannelName(`form-${user.username}`) || 'form',
        type: ChannelKind.Text,
        parentId: parent?.id ?? null,
        overwrites: [
          { id: guildId, type: 'role', allow: [], deny: ['ViewChannel'] },
          ...(self ? [{ id: self, type: 'member' as const, allow, deny: [] }] : []),
          { id: user.id, type: 'member', allow, deny: [] },
        ],
      },
      'Maxwell forms',
    );
  }

  async expire(sessionId: string): Promise<void> {
    const session = await this.store.sessionById(sessionId);
    if (!session) return;
    if (session.expiresAt.getTime() > Date.now() + 1_000) {
      await this.#watch(session);
      return;
    }
    const config = await this.ctx.config(session.guildId);
    const name = config.forms.find((form) => form.id === session.formId)?.name ?? session.formId;
    await this.#end(session, copy.expired(name));
  }

  async #end(session: FormSession, text: string): Promise<void> {
    const { platform } = this.ctx.services;
    const ended = await this.store.endSession(session.id);
    this.inbox.remove(session.userId);
    if (!ended) return;
    if (session.mode === 'channel' && session.channelId) {
      await platform.send(session.channelId, text).catch(() => {});
      await this.#cleanup(session);
    } else {
      await platform.sendDirect(session.userId, text);
    }
  }

  async #cleanup(session: FormSession): Promise<void> {
    if (session.mode !== 'channel' || !session.channelId) return;
    await this.ctx.schedule('cleanup', {
      guildId: session.guildId,
      payload: { channelId: session.channelId },
      runAt: new Date(Date.now() + CLEANUP_DELAY),
    });
  }

  async forget(guildId: string, userId: string): Promise<boolean> {
    return this.#queue.run(userId, async () => {
      const session = await this.store.session(userId);
      if (session?.guildId !== guildId) return false;
      const ended = await this.store.endSession(session.id);
      this.inbox.remove(userId);
      if (!ended) return false;
      await this.#cleanup(session);
      return true;
    });
  }

  async onChannelGone(channelId: string): Promise<void> {
    const userId = this.inbox.userForChannel(channelId);
    if (!userId) return;
    const session = await this.store.session(userId);
    this.inbox.remove(userId);
    if (session?.channelId === channelId) await this.store.endSession(session.id);
  }

  handles(message: IncomingMessage): boolean {
    if (message.author.bot || message.fromWebhook) return false;
    if (!message.guildId) return this.inbox.hasUser(message.author.id);
    return this.inbox.userForChannel(message.channelId) === message.author.id;
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    if (!this.handles(message)) return;
    await this.#queue.run(message.author.id, () => this.#answer(message));
  }

  async #answer(message: IncomingMessage): Promise<void> {
    const session = await this.store.session(message.author.id);
    if (!session) {
      this.inbox.remove(message.author.id);
      return;
    }
    if (session.mode === 'channel' ? message.channelId !== session.channelId : message.guildId) {
      return;
    }
    await inGuild(session.guildId, () => this.#continue(session, message));
  }

  async #continue(session: FormSession, message: IncomingMessage): Promise<void> {
    const { platform } = this.ctx.services;
    const reply = (text: string) => platform.send(message.channelId, text);

    const config = await this.ctx.config(session.guildId);
    const form = config.forms.find((candidate) => candidate.id === session.formId);
    if (!form?.enabled || !(await this.ctx.enabled(session.guildId))) {
      await this.#end(session, copy.gone);
      return;
    }
    if (isCancel(message.content)) {
      await this.#end(session, copy.cancelled);
      return;
    }

    const answers: Answers = { ...session.answers };
    const question =
      form.questions.find((candidate) => candidate.id === session.questionId) ??
      nextQuestion(form, answers, null);
    if (!question) {
      await this.#submit(session, form, answers, reply);
      return;
    }

    const raw =
      question.type === 'text' && message.attachments.length
        ? lines(message.content, ...message.attachments.map((file) => file.url))
        : message.content;
    const parsed = parseAnswer(question, raw);
    if (!parsed.ok) {
      await reply(problemText(question, parsed.problem));
      return;
    }

    answers[question.id] = parsed.value;
    const next = nextQuestion(form, answers, question.id);
    if (next) {
      await this.store.saveProgress(session.id, next.id, answers, this.#expiry(config));
      const asked = await reply(questionText(form, answers, next));
      await this.#offer(message.channelId, asked, next, session.userId);
      return;
    }
    await this.#submit(session, form, answers, reply);
  }

  async #submit(
    session: FormSession,
    form: FormDefinition,
    answers: Answers,
    reply: (text: string) => Promise<string>,
  ): Promise<void> {
    const { voice, log } = this.ctx.services;
    const submission = await this.store.submitSession(session.id, {
      guildId: session.guildId,
      formId: form.id,
      formName: form.name,
      userId: session.userId,
      answers: buildAnswers(form, answers),
    });
    this.inbox.remove(session.userId);
    if (!submission) return;
    await this.reviews
      .post(submission, form)
      .catch((error) =>
        log.warn({ err: error, submission: submission.id }, 'form review post failed'),
      );
    const text = session.mode === 'channel' ? copy.submittedChannel : copy.submitted;
    await reply(`${voice.icon('ok')}${text}`).catch(() => {});
    await this.#cleanup(session);
  }
}
