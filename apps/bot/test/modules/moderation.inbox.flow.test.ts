import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { moderationConfig } from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { InboxFeed } from '../../src/modules/moderation/feed.js';
import { ModInbox } from '../../src/modules/moderation/inbox.js';
import { ModerationService } from '../../src/modules/moderation/service.js';
import type { IncomingMessage, Outgoing, UserRef } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('moderation inbox flows', () => {
  let sql: Sql;
  let moderation: ModerationService;
  let inbox: ModInbox;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const spammer = '410000000000000001';
  const lena = '410000000000000002';
  const tom = '410000000000000003';
  const mod = '410000000000000009';
  const config = moderationConfig.parse({ inboxChannelId: '900', reportEmoji: '🚩' });

  const sent: { channel: string; out: Outgoing }[] = [];
  const edited: string[] = [];
  const direct: { user: string; out: Outgoing }[] = [];
  const unreacted: string[] = [];
  const timeouts: string[] = [];
  const bans: string[] = [];
  const unbans: string[] = [];
  const deleted: string[] = [];
  const records: { action: string; undo: unknown }[] = [];

  const user = (id: string): UserRef => ({
    id,
    username: `u${id.slice(-2)}`,
    displayName: `User ${id.slice(-2)}`,
    bot: false,
    avatarUrl: '',
  });

  const message: IncomingMessage = {
    id: '420000000000000001',
    channelId: '600',
    guildId: guild,
    content: 'free nitro at example.com',
    author: user(spammer),
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(),
  };

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    let next = 0;
    const platform = {
      selfId: '100000000000000001',
      user: async (id: string) => user(id),
      guild: async () => ({ id: guild, name: 'Lab', memberCount: 10, iconUrl: null }),
      member: async () => null,
      message: async (_channel: string, id: string) => (id === message.id ? message : null),
      send: async (channel: string, out: Outgoing) => {
        sent.push({ channel, out });
        return String(9_000 + ++next);
      },
      edit: async (_channel: string, id: string) => void edited.push(id),
      sendDirect: async (userId: string, out: Outgoing) => {
        direct.push({ user: userId, out });
        return true;
      },
      unreact: async (_c: string, _m: string, _e: string, userId: string) =>
        void unreacted.push(userId),
      delete: async (_channel: string, id: string) => void deleted.push(id),
      timeout: async (_g: string, userId: string) => void timeouts.push(userId),
      ban: async (_g: string, userId: string) => void bans.push(userId),
      unban: async (_g: string, userId: string) => void unbans.push(userId),
    };
    const services = {
      sql,
      platform,
      log: createLogger('silent', false),
      guilds: { prefix: async () => '!' },
      settings: { enabled: async () => true },
      config: { FLUXER_WEB_URL: 'https://fluxer.app', DASHBOARD_URL: 'https://dash.example' },
    } as unknown as Services;
    const ctx = {
      key: 'moderation',
      definition,
      services,
      config: async () => config,
      on: () => {},
      job: () => {},
      schedule: async () => null,
      undo: () => {},
      privacy: () => {},
      onShutdown: () => {},
      record: async (
        _guild: string,
        _actor: unknown,
        action: string,
        _summary: string,
        extra?: { undo?: unknown },
      ) => {
        records.push({ action, undo: extra?.undo });
        return '1';
      },
    } as unknown as ModuleContext<typeof moderationConfig>;
    moderation = new ModerationService(ctx, new ModerationStore(sql));
    inbox = new ModInbox(moderation);
  });

  afterAll(async () => {
    await sql`delete from moderation_inbox where guild_id = ${guild}`;
    await sql`delete from moderation_cases where guild_id = ${guild}`;
    await sql`delete from moderation_counters where guild_id = ${guild}`;
    await sql`delete from jobs where guild_id = ${guild}`;
    await sql.end();
  });

  const react = (userId: string, emoji = '🚩') =>
    inbox.onReaction({
      guildId: guild,
      channelId: message.channelId,
      messageId: message.id,
      userId,
      emoji,
      bot: false,
    });

  it('turns a flag reaction into a report and posts it to the inbox channel', async () => {
    await react(lena);
    expect(unreacted).toEqual([lena]);
    expect(direct.map((entry) => entry.user)).toEqual([lena]);
    expect(sent.map((entry) => entry.channel)).toEqual(['900']);

    const item = await inbox.store.get(guild, 1);
    expect(item?.subjectId).toBe(spammer);
    expect(item?.excerpt).toBe('free nitro at example.com');
    expect(item?.noticeChannelId).toBe('900');

    await react('410000000000000004', '👍');
    expect(unreacted).toEqual([lena]);
  });

  it('adds a second reporter to the same report and edits the notice', async () => {
    await react(tom);
    const item = await inbox.store.get(guild, 1);
    expect(item?.reporters).toEqual([lena, tom]);
    expect(sent).toHaveLength(1);
    expect(edited).toContain(item?.noticeMessageId);
  });

  it('resolves a report with a timeout and can be restored', async () => {
    const resolved = await inbox.resolve(guild, {
      number: 1,
      status: 'resolved',
      action: 'timeout',
      durationSeconds: 3_600,
      reason: 'scam link',
      deleteMessage: true,
      note: 'second time',
      by: mod,
    });
    expect(resolved?.outcome).toBe('timeout');
    expect(timeouts).toEqual([spammer]);
    expect(deleted).toEqual([message.id]);
    const row = await moderation.store.get(guild, resolved?.outcomeCase ?? 0);
    expect(row?.action).toBe('timeout');
    expect(row?.meta.inbox).toBe(1);
    expect(row?.excerpt).toBe('free nitro at example.com');

    const record = records.find((entry) => entry.action === 'inbox.resolve');
    const undo = record?.undo as { kind: string; payload: Record<string, unknown> };
    expect(undo.kind).toBe('inbox');
    await inbox.restore(guild, undo.payload, { id: mod });
    expect((await inbox.store.get(guild, 1))?.status).toBe('open');
  });

  it('runs an escalation review through the inbox without closing it twice', async () => {
    const flag = await moderation.store.create({
      guildId: guild,
      action: 'flag',
      userId: spammer,
      moderatorId: null,
      reason: '7 warnings in 30 days',
      meta: { suggested: 'ban', durationMinutes: null },
    });
    await inbox.openReview(flag);
    const review = await inbox.store.reviewFor(guild, flag.number);
    expect(review?.kind).toBe('review');

    const resolved = await inbox.resolve(guild, {
      number: review?.number ?? 0,
      status: 'resolved',
      action: null,
      durationSeconds: null,
      reason: null,
      deleteMessage: false,
      note: null,
      by: mod,
    });
    expect(resolved?.outcome).toBe('approved');
    expect(bans).toEqual([spammer]);
    expect((await moderation.store.get(guild, flag.number))?.endedAt).not.toBeNull();
  });

  it('closes a review that was decided outside the inbox', async () => {
    const flag = await moderation.store.create({
      guildId: guild,
      action: 'flag',
      userId: tom,
      moderatorId: null,
      reason: '7 warnings in 30 days',
      meta: { suggested: 'ban' },
    });
    await inbox.openReview(flag);
    await moderation.resolveReview(guild, flag.number, false, mod);
    const review = await inbox.store.reviewFor(guild, flag.number);
    expect(review?.status).toBe('dismissed');
    expect(review?.outcome).toBe('declined');
  });

  it('adds the appeal link to the ban message when appeals are on', async () => {
    const target = '410000000000000007';
    config.appeals = true;
    try {
      await moderation.act({
        guildId: guild,
        action: 'ban',
        userId: target,
        moderatorId: mod,
        reason: 'raid',
        source: 'command',
      });
    } finally {
      config.appeals = false;
    }
    const message = direct.find((entry) => entry.user === target)?.out;
    const text = typeof message === 'string' ? message : (message?.content ?? '');
    expect(text).toContain(`https://dash.example/appeal/${guild}`);
  });

  it('lifts the ban when an appeal is accepted and tells the member', async () => {
    const appeal = await inbox.store.appeal({
      guildId: guild,
      subjectId: spammer,
      body: 'It was my brother.',
      caseNumber: null,
    });
    if (appeal.kind !== 'created') throw new Error('appeal not created');
    const resolved = await inbox.resolve(guild, {
      number: appeal.item.number,
      status: 'resolved',
      action: null,
      durationSeconds: null,
      reason: null,
      deleteMessage: false,
      note: null,
      by: mod,
    });
    expect(resolved?.outcome).toBe('unban');
    expect(unbans).toEqual([spammer]);
    expect(direct.at(-1)?.user).toBe(spammer);
  });
  const jobKinds = async () =>
    (
      await sql<{ kind: string }[]>`select kind from jobs where guild_id = ${guild} order by id`
    ).map((row) => row.kind);

  it('keeps one gate item while members wait and hands decisions to AutoMod', async () => {
    const feed = new InboxFeed(moderation.services);
    await feed.gate(guild, 2);
    await feed.gate(guild, 5);
    const gates = await inbox.store.list(guild, { kind: 'gate' });
    expect(gates).toHaveLength(1);
    expect(gates[0]?.body).toBe('5');
    expect((await inbox.embed(gates[0] as never)).fields?.some((f) => f.value.includes('5'))).toBe(
      true,
    );
    expect(await jobKinds()).toContain('moderation.inbox.notify');

    const resolved = await inbox.resolve(guild, {
      number: gates[0]?.number ?? 0,
      status: 'resolved',
      action: 'ban',
      durationSeconds: null,
      reason: null,
      deleteMessage: false,
      note: null,
      by: mod,
    });
    expect(resolved?.outcome).toBe('banned');
    expect(await jobKinds()).toContain('automod.gate.banall');

    await feed.gate(guild, 1);
    await feed.gateClosed(guild, 0, 'let_in', mod);
    expect(await inbox.store.list(guild, { kind: 'gate' })).toHaveLength(0);
  });

  it('turns stuck verifications into items and lets members in through Security', async () => {
    const feed = new InboxFeed(moderation.services);
    await feed.check(guild, lena, '9001', 'undelivered');
    const [item] = await inbox.store.list(guild, { kind: 'check' });
    expect(item?.subjectId).toBe(lena);
    const resolved = await inbox.resolve(guild, {
      number: item?.number ?? 0,
      status: 'resolved',
      action: null,
      durationSeconds: null,
      reason: null,
      deleteMessage: false,
      note: null,
      by: mod,
    });
    expect(resolved?.outcome).toBe('released');
    expect(await jobKinds()).toContain('security.pass');

    await feed.check(guild, tom, '9002', 'failed');
    await feed.checksClosedFor(guild, tom, 'left', null);
    expect(await inbox.store.list(guild, { kind: 'check' })).toHaveLength(0);
  });
});
