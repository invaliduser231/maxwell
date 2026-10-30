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
import definition from '@maxwell/core/modules/events';
import { EventStore, PollStore } from '@maxwell/core/stores/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import events from '../../src/modules/events/index.js';
import type {
  Outgoing,
  OutgoingMessage,
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

interface Edit {
  messageId: string;
  out: OutgoingMessage;
}

class FakePlatform {
  readonly selfId = '900000000000000001';
  readonly events = new EventEmitter();
  readonly sent: { channelId: string; id: string; out: OutgoingMessage }[] = [];
  readonly edits: Edit[] = [];
  readonly direct: { userId: string; text: string }[] = [];
  readonly unreacts: { messageId: string; emoji: string; userId?: string }[] = [];
  readonly reactors = new Map<string, string[]>();
  readonly users = new Map<string, UserRef>();
  failFileEdits = false;
  #next = 950_000_000_000_000_000n;

  constructor(
    readonly guildId: string,
    readonly channelId: string,
  ) {}

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

  guildIds() {
    return [this.guildId];
  }

  async send(channelId: string, message: Outgoing): Promise<string> {
    const out = typeof message === 'string' ? { content: message } : message;
    const id = this.id();
    this.sent.push({ channelId, id, out });
    return id;
  }

  async edit(_channelId: string, messageId: string, message: Outgoing): Promise<void> {
    const out = typeof message === 'string' ? { content: message } : message;
    if (out.files?.length && this.failFileEdits) throw new Error('upload rejected');
    this.edits.push({ messageId, out });
  }

  async delete(): Promise<void> {}

  async sendDirect(userId: string, message: Outgoing): Promise<boolean> {
    this.direct.push({ userId, text: typeof message === 'string' ? message : '' });
    return true;
  }

  async react(): Promise<void> {}

  async unreact(
    _channelId: string,
    messageId: string,
    emoji: string,
    userId?: string,
  ): Promise<void> {
    this.unreacts.push({ messageId, emoji, userId });
    if (!userId) return;
    const key = `${messageId}:${emoji}`;
    this.reactors.set(
      key,
      (this.reactors.get(key) ?? []).filter((id) => id !== userId),
    );
  }

  setReactors(messageId: string, emoji: string, users: string[]): void {
    this.reactors.set(`${messageId}:${emoji}`, users);
  }

  async reactionUsers(
    _channelId: string,
    messageId: string,
    emoji: string,
    limit = 100,
    after?: string,
  ): Promise<string[]> {
    const all = [...(this.reactors.get(`${messageId}:${emoji}`) ?? [])].sort();
    const start = after ? all.findIndex((id) => id > after) : 0;
    return start < 0 ? [] : all.slice(start, start + limit);
  }

  async user(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async guild(guildId: string) {
    return { id: guildId, name: 'Test Place', memberCount: 10, iconUrl: null };
  }

  async channelInGuild(_guildId: string, channelId: string) {
    return channelId === this.channelId;
  }

  async missingBotPermissions() {
    return [];
  }
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

describe.skipIf(!url)('events flow', () => {
  let sql: Sql;
  let platform: FakePlatform;
  let pollStore: PollStore;
  let eventStore: EventStore;
  let privacy: PrivacyRegistry;
  let modules: ModuleStore;
  let settings: Settings;
  const handlers = new Map<string, JobHandler>();
  const jobs: JobInput[] = [];
  const guild = snowflake(8);
  const channel = snowflake(51);
  const lena = snowflake(71);
  const max = snowflake(72);
  const ada = snowflake(73);
  const robot = snowflake(74);
  const one = '1️⃣';
  const two = '2️⃣';

  async function run(kind: string, filter?: (job: JobInput) => boolean): Promise<JobInput[]> {
    const due = jobs.filter((job) => job.kind === kind && (!filter || filter(job)));
    for (const job of due) jobs.splice(jobs.indexOf(job), 1);
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
    return due;
  }

  async function openPoll(question: string, anonymous = false): Promise<string> {
    const draft = await pollStore.create({
      guildId: guild,
      question,
      options: ['Pizza', 'Sushi'],
      anonymous,
      channelId: channel,
    });
    jobs.push({ kind: 'events.poll.publish', guildId: guild, payload: { pollId: draft.id } });
    await run('events.poll.publish');
    const opened = await pollStore.get(guild, draft.id);
    if (!opened?.messageId) throw new Error('poll not published');
    return draft.id;
  }

  async function messageOf(pollId: string): Promise<string> {
    return (await pollStore.get(guild, pollId))?.messageId ?? '';
  }

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, log, [{ module: 'events', migrations: definition.migrations }]);
    pollStore = new PollStore(sql);
    eventStore = new EventStore(sql);
    platform = new FakePlatform(guild, channel);
    platform.users.set(robot, {
      id: robot,
      username: 'robot',
      displayName: 'Robot',
      bot: true,
      avatarUrl: 'https://a/robot',
    });

    const audit = new AuditStore(sql);
    modules = new ModuleStore(sql, audit);
    settings = new Settings(sql, modules, log);
    privacy = new PrivacyRegistry();
    const services = {
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
      undo: new UndoRegistry(audit, modules),
      privacy,
      cards: { forGuild: async () => undefined },
      voice: new Voice(parseIconSet('')),
      config: {},
    } as unknown as Services;

    await modules.setEnabled(guild, 'events', true, { id: null });
    settings.invalidate(`${guild}:events`);
    await events.setup?.(createContext(events.definition, services));
  });

  beforeEach(() => {
    jobs.length = 0;
    platform.failFileEdits = false;
  });

  afterAll(async () => {
    await sql`delete from events_events where guild_id = ${guild}`;
    await sql`delete from events_polls where guild_id = ${guild}`;
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql`delete from guild_modules where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('puts the result card into the poll message when it closes', async () => {
    const pollId = await openPoll('Lunch?');
    const messageId = await messageOf(pollId);
    await pollStore.vote({ id: pollId, guildId: guild, multiple: false }, lena, 0, false);
    platform.setReactors(messageId, one, [platform.selfId, lena]);
    platform.setReactors(messageId, two, [platform.selfId]);
    const sentBefore = platform.sent.length;

    jobs.push({ kind: 'events.poll.close', guildId: guild, payload: { pollId } });
    await run('events.poll.close');

    const number = (await pollStore.get(guild, pollId))?.number;
    const closing = platform.edits.filter((edit) => edit.messageId === messageId).at(-1);
    expect(closing?.out.files?.[0]?.name).toBe(`poll-${number}.png`);
    expect(closing?.out.embeds?.[0]?.imageUrl).toBe(`attachment://poll-${number}.png`);
    const posted = platform.sent.slice(sentBefore);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.out.content).toContain('Pizza');
    expect(posted[0]?.out.files).toBeUndefined();
  });

  it('posts the card separately when the edit upload fails', async () => {
    const pollId = await openPoll('Dinner?');
    const messageId = await messageOf(pollId);
    platform.setReactors(messageId, one, [platform.selfId]);
    platform.setReactors(messageId, two, [platform.selfId, max]);
    platform.failFileEdits = true;
    const sentBefore = platform.sent.length;

    jobs.push({ kind: 'events.poll.close', guildId: guild, payload: { pollId } });
    await run('events.poll.close');

    const closing = platform.edits.filter((edit) => edit.messageId === messageId).at(-1);
    expect(closing?.out.files).toBeUndefined();
    expect(closing?.out.embeds?.[0]?.description).toContain('Closed');
    const posted = platform.sent.slice(sentBefore);
    const number = (await pollStore.get(guild, pollId))?.number;
    expect(posted[0]?.out.files?.[0]?.name).toBe(`poll-${number}.png`);
    expect(posted[0]?.out.content).toContain('Sushi');
    expect((await pollStore.results({ id: pollId, options: ['a', 'b'] })).counts).toEqual([0, 1]);
  });

  it('reconciles votes missed while offline when it comes back', async () => {
    const pollId = await openPoll('Movie?');
    const messageId = await messageOf(pollId);
    const poll = { id: pollId, guildId: guild, multiple: false };
    await pollStore.vote(poll, lena, 0, false);
    await pollStore.vote(poll, max, 0, false);
    const many = Array.from({ length: 140 }, (_, index) => `5${String(index).padStart(17, '0')}`);
    platform.setReactors(messageId, one, [platform.selfId, lena, ada, robot]);
    platform.setReactors(messageId, two, [platform.selfId, ada, ...many]);

    platform.emit('ready');
    await until(async () => jobs.some((job) => job.kind === 'events.poll.sync'));
    await run('events.poll.sync', (job) => job.payload?.pollId === pollId);

    const ballots = await pollStore.ballots(pollId);
    expect(ballots.get(lena)).toEqual([0]);
    expect(ballots.has(max)).toBe(false);
    expect(ballots.get(ada)).toEqual([0]);
    expect(ballots.has(robot)).toBe(false);
    expect(ballots.has(platform.selfId)).toBe(false);
    expect(ballots.get(many[139] as string)).toEqual([1]);
    expect(platform.unreacts).toContainEqual({ messageId, emoji: two, userId: ada });
  }, 20_000);

  it('turns reactions on an anonymous poll into votes after downtime', async () => {
    const pollId = await openPoll('Secret?', true);
    const messageId = await messageOf(pollId);
    platform.setReactors(messageId, two, [platform.selfId, lena]);

    jobs.push({ kind: 'events.poll.sync', guildId: guild, payload: { pollId } });
    await run('events.poll.sync');

    expect(await pollStore.ballots(pollId)).toEqual(new Map([[lena, [1]]]));
    expect(platform.unreacts).toContainEqual({ messageId, emoji: two, userId: lena });
    expect(platform.direct.some((dm) => dm.userId === lena && dm.text.includes('Sushi'))).toBe(
      true,
    );
  });

  it('ignores reactions from bots', async () => {
    const pollId = await openPoll('Bots?');
    const messageId = await messageOf(pollId);
    const reaction = { guildId: guild, channelId: channel, messageId, emoji: one };
    platform.emit('reaction', { ...reaction, userId: robot, bot: true });
    platform.emit('reaction', { ...reaction, userId: lena, bot: false });
    await until(async () => (await pollStore.ballots(pollId)).has(lena));
    expect((await pollStore.ballots(pollId)).has(robot)).toBe(false);
  });

  it('pays members who are going when the event starts', async () => {
    await modules.replace(guild, 'events', { rewardAmount: 25, channelId: channel });
    await modules.setEnabled(guild, 'economy', true, { id: null });
    settings.invalidate(`${guild}:events`);
    settings.invalidate(`${guild}:economy`);

    const startsAt = new Date(Date.now() + 3_600_000);
    const row = await eventStore.create({
      guildId: guild,
      title: 'Game night',
      startsAt,
      timezone: 'UTC',
      channelId: channel,
    });
    jobs.push({ kind: 'events.publish', guildId: guild, payload: { eventId: row.id } });
    await run('events.publish');
    const published = await eventStore.get(guild, row.id);
    const messageId = published?.messageId ?? '';
    expect(platform.sent.at(-1)?.out.embeds?.[0]?.description).toContain('**Reward** 25 Joules');
    expect(jobs.some((job) => job.kind === 'events.start')).toBe(true);

    await eventStore.setRsvp(row, lena, 'going');
    await eventStore.setRsvp(row, max, 'maybe');
    platform.setReactors(messageId, '✅', [platform.selfId, lena, ada]);
    platform.setReactors(messageId, '❔', [platform.selfId, max]);

    await run('events.start');
    const reward = jobs.find((job) => job.kind === 'economy.reward');
    expect(reward?.guildId).toBe(guild);
    expect(reward?.payload).toEqual({
      userIds: expect.arrayContaining([lena, ada]),
      amount: 25,
      reason: 'Event: Game night',
    });
    expect(reward?.payload?.userIds).toHaveLength(2);
  });

  it('skips the reward when the amount is zero', async () => {
    await modules.replace(guild, 'events', { rewardAmount: 0, channelId: channel });
    settings.invalidate(`${guild}:events`);
    const row = await eventStore.create({
      guildId: guild,
      title: 'Free night',
      startsAt: new Date(Date.now() + 3_600_000),
      timezone: 'UTC',
      channelId: channel,
    });
    await eventStore.setRsvp(row, lena, 'going');
    jobs.push({
      kind: 'events.start',
      guildId: guild,
      payload: { eventId: row.id, startsAt: row.startsAt.getTime() },
    });
    await run('events.start');
    expect(jobs.some((job) => job.kind === 'economy.reward')).toBe(false);
  });

  it('exports and forgets RSVPs and poll votes', async () => {
    const exported = await privacy.export(guild, lena);
    const data = exported.data.events as {
      rsvps: { title: string; status: string }[];
      pollVotes: { question: string; choices: string[] }[];
    };
    expect(data.rsvps).toContainEqual(
      expect.objectContaining({ title: 'Game night', status: 'going' }),
    );
    expect(data.pollVotes).toContainEqual(
      expect.objectContaining({ question: 'Secret?', choices: ['Sushi'] }),
    );

    const bots = await pollStore.list(guild, { status: 'open' });
    const open = bots.find((poll) => poll.question === 'Bots?');
    expect(await privacy.forget(guild, lena)).toEqual([]);
    expect((await privacy.export(guild, lena)).data.events).toBeUndefined();
    expect(platform.unreacts).toContainEqual({
      messageId: open?.messageId,
      emoji: one,
      userId: lena,
    });
    expect(jobs.some((job) => job.kind === 'events.poll.refresh')).toBe(true);
    expect(jobs.some((job) => job.kind === 'events.rsvp.refresh')).toBe(true);
  });
});
