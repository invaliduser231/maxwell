import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/tickets';
import { FORGOTTEN_ID, FORGOTTEN_NAME, TicketStore } from '@maxwell/core/stores/tickets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('TicketStore', () => {
  let sql: Sql;
  let store: TicketStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const opener = '310000000000000001';
  const staff = '310000000000000002';
  let channel = 320000000000000000n + BigInt(Math.floor(Math.random() * 1e9));
  const nextChannel = () => {
    channel += 1n;
    return String(channel);
  };

  async function make(panelId = 'support') {
    const number = await store.nextNumber(guild);
    return store.insert({
      guildId: guild,
      number,
      panelId,
      kind: 'support',
      source: 'panel',
      channelId: nextChannel(),
      channelName: `support-${number}`,
      openerId: opener,
      subject: null,
    });
  }

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'tickets', migrations: definition.migrations },
    ]);
    store = new TicketStore(sql);
  });

  afterAll(async () => {
    await store.purgeGuild(guild);
    await sql`delete from guild_modules where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('numbers tickets per guild and finds them by channel', async () => {
    const one = await make();
    const two = await make();
    expect(two.number).toBe(one.number + 1);
    expect((await store.byChannel(two.channelId ?? ''))?.id).toBe(two.id);
    expect(await store.openFor(guild, opener, 'support')).toHaveLength(2);
    expect((await store.byNumber(guild, one.number))?.id).toBe(one.id);
  });

  it('claims and tracks members', async () => {
    const ticket = await make('report');
    expect(await store.claim(ticket.id, staff)).toEqual({ previous: null });
    expect(await store.claim(ticket.id, null)).toEqual({ previous: staff });
    expect(await store.addMember(ticket.id, staff)).toBe(true);
    expect(await store.addMember(ticket.id, staff)).toBe(false);
    expect((await store.get(ticket.id))?.members).toEqual([staff]);
    expect(await store.removeMember(ticket.id, staff)).toBe(true);
    expect(await store.removeMember(ticket.id, staff)).toBe(false);
  });

  it('closes once, rates once and reopens', async () => {
    const ticket = await make();
    await store.touch(ticket.id, staff, new Date());
    expect((await store.close(ticket.id, staff, 'done'))?.status).toBe('closed');
    expect(await store.close(ticket.id, staff, 'again')).toBeNull();
    await store.requestRating(ticket.id, { channelId: '1', messageId: nextChannel() });
    expect((await store.pendingRating(opener))?.id).toBe(ticket.id);
    expect(await store.rate(ticket.id, 5)).toBe(true);
    expect(await store.rate(ticket.id, 1)).toBe(false);
    const summary = await store.summary(guild);
    expect(summary.averageRating).toBe(5);
    expect(summary.averageFirstResponseSeconds).not.toBeNull();
    const overview = await store.overview(guild);
    expect(overview.ratingCounts).toEqual([0, 0, 0, 0, 1]);
    expect(overview.ratings).toBe(1);
    expect(overview.averageRating).toBe(5);
    expect(overview.closedWeek).toBeGreaterThanOrEqual(1);
    expect(overview.medianFirstResponseSeconds).not.toBeNull();
    expect((await store.recentlyClosed(guild, { limit: 5 }))[0]?.id).toBe(ticket.id);
    const reopened = await store.reopen(ticket.id, null);
    expect(reopened?.status).toBe('open');
    expect(reopened?.rating).toBeNull();
  });

  it('keeps structured transcripts with edits and deletions', async () => {
    const ticket = await make();
    const base = {
      authorId: opener,
      authorName: 'Lena',
      bot: false,
      attachments: [{ filename: 'a.png', url: 'u', contentType: 'image/png', size: 1 }],
      createdAt: new Date(),
    };
    expect(await store.addMessage(ticket.id, { ...base, messageId: '1001', content: 'hi' })).toBe(
      true,
    );
    expect(await store.addMessage(ticket.id, { ...base, messageId: '1001', content: 'x' })).toBe(
      false,
    );
    await store.addMessage(
      ticket.id,
      { ...base, messageId: '1001', content: 'relay', via: 'dm' },
      true,
    );
    await store.addMessage(ticket.id, { ...base, messageId: '1002', content: 'second' });
    await store.editMessage(ticket.id, '1002', 'second, edited');
    await store.deleteMessage(ticket.id, '1002');
    const rows = await store.messages(ticket.id);
    expect(rows.map((row) => row.content)).toEqual(['relay', 'second, edited']);
    expect(rows[0]?.attachments[0]?.filename).toBe('a.png');
    expect(rows[1]?.deletedAt).not.toBeNull();
    expect(await store.transcriptSize(ticket.id)).toBe(2);
    expect((await store.lastMessages(ticket.id, 1)).map((row) => row.content)).toEqual([
      'second, edited',
    ]);
    expect((await store.lastMessages(ticket.id, 5)).map((row) => row.messageId)).toEqual([
      '1001',
      '1002',
    ]);
  });

  it('stores embeds and replaces them on override and edits', async () => {
    const ticket = await make();
    const base = {
      authorId: staff,
      authorName: 'Kai',
      bot: false,
      attachments: [],
      createdAt: new Date(),
    };
    await store.addMessage(ticket.id, {
      ...base,
      messageId: '2001',
      content: '',
      embeds: [{ title: 'Preview', url: 'https://example.invalid' }],
    });
    await store.addMessage(ticket.id, { ...base, messageId: '2002', content: 'plain' });
    await store.addMessage(
      ticket.id,
      { ...base, messageId: '2002', content: 'plain', embeds: [{ description: 'card' }] },
      true,
    );
    await store.editMessage(ticket.id, '2001', '', [{ title: 'Preview', description: 'more' }]);
    await store.editMessage(ticket.id, '2002', 'plain, edited');
    const rows = await store.messages(ticket.id);
    expect(rows[0]?.embeds).toEqual([{ title: 'Preview', description: 'more' }]);
    expect(rows[0]?.editedAt).toBeNull();
    expect(rows[1]?.embeds).toEqual([{ description: 'card' }]);
    expect(rows[1]?.editedAt).not.toBeNull();
  });

  it('anonymises a member and keeps open tickets usable', async () => {
    const member = String(BigInt(opener) + 50n + BigInt(Math.floor(Math.random() * 1e6)));
    const insert = async (openerId: string) =>
      store.insert({
        guildId: guild,
        number: await store.nextNumber(guild),
        panelId: 'support',
        kind: 'support',
        source: 'panel',
        channelId: nextChannel(),
        channelName: 'x',
        openerId,
        subject: 'mine',
      });
    const closed = await insert(member);
    const live = await insert(member);
    const helping = await insert(staff);
    await store.addMember(helping.id, member);
    await store.close(helping.id, member, null);
    await store.close(closed.id, member, null);
    await store.requestRating(closed.id, { channelId: '1', messageId: nextChannel() });
    const say = (ticketId: string, messageId: string) =>
      store.addMessage(ticketId, {
        messageId,
        authorId: member,
        authorName: 'Lena',
        authorAvatar: 'https://a/x',
        bot: false,
        content: 'hello',
        attachments: [],
        createdAt: new Date(),
      });
    await say(closed.id, '3001');
    await say(live.id, '3002');
    await say(helping.id, '3003');
    await store.rememberDm(member, '3999');

    expect((await store.openedBy(guild, member)).map((t) => t.id)).toEqual([closed.id, live.id]);
    expect((await store.writtenElsewhere(guild, member)).map((m) => m.ticketNumber)).toEqual([
      helping.number,
    ]);
    const grouped = await store.transcripts([closed.id, live.id]);
    expect(grouped.get(live.id)?.map((m) => m.messageId)).toEqual(['3002']);

    expect(await store.forgetMember(guild, member)).toEqual({ messages: 3, tickets: 2 });
    expect(await store.forgetDm(member)).toBe(true);
    expect(await store.dmChannel(member)).toBeNull();

    const after = await store.get(closed.id);
    expect(after?.openerId).toBe(FORGOTTEN_ID);
    expect(after?.closedBy).toBe(FORGOTTEN_ID);
    expect(after?.ratingMessageId).toBeNull();
    expect((await store.get(live.id))?.openerId).toBe(member);
    const helped = await store.get(helping.id);
    expect(helped?.members).toEqual([]);
    expect(helped?.closedBy).toBe(FORGOTTEN_ID);
    expect(helped?.openerId).toBe(staff);
    const [row] = await store.messages(live.id);
    expect(row).toMatchObject({ authorId: FORGOTTEN_ID, authorName: FORGOTTEN_NAME });
    expect(row?.authorAvatar).toBeNull();
    expect(row?.content).toBe('hello');
    expect(await store.writtenElsewhere(guild, member)).toEqual([]);
  });

  it('maps panel messages and closes gone channels', async () => {
    const messageId = nextChannel();
    await store.savePanel(guild, 'support', '1', messageId, 'x');
    expect((await store.panelByMessage(messageId))?.panelId).toBe('support');
    expect(await store.panels(guild)).toHaveLength(1);
    expect(await store.removePanel(guild, 'support', '999')).toBe(false);
    expect(await store.removePanel(guild, 'support')).toBe(true);

    const ticket = await make();
    const gone = await store.markChannelGone(ticket.channelId ?? '');
    expect(gone?.status).toBe('closed');
    expect(gone?.closeReason).toBe('Channel deleted');
  });

  it('finds tickets due for auto close', async () => {
    await sql`
      insert into guilds (id) values (${guild}) on conflict do nothing
    `;
    await sql`
      insert into guild_modules (guild_id, module, enabled, config)
      values (${guild}, 'tickets', true, ${sql.json({ autoCloseHours: 1 })})
      on conflict (guild_id, module) do update set enabled = true, config = excluded.config
    `;
    const ticket = await make();
    await sql`update tickets_tickets set last_message_at = now() - interval '2 hours' where id = ${ticket.id}`;
    const due = await store.autoCloseDue(500);
    expect(due.map((row) => row.id)).toContain(ticket.id);
  });
});
