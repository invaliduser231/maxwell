import { EventEmitter } from 'node:events';
import {
  AuditStore,
  connect,
  GuildStore,
  type JobInput,
  ModuleStore,
  migrate,
  type Sql,
} from '@maxwell/core';
import formsDefinition from '@maxwell/core/modules/forms';
import ticketsDefinition from '@maxwell/core/modules/tickets';
import { FormStore } from '@maxwell/core/stores/forms';
import { TicketStore } from '@maxwell/core/stores/tickets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Args } from '../../src/commands/args.js';
import type { Command, GuildContext } from '../../src/commands/types.js';
import { createLogger } from '../../src/log.js';
import forms from '../../src/modules/forms/index.js';
import tickets from '../../src/modules/tickets/index.js';
import type {
  ChannelInput,
  ChannelRef,
  IncomingMessage,
  MemberRef,
  Outgoing,
  OutgoingMessage,
  Overwrite,
  Platform,
  PlatformEvents,
  UserRef,
} from '../../src/platform/types.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { JobHandler } from '../../src/runtime/scheduler.js';
import { Settings } from '../../src/runtime/settings.js';
import { UndoRegistry } from '../../src/runtime/undo.js';
import type { Services } from '../../src/services.js';
import { parseIconSet } from '../../src/ui/icons.js';
import { Voice } from '../../src/ui/voice.js';

const url = process.env.TEST_DATABASE_URL;
const log = createLogger('silent', false);

function snowflake(prefix: number): string {
  return `${prefix}${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
}

function user(id: string, name: string, bot = false): UserRef {
  return { id, username: name.toLowerCase(), displayName: name, bot, avatarUrl: `https://a/${id}` };
}

function channel(
  id: string,
  guildId: string,
  name: string,
  type: number,
  parentId: string | null,
  position = 0,
): ChannelRef {
  return {
    id,
    guildId,
    name,
    type,
    parentId,
    position,
    topic: null,
    nsfw: false,
    userLimit: null,
    rateLimitPerUser: 0,
    overwrites: [],
  };
}

class FakePlatform {
  readonly selfId = '900000000000000001';
  readonly events = new EventEmitter();
  readonly sent: { channelId: string; id: string; out: OutgoingMessage }[] = [];
  readonly direct: { userId: string; out: OutgoingMessage }[] = [];
  readonly overwrites: { channelId: string; overwrite: Overwrite }[] = [];
  readonly reactions: { channelId: string; messageId: string; emoji: string }[] = [];
  readonly deleted: string[] = [];
  readonly deletedChannels: string[] = [];
  readonly created: { id: string; input: ChannelInput }[] = [];
  readonly channelList: ChannelRef[] = [];
  readonly members = new Map<string, MemberRef>();
  readonly users = new Map<string, UserRef>();
  readonly closedDms = new Set<string>();
  readonly admins = new Set<string>();
  #next = 950_000_000_000_000_000n;

  constructor(readonly guildId: string) {}

  id(): string {
    this.#next += 1n;
    return String(this.#next);
  }

  on<K extends keyof PlatformEvents>(event: K, listener: PlatformEvents[K]): void {
    this.events.on(event, listener);
  }

  emit<K extends keyof PlatformEvents>(event: K, ...args: Parameters<PlatformEvents[K]>): void {
    this.events.emit(event, ...args);
  }

  addMember(ref: UserRef, roles: string[] = []): void {
    this.users.set(ref.id, ref);
    this.members.set(ref.id, {
      guildId: this.guildId,
      user: ref,
      nick: null,
      roles,
      joinedAt: new Date(0),
      timeoutUntil: null,
    });
  }

  guildIds() {
    return [this.guildId];
  }

  async send(channelId: string, message: Outgoing): Promise<string> {
    const out = typeof message === 'string' ? { content: message } : message;
    const id = this.id();
    this.sent.push({ channelId, id, out });
    return id;
  }

  async reply(message: IncomingMessage, out: Outgoing): Promise<string> {
    return this.send(message.channelId, out);
  }

  async edit(channelId: string, _messageId: string, message: Outgoing): Promise<void> {
    const out = typeof message === 'string' ? { content: message } : message;
    this.sent.push({ channelId, id: 'edit', out });
  }

  async openDirect(): Promise<string | null> {
    return null;
  }

  async delete(_channelId: string, messageId: string): Promise<void> {
    this.deleted.push(messageId);
  }

  async recentMessages(): Promise<IncomingMessage[]> {
    return [];
  }

  async sendDirect(userId: string, message: Outgoing): Promise<boolean> {
    if (this.closedDms.has(userId)) return false;
    this.direct.push({ userId, out: typeof message === 'string' ? { content: message } : message });
    return true;
  }

  async react(channelId: string, messageId: string, emoji: string): Promise<void> {
    this.reactions.push({ channelId, messageId, emoji });
  }

  async unreact(): Promise<void> {}

  async user(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async guild(guildId: string) {
    return { id: guildId, name: 'Test Place', memberCount: 10, iconUrl: null };
  }

  async member(_guildId: string, userId: string) {
    return this.members.get(userId) ?? null;
  }

  async channels() {
    return this.channelList;
  }

  async channelInGuild(guildId: string, channelId: string) {
    return this.channelList.some(
      (channel) => channel.id === channelId && channel.guildId === guildId,
    );
  }

  async createChannel(guildId: string, input: ChannelInput): Promise<string> {
    const id = this.id();
    this.created.push({ id, input });
    this.channelList.push(channel(id, guildId, input.name, input.type, input.parentId ?? null));
    return id;
  }

  async editChannel(channelId: string, input: Partial<ChannelInput>): Promise<void> {
    const channel = this.channelList.find((c) => c.id === channelId);
    if (channel && input.name) channel.name = input.name;
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.deletedChannels.push(channelId);
    const index = this.channelList.findIndex((c) => c.id === channelId);
    if (index >= 0) this.channelList.splice(index, 1);
  }

  async setOverwrite(channelId: string, overwrite: Overwrite): Promise<void> {
    this.overwrites.push({ channelId, overwrite });
  }

  async hasPermissions(_guildId: string, userId: string) {
    return this.admins.has(userId);
  }

  async missingBotPermissions() {
    return [];
  }

  async addRole(_guildId: string, userId: string, roleId: string): Promise<void> {
    const member = this.members.get(userId);
    if (member && !member.roles.includes(roleId)) member.roles.push(roleId);
  }

  async removeRole(_guildId: string, userId: string, roleId: string): Promise<void> {
    const member = this.members.get(userId);
    if (member) member.roles = member.roles.filter((role) => role !== roleId);
  }
}

function incoming(
  author: UserRef,
  channelId: string,
  guildId: string | null,
  content: string,
  id: string,
  roles: string[] = [],
): IncomingMessage {
  return {
    id,
    channelId,
    guildId,
    content,
    author,
    memberRoles: roles,
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(),
  };
}

async function until<T>(
  check: () => Promise<T | null | undefined | false>,
  ms = 3_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(!url)('forms flow', () => {
  let sql: Sql;
  let store: FormStore;
  let ticketStore: TicketStore;
  let platform: FakePlatform;
  let undo: UndoRegistry;
  let command: Command;
  let built: Services | null = null;
  const privacy = new PrivacyRegistry();
  const handlers = new Map<string, JobHandler>();
  const jobs: JobInput[] = [];
  const guild = snowflake(8);
  const applicant = user(snowflake(71), 'Lena');
  const shy = user(snowflake(72), 'Kai');
  const first = user(snowflake(73), 'Ada');
  const second = user(snowflake(74), 'Mo');
  const helperBot = user(snowflake(75), 'Helper', true);
  const reviewerRole = snowflake(61);
  const memberRole = snowflake(62);
  const reviewChannel = snowflake(51);
  const category = snowflake(52);
  const applicantDm = snowflake(54);
  const accept = '✅';

  function services(): Services {
    if (!built) throw new Error('not ready');
    return built;
  }

  async function runJobs(kind: string): Promise<void> {
    const due = jobs.filter((job) => job.kind === kind);
    jobs.splice(0, jobs.length, ...jobs.filter((job) => job.kind !== kind));
    for (const job of due) {
      await handlers.get(kind)?.({
        id: '0',
        kind,
        guildId: job.guildId ?? null,
        payload: job.payload ?? {},
        runAt: new Date(),
        attempts: 1,
      });
    }
  }

  async function start(author: UserRef, form: string): Promise<Outgoing[]> {
    const replies: Outgoing[] = [];
    const message = incoming(author, reviewChannel, guild, '', platform.id());
    const ctx: GuildContext = {
      message,
      guildId: guild,
      prefix: 'm!',
      path: ['form', 'start'],
      args: new Args(new Map([['form', form]])),
      services: services(),
      platform: platform as unknown as Platform,
      seed: { seed: message.id, scope: message.channelId },
      reply: async (out) => {
        replies.push(out);
        return platform.id();
      },
    };
    const target = command.subcommands?.find((sub) => sub.name === 'start');
    if (target?.guildOnly) await target.run?.(ctx);
    return replies;
  }

  function dm(author: UserRef, content: string, channelId = applicantDm): void {
    platform.emit('message', incoming(author, channelId, null, content, platform.id()));
  }

  function lastTo(channelId: string): string {
    const last = platform.sent.filter((entry) => entry.channelId === channelId).at(-1);
    return last ? JSON.stringify(last.out) : '';
  }

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, log, [
      { module: 'tickets', migrations: ticketsDefinition.migrations },
      { module: 'forms', migrations: formsDefinition.migrations },
    ]);
    store = new FormStore(sql);
    ticketStore = new TicketStore(sql);
    platform = new FakePlatform(guild);
    platform.channelList.push(
      channel(reviewChannel, guild, 'apps', 0, null, 0),
      channel(category, guild, 'Forms', 4, null, 1),
    );
    platform.addMember(applicant);
    platform.addMember(shy);
    platform.addMember(first, [reviewerRole]);
    platform.addMember(second, [reviewerRole]);
    platform.addMember(helperBot, [reviewerRole]);
    platform.closedDms.add(shy.id);

    const audit = new AuditStore(sql);
    const modules = new ModuleStore(sql, audit);
    const settings = new Settings(sql, modules, log);
    undo = new UndoRegistry(audit, modules);
    built = {
      log,
      sql,
      platform: platform as unknown as Platform,
      guilds: new GuildStore(sql, 'm!'),
      modules,
      settings,
      audit,
      jobs: {
        handle: (kind: string, handler: JobHandler) => handlers.set(kind, handler),
        enqueue: async (job: JobInput) => {
          jobs.push(job);
          return String(jobs.length);
        },
      },
      undo,
      privacy,
      voice: new Voice(parseIconSet('')),
      config: {},
    } as unknown as Services;

    await modules.replace(guild, 'tickets', {
      panels: [{ id: 'apps', name: 'Applications', categoryId: category }],
      modmail: { enabled: true },
    });
    await modules.replace(guild, 'forms', {
      fallbackCategoryId: category,
      forms: [
        {
          id: 'staff',
          name: 'Staff application',
          reviewChannelId: reviewChannel,
          reviewerRoleIds: [reviewerRole],
          votesToAccept: 2,
          questions: [
            { id: 'mod', label: 'Moderated before?', type: 'yesno' },
            { id: 'team', label: 'Which team?', type: 'choice', options: ['Events', 'Support'] },
          ],
          onAccept: { addRoleIds: [memberRole], openTicket: true, ticketPanelId: 'apps' },
          onDecline: { dm: 'Sorry {user}, {note}' },
        },
      ],
    });
    await modules.setEnabled(guild, 'tickets', true, { id: null });
    await modules.setEnabled(guild, 'forms', true, { id: null });
    settings.invalidate(`${guild}:tickets`);
    settings.invalidate(`${guild}:forms`);

    await tickets.setup?.(createContext(tickets.definition, services()));
    const commands = (await forms.setup?.(createContext(forms.definition, services()))) ?? [];
    const found = commands[0];
    if (!found) throw new Error('no command');
    command = found;
  });

  afterAll(async () => {
    await sql`delete from forms_sessions where guild_id = ${guild}`;
    await sql`delete from forms_submissions where guild_id = ${guild}`;
    await sql`delete from tickets_tickets where guild_id = ${guild}`;
    await sql`delete from tickets_counters where guild_id = ${guild}`;
    await sql`delete from tickets_dm_channels where user_id in ${sql([applicant.id, shy.id])}`;
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('asks the questions in DMs and posts the answers for review', async () => {
    expect(JSON.stringify(await start(applicant, 'staff'))).toContain('Check your DMs.');
    expect(platform.direct.at(-1)?.out.content).toContain('Moderated before?');

    dm(applicant, 'maybe');
    await until(async () => lastTo(applicantDm).includes('Answer with yes or no.'));
    dm(applicant, 'yes');
    await until(async () => lastTo(applicantDm).includes('Which team?'));
    expect(JSON.stringify(await start(applicant, 'staff'))).toContain('already filling out');
    const asked = platform.sent.filter((entry) => entry.channelId === applicantDm).at(-1);
    const digits = platform.reactions.filter((entry) => entry.messageId === asked?.id);
    expect(digits.map((entry) => entry.emoji)).toEqual(['1️⃣', '2️⃣']);
    const press = {
      guildId: null,
      channelId: applicantDm,
      messageId: asked?.id ?? '',
      emoji: '2️⃣',
      bot: false,
    };
    platform.emit('reaction', { ...press, userId: first.id });
    platform.emit('reaction', { ...press, userId: applicant.id });

    const [submission] = await until(async () => {
      const rows = await store.list(guild);
      return rows.length ? rows : null;
    });
    expect(submission?.answers.map((a) => a.display)).toEqual(['Yes', 'Support']);
    expect(await store.session(applicant.id)).toBeNull();
    await until(async () => (await store.submission(submission?.id ?? ''))?.reviewMessageId);
    expect(await ticketStore.openModmail(applicant.id)).toEqual([]);
    expect(JSON.stringify(await start(applicant, 'staff'))).toContain('still being reviewed');
  });

  it('decides by team votes and applies the actions', async () => {
    const [pending] = await store.list(guild);
    const review = {
      guildId: guild,
      channelId: reviewChannel,
      messageId: pending?.reviewMessageId ?? '',
      emoji: accept,
      bot: false,
    };
    platform.emit('reaction', { ...review, userId: helperBot.id, bot: true });
    platform.emit('reaction', { ...review, userId: applicant.id });
    platform.emit('reaction', { ...review, userId: first.id });
    await until(async () => (await store.tally(pending?.id ?? '')).accept === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await store.votes(pending?.id ?? '')).map((v) => v.userId)).toEqual([first.id]);
    platform.emit('reaction', { ...review, userId: second.id });

    const decided = await until(async () => {
      const row = await store.submission(pending?.id ?? '');
      return row?.status === 'accepted' && row.applied ? row : null;
    });
    expect(decided.applied?.addedRoleIds).toEqual([memberRole]);
    expect((await platform.member(guild, applicant.id))?.roles).toContain(memberRole);
    const [ticket] = await ticketStore.openFor(guild, applicant.id, 'apps');
    expect(ticket?.source).toBe('form');
    expect(decided.applied?.ticketId).toBe(ticket?.id);
    expect(platform.direct.at(-1)?.out.content).toContain('was accepted');
  });

  it('undoes a decision and takes a decline from the dashboard', async () => {
    const entry = await until(async () => {
      const [latest] = await services().audit.list(guild, { module: 'forms' });
      return latest?.action === 'submission.accept' ? latest : null;
    });
    expect(await undo.undo(guild, entry?.id ?? '', { id: first.id })).toBe('done');
    const [row] = await store.list(guild);
    expect(row?.status).toBe('pending');
    expect((await platform.member(guild, applicant.id))?.roles).not.toContain(memberRole);

    jobs.push({
      kind: 'forms.review',
      guildId: guild,
      payload: { submissionId: row?.id, decision: 'decline', by: first.id, note: 'not now' },
    });
    await runJobs('forms.review');
    expect((await store.submission(row?.id ?? ''))?.status).toBe('declined');
    expect((await store.submission(row?.id ?? ''))?.decidedBy).toBe(first.id);
    expect(platform.direct.at(-1)?.out.content).toBe(`Sorry <@${applicant.id}>, not now`);
  });

  it('falls back to a private channel when DMs are closed', async () => {
    const replies = await start(shy, 'staff');
    const channel = platform.created.at(-1);
    expect(channel?.input.parentId).toBe(category);
    expect(JSON.stringify(replies)).toContain(`<#${channel?.id}>`);
    expect((await store.session(shy.id))?.mode).toBe('channel');

    platform.emit('message', incoming(shy, channel?.id ?? '', guild, 'cancel', platform.id()));
    await until(async () => (await store.session(shy.id)) === null);
    expect(lastTo(channel?.id ?? '')).toContain('Cancelled');
    expect(jobs.some((job) => job.kind === 'forms.cleanup')).toBe(true);
    await runJobs('forms.cleanup');
    expect(platform.deletedChannels).toContain(channel?.id);
  });

  it('only cleans up channels in the job guild', async () => {
    jobs.push(
      { kind: 'forms.cleanup', guildId: snowflake(9), payload: { channelId: reviewChannel } },
      { kind: 'forms.cleanup', payload: { channelId: reviewChannel } },
    );
    await runJobs('forms.cleanup');
    expect(platform.deletedChannels).not.toContain(reviewChannel);
  });

  it('ends a session that runs out of time', async () => {
    await start(applicant, 'staff');
    const session = await store.session(applicant.id);
    expect(session).not.toBeNull();
    await sql`update forms_sessions set expires_at = now() - interval '1 minute' where id = ${session?.id ?? ''}`;
    jobs.splice(0, jobs.length);
    jobs.push({ kind: 'forms.session.expire', payload: { sessionId: session?.id } });
    await runJobs('forms.session.expire');
    expect(await store.session(applicant.id)).toBeNull();
    expect(platform.direct.at(-1)?.out.content).toContain('timed out');
  });

  it('exports and forgets a member but keeps what is still under review', async () => {
    const [declined] = await store.list(guild, { userId: applicant.id });
    expect(declined?.status).toBe('declined');
    const pending = await store.createSubmission({
      guildId: guild,
      formId: 'other',
      formName: 'Other',
      userId: applicant.id,
      answers: [
        { questionId: 'a', label: 'Why?', type: 'text', value: 'Because', display: 'Because' },
      ],
    });
    const theirs = await store.createSubmission({
      guildId: guild,
      formId: 'staff',
      formName: 'Staff application',
      userId: shy.id,
      answers: [],
    });
    await store.vote(theirs.id, applicant.id, 'accept');
    await store.decide(theirs.id, 'accepted', first.id, null);
    await start(applicant, 'staff');
    expect(await store.session(applicant.id)).not.toBeNull();

    const { data, failed } = await privacy.export(guild, applicant.id);
    expect(failed).toEqual([]);
    const part = data.forms as {
      submissions: { form: string; status: string; answers: { question: string }[] }[];
      session: { form: string } | null;
      reviewVotes: { submissionId: string; vote: string }[];
    };
    expect(part.submissions.map((s) => s.status).sort()).toEqual(['declined', 'pending']);
    expect(part.submissions.find((s) => s.form === 'Other')?.answers[0]?.question).toBe('Why?');
    expect(part.session?.form).toBe('staff');
    expect(part.reviewVotes).toEqual([
      expect.objectContaining({ submissionId: theirs.id, vote: 'accept' }),
    ]);

    expect(await privacy.forget(guild, applicant.id)).toEqual([]);
    expect(await store.session(applicant.id)).toBeNull();
    const left = await store.list(guild, { userId: applicant.id });
    expect(left.map((s) => s.id)).toEqual([pending.id]);
    expect(platform.deleted).toContain(declined?.reviewMessageId);
    expect(await store.votes(theirs.id)).toEqual([]);
    expect((await store.submission(theirs.id))?.status).toBe('accepted');
    expect((await store.history(guild, 'staff', applicant.id)).total).toBe(0);
  });
});
