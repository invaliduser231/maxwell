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
import definition from '@maxwell/core/modules/tickets';
import { FORGOTTEN_ID, FORGOTTEN_NAME, TicketStore } from '@maxwell/core/stores/tickets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Args } from '../../src/commands/args.js';
import type { Command, GuildContext } from '../../src/commands/types.js';
import { createLogger } from '../../src/log.js';
import { ratingEmojis } from '../../src/modules/tickets/emoji.js';
import tickets from '../../src/modules/tickets/index.js';
import type {
  ChannelInput,
  ChannelRef,
  Embed,
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
  readonly dms = new Map<string, string>();
  readonly opened: string[] = [];
  readonly removedOverwrites: { channelId: string; id: string }[] = [];
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

  async openDirect(userId: string): Promise<string | null> {
    this.opened.push(userId);
    if (this.closedDms.has(userId)) return null;
    return this.dms.get(userId) ?? null;
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

  async isMember(guildId: string, userId: string) {
    return guildId === this.guildId && this.members.has(userId);
  }

  async channels() {
    return this.channelList;
  }

  async channelInGuild(_guildId: string, channelId: string) {
    return this.channelList.some((channel) => channel.id === channelId);
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

  async deleteOverwrite(channelId: string, id: string): Promise<void> {
    this.removedOverwrites.push({ channelId, id });
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
  embeds: Embed[] = [],
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
    embeds,
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

describe.skipIf(!url)('tickets flow', () => {
  let sql: Sql;
  let store: TicketStore;
  let platform: FakePlatform;
  let undo: UndoRegistry;
  let settings: Settings;
  let command: Command;
  const privacy = new PrivacyRegistry();
  const handlers = new Map<string, JobHandler>();
  const jobs: JobInput[] = [];
  const guild = snowflake(8);
  const opener = user(snowflake(71), 'Lena');
  const staff = user(snowflake(72), 'Kai');
  const helper = user(snowflake(73), 'Ada');
  const writer = user(snowflake(74), 'Mo');
  const teamRole = snowflake(61);
  const panelChannel = snowflake(51);
  const category = snowflake(52);
  const logChannel = snowflake(53);
  const dmChannel = snowflake(54);
  const writerDm = snowflake(55);
  let ticketChannel = '';

  async function runJobs(short: string): Promise<void> {
    const kind = `tickets.${short}`;
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

  function sub(name: string): Command {
    const found = command.subcommands?.find((candidate) => candidate.name === name);
    if (!found) throw new Error(name);
    return found;
  }

  async function run(
    name: string,
    author: UserRef,
    channelId: string,
    values: Record<string, string> = {},
  ) {
    const replies: Outgoing[] = [];
    const message = incoming(author, channelId, guild, '', platform.id());
    const ctx: GuildContext = {
      message,
      guildId: guild,
      prefix: 'm!',
      path: ['ticket', name],
      args: new Args(new Map(Object.entries(values))),
      services: services(),
      platform: platform as unknown as Platform,
      seed: { seed: message.id, scope: channelId },
      reply: async (out) => {
        replies.push(out);
        return platform.id();
      },
    };
    const target = sub(name);
    if (target.guildOnly) await target.run?.(ctx);
    return replies;
  }

  let built: Services | null = null;
  function services(): Services {
    if (!built) throw new Error('not ready');
    return built;
  }

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, log, [{ module: 'tickets', migrations: definition.migrations }]);
    store = new TicketStore(sql);
    platform = new FakePlatform(guild);
    platform.channelList.push(
      channel(panelChannel, guild, 'help', 0, null, 0),
      channel(category, guild, 'Tickets', 4, null, 1),
      channel(logChannel, guild, 'log', 0, null, 2),
    );
    platform.dms.set(opener.id, dmChannel);
    platform.addMember(opener);
    platform.addMember(staff, [teamRole]);
    platform.addMember(helper);
    platform.addMember(writer);

    const audit = new AuditStore(sql);
    const modules = new ModuleStore(sql, audit);
    settings = new Settings(sql, modules, log);
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
      config: { DASHBOARD_URL: 'https://dash.example' },
    } as unknown as Services;

    await modules.replace(guild, 'tickets', {
      panels: [
        {
          id: 'support',
          name: 'Support',
          channelId: panelChannel,
          categoryId: category,
          teamRoleIds: [teamRole],
        },
      ],
      logChannelId: logChannel,
      closeDelaySeconds: 0,
      cannedReplies: [{ name: 'hi', content: 'Hello {user}, {staff} here.' }],
      modmail: { enabled: true, teamRoleIds: [teamRole] },
    });
    await modules.setEnabled(guild, 'tickets', true, { id: null });
    settings.invalidate(`${guild}:tickets`);

    const ctx = createContext(tickets.definition, services());
    const commands = (await tickets.setup?.(ctx)) ?? [];
    const found = commands[0];
    if (!found) throw new Error('no command');
    command = found;
  });

  afterAll(async () => {
    await sql`delete from tickets_tickets where guild_id = ${guild}`;
    await sql`delete from tickets_panels where guild_id = ${guild}`;
    await sql`delete from tickets_counters where guild_id = ${guild}`;
    await sql`delete from tickets_dm_channels where user_id in ${sql([opener.id, writer.id])}`;
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql`delete from jobs where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('publishes a panel and opens a ticket from a reaction', async () => {
    await runJobs('panel.publish');
    jobs.push({ kind: 'tickets.panel.publish', guildId: guild, payload: { panelId: 'support' } });
    await runJobs('panel.publish');
    const panel = platform.sent.find((entry) => entry.channelId === panelChannel);
    expect(panel?.out.embeds?.[0]?.title).toBe('Support');
    const emoji = platform.reactions.find((r) => r.messageId === panel?.id)?.emoji ?? '';
    expect(emoji).not.toBe('');

    platform.emit('reaction', {
      guildId: guild,
      channelId: panelChannel,
      messageId: panel?.id ?? '',
      userId: writer.id,
      emoji,
      bot: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await store.openFor(guild, writer.id)).toHaveLength(0);

    platform.emit('reaction', {
      guildId: guild,
      channelId: panelChannel,
      messageId: panel?.id ?? '',
      userId: opener.id,
      emoji,
      bot: false,
    });
    const [ticket] = await until(async () => {
      const open = await store.openFor(guild, opener.id);
      return open.length ? open : null;
    });
    expect(ticket?.number).toBe(1);
    ticketChannel = ticket?.channelId ?? '';
    const created = platform.created.find((entry) => entry.id === ticketChannel);
    expect(created?.input.parentId).toBe(category);
    expect(created?.input.name).toBe('support-0001');
    expect(created?.input.overwrites?.map((o) => o.id)).toEqual(
      expect.arrayContaining([guild, platform.selfId, teamRole, opener.id]),
    );
    await until(async () => platform.sent.some((entry) => entry.channelId === logChannel));
    await until(async () => (await store.byChannel(ticketChannel))?.controlMessageId);
  });

  it('captures messages and posts canned replies for the team', async () => {
    platform.emit(
      'message',
      incoming(opener, ticketChannel, guild, 'my thing broke', platform.id()),
    );
    const preview = platform.id();
    platform.emit(
      'message',
      incoming(
        opener,
        ticketChannel,
        guild,
        '',
        preview,
        [],
        [{ title: 'Error page', description: 'Status 500', url: 'https://example.invalid/e' }],
      ),
    );
    const trigger = platform.id();
    platform.emit('message', incoming(staff, ticketChannel, guild, '$hi', trigger, [teamRole]));
    await until(async () =>
      platform.sent.some(
        (entry) => entry.out.content === `Hello <@${opener.id}>, <@${staff.id}> here.`,
      ),
    );
    expect(platform.deleted).toContain(trigger);
    const ticket = await store.byChannel(ticketChannel);
    const messages = await store.messages(ticket?.id ?? '');
    expect(messages.map((m) => m.content)).toContain('my thing broke');
    expect(ticket?.firstResponseAt).not.toBeNull();
    const embedded = await until(async () =>
      (await store.messages(ticket?.id ?? '')).find((m) => m.messageId === preview),
    );
    expect(embedded.embeds).toEqual([
      { title: 'Error page', description: 'Status 500', url: 'https://example.invalid/e' },
    ]);
    const greeting = messages.find((m) => m.messageId === ticket?.controlMessageId);
    expect(greeting?.embeds[0]?.title).toBe('Support #0001');

    platform.emit('messageEdit', {
      message: incoming(
        opener,
        ticketChannel,
        guild,
        '',
        preview,
        [],
        [{ title: 'Error page', description: 'Status 502' }],
      ),
      before: '',
    });
    const edited = await until(async () =>
      (await store.messages(ticket?.id ?? '')).find(
        (m) => m.messageId === preview && m.embeds[0]?.description === 'Status 502',
      ),
    );
    expect(edited.editedAt).toBeNull();
  });

  it('keeps one open ticket per member', async () => {
    const panel = platform.sent.find((entry) => entry.channelId === panelChannel);
    const emoji = platform.reactions.find((r) => r.messageId === panel?.id)?.emoji ?? '';
    platform.emit('reaction', {
      guildId: guild,
      channelId: panelChannel,
      messageId: panel?.id ?? '',
      userId: opener.id,
      emoji,
      bot: false,
    });
    await until(async () => platform.direct.some((d) => d.out.content?.includes('already have')));
    expect(await store.openFor(guild, opener.id)).toHaveLength(1);
  });

  it('lets the team claim, add, remove and rename', async () => {
    expect(await run('claim', opener, ticketChannel)).toHaveLength(1);
    await run('claim', staff, ticketChannel);
    expect((await store.byChannel(ticketChannel))?.claimedBy).toBe(staff.id);

    await run('add', staff, ticketChannel, { member: helper.id });
    expect((await store.byChannel(ticketChannel))?.members).toEqual([helper.id]);
    expect(
      platform.overwrites.some(
        (o) => o.overwrite.id === helper.id && o.overwrite.allow.includes('ViewChannel'),
      ),
    ).toBe(true);

    const removeOpener = await run('remove', staff, ticketChannel, { member: opener.id });
    expect(JSON.stringify(removeOpener)).toContain('stays');

    await run('rename', staff, ticketChannel, { name: 'Broken Thing' });
    expect((await store.byChannel(ticketChannel))?.channelName).toBe('broken-thing');

    const [entry] = await services().audit.list(guild, { module: 'tickets' });
    expect(entry?.action).toBe('ticket.rename');
    expect(await undo.undo(guild, entry?.id ?? '', { id: staff.id })).toBe('done');
    expect((await store.byChannel(ticketChannel))?.channelName).toBe('support-0001');
  });

  it('drops the overwrite when a member is removed and puts it back on undo', async () => {
    const denies = () =>
      platform.overwrites.filter(
        (o) => o.overwrite.id === helper.id && o.overwrite.deny.includes('ViewChannel'),
      ).length;
    const before = denies();
    await run('remove', staff, ticketChannel, { member: helper.id });
    expect(platform.removedOverwrites).toContainEqual({ channelId: ticketChannel, id: helper.id });
    expect((await store.byChannel(ticketChannel))?.members).toEqual([]);
    expect(denies()).toBe(before);

    const [entry] = await services().audit.list(guild, { module: 'tickets' });
    expect(entry?.action).toBe('ticket.member.remove');
    expect(await undo.undo(guild, entry?.id ?? '', { id: staff.id })).toBe('done');
    expect((await store.byChannel(ticketChannel))?.members).toEqual([helper.id]);

    const removed = platform.removedOverwrites.length;
    const adds = await services().audit.list(guild, { module: 'tickets' });
    const add = adds.find((candidate) => candidate.action === 'ticket.member.add');
    expect(await undo.undo(guild, add?.id ?? '', { id: staff.id })).toBe('done');
    expect(platform.removedOverwrites).toHaveLength(removed + 1);
    expect((await store.byChannel(ticketChannel))?.members).toEqual([]);
    await run('add', staff, ticketChannel, { member: helper.id });
  });

  it('closes with a transcript, deletes the channel and takes a rating', async () => {
    const replies = await run('close', helper, ticketChannel, { reason: 'nope' });
    expect(JSON.stringify(replies)).toContain('Only the ticket team');
    await run('close', opener, ticketChannel, { reason: 'fixed' });
    const closed = await store.byChannel(ticketChannel);
    expect(closed?.status).toBe('closed');
    expect(closed?.closeReason).toBe('fixed');

    await runJobs('finish');
    expect(platform.deletedChannels).toContain(ticketChannel);
    const after = await store.get(closed?.id ?? '');
    expect(after?.channelId).toBeNull();
    expect(after?.ratingRequestedAt).not.toBeNull();
    const logged = platform.sent.filter((entry) => entry.channelId === logChannel);
    expect(JSON.stringify(logged.at(-1)?.out)).toContain(`/guilds/${guild}/tickets/${closed?.id}`);
    const prompt = platform.sent.find(
      (entry) => entry.channelId === dmChannel && entry.out.content?.includes('React with 1 to 5'),
    );
    expect(prompt).toBeDefined();
    expect(platform.opened).toContain(opener.id);
    expect(
      platform.reactions.filter((r) => r.messageId === prompt?.id).map((r) => r.emoji),
    ).toEqual(ratingEmojis);
    expect(await store.dmChannel(opener.id)).toBe(dmChannel);

    platform.emit('reaction', {
      guildId: null,
      channelId: dmChannel,
      messageId: prompt?.id ?? '',
      userId: opener.id,
      emoji: ratingEmojis[0] ?? '',
      bot: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await store.get(closed?.id ?? ''))?.rating).toBeNull();

    platform.emit('message', incoming(opener, dmChannel, null, '4', platform.id()));
    const rated = await until(async () => {
      const row = await store.get(closed?.id ?? '');
      return row?.rating ? row : null;
    });
    expect(rated.rating).toBe(4);
  });

  it('reopens a closed ticket through undo', async () => {
    const entries = await services().audit.list(guild, { module: 'tickets' });
    const close = entries.find((entry) => entry.action === 'ticket.close');
    expect(await undo.undo(guild, close?.id ?? '', { id: staff.id })).toBe('done');
    const [ticket] = await store.openFor(guild, opener.id);
    expect(ticket?.status).toBe('open');
    expect(ticket?.channelId).not.toBe(ticketChannel);
    expect(ticket?.rating).toBeNull();
    ticketChannel = ticket?.channelId ?? '';
  });

  it('runs modmail both ways', async () => {
    const first = incoming(writer, writerDm, null, 'Someone is spamming me', platform.id());
    platform.emit('message', first);
    const [ticket] = await until(async () => {
      const open = await store.openModmail(writer.id);
      return open.length ? open : null;
    });
    expect(ticket?.source).toBe('modmail');
    const channelId = ticket?.channelId ?? '';
    await until(async () =>
      platform.sent.some(
        (entry) =>
          entry.channelId === channelId &&
          entry.out.embeds?.[0]?.description === 'Someone is spamming me',
      ),
    );
    await until(async () =>
      platform.sent.some(
        (entry) => entry.channelId === writerDm && entry.out.content?.includes('Sent to'),
      ),
    );

    platform.emit(
      'message',
      incoming(staff, channelId, guild, '// internal', platform.id(), [teamRole]),
    );
    platform.emit(
      'message',
      incoming(staff, channelId, guild, 'We are on it', platform.id(), [teamRole]),
    );
    await until(async () =>
      platform.sent.some(
        (entry) =>
          entry.channelId === writerDm && entry.out.embeds?.[0]?.description === 'We are on it',
      ),
    );
    expect(
      platform.sent.some(
        (entry) =>
          entry.channelId === writerDm && entry.out.embeds?.[0]?.description === '// internal',
      ),
    ).toBe(false);

    const transcript = await store.messages(ticket?.id ?? '');
    const relayed = transcript.find((row) => row.via === 'dm');
    expect(relayed?.authorId).toBe(writer.id);
    expect(relayed?.content).toBe('Someone is spamming me');
  });

  it('exports a member ticket history without internal notes', async () => {
    await until(async () =>
      (await store.openModmail(writer.id))[0]
        ? (await store.messages((await store.openModmail(writer.id))[0]?.id ?? '')).some(
            (m) => m.content === '// internal',
          )
        : false,
    );
    const { data, failed } = await privacy.export(guild, writer.id);
    expect(failed).toEqual([]);
    const part = data.tickets as {
      tickets: { source: string; transcript: { content: string; mine: boolean }[] }[];
      dmChannelId: string | null;
    };
    const [modmail] = part.tickets;
    expect(modmail?.source).toBe('modmail');
    const contents = modmail?.transcript.map((m) => m.content) ?? [];
    expect(contents).toContain('Someone is spamming me');
    expect(contents).toContain('We are on it');
    expect(contents).not.toContain('// internal');
    expect(modmail?.transcript.find((m) => m.content === 'Someone is spamming me')?.mine).toBe(
      true,
    );
    expect(part.dmChannelId).toBe(writerDm);

    const staffPart = (await privacy.export(guild, staff.id)).data.tickets as {
      tickets: unknown[];
      messagesInOtherTickets: { ticket: number; content: string }[];
    };
    expect(staffPart.tickets).toEqual([]);
    expect(staffPart.messagesInOtherTickets.map((m) => m.content)).toContain('We are on it');
    expect(await privacy.export(guild, snowflake(79))).toEqual({ data: {}, failed: [] });
  });

  it('forgets a member: anonymises transcripts, keeps live tickets working', async () => {
    const [live] = await store.openFor(guild, opener.id);
    expect(live).toBeDefined();
    expect(await privacy.forget(guild, opener.id)).toEqual([]);

    const afterLive = await store.get(live?.id ?? '');
    expect(afterLive?.openerId).toBe(opener.id);
    const rows = await store.messages(live?.id ?? '');
    expect(rows.some((m) => m.authorId === opener.id)).toBe(false);
    const anonymised = rows.find((m) => m.content === 'my thing broke');
    expect(anonymised?.authorName).toBe(FORGOTTEN_NAME);
    expect(anonymised?.authorId).toBe(FORGOTTEN_ID);
    expect(anonymised?.authorAvatar).toBeNull();
    expect(await store.dmChannel(opener.id)).toBeNull();

    await run('close', staff, ticketChannel, { reason: 'done' });
    expect(await privacy.forget(guild, opener.id)).toEqual([]);
    const closed = await store.get(live?.id ?? '');
    expect(closed?.openerId).toBe(FORGOTTEN_ID);
    expect(closed?.members).not.toContain(opener.id);
    expect(closed?.ratingMessageId).toBeNull();
    expect(await store.openedBy(guild, opener.id)).toEqual([]);

    const opened = platform.opened.length;
    const sentBefore = platform.sent.length;
    await runJobs('finish');
    expect(platform.opened).toHaveLength(opened);
    expect(platform.sent.slice(sentBefore).some((entry) => entry.channelId === dmChannel)).toBe(
      false,
    );
    expect(await privacy.export(guild, opener.id)).toEqual({ data: {}, failed: [] });
  });

  it('runs dashboard jobs as the person who sent them', async () => {
    const [ticket] = await store.openModmail(writer.id);
    const ticketId = ticket?.id ?? '';
    const channelId = ticket?.channelId ?? '';

    jobs.push({ kind: 'tickets.claim', guildId: guild, payload: { ticketId, by: staff.id } });
    await runJobs('claim');
    expect((await store.get(ticketId))?.claimedBy).toBe(staff.id);
    const [claim] = await services().audit.list(guild, { module: 'tickets' });
    expect(claim?.action).toBe('ticket.claim');
    expect(claim?.actorId).toBe(staff.id);

    jobs.push({
      kind: 'tickets.member.add',
      guildId: guild,
      payload: { ticketId, userId: helper.id, by: staff.id },
    });
    await runJobs('member.add');
    expect((await store.get(ticketId))?.members).toContain(helper.id);

    jobs.push({
      kind: 'tickets.reply',
      guildId: guild,
      payload: { ticketId, content: 'Looking at it now, {user}', by: staff.id },
    });
    await runJobs('reply');
    const posted = platform.sent.find(
      (entry) =>
        entry.channelId === channelId &&
        entry.out.embeds?.[0]?.description === `Looking at it now, <@${writer.id}>`,
    );
    expect(posted?.out.embeds?.[0]?.author?.name).toBe('Kai');
    expect(
      platform.sent.some(
        (entry) =>
          entry.channelId === writerDm &&
          entry.out.embeds?.[0]?.description === `Looking at it now, <@${writer.id}>`,
      ),
    ).toBe(true);
    const row = (await store.messages(ticketId)).find((m) => m.messageId === posted?.id);
    expect(row?.authorId).toBe(staff.id);
    expect(row?.via).toBe('dashboard');

    jobs.push({ kind: 'tickets.close', guildId: guild, payload: { ticketId, by: staff.id } });
    await runJobs('close');
    const closed = await store.get(ticketId);
    expect(closed?.status).toBe('closed');
    expect(closed?.closedBy).toBe(staff.id);
  });
});
