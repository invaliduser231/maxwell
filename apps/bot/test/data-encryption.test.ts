import { randomBytes } from 'node:crypto';
import {
  configureDataKey,
  connect,
  isSealed,
  migrate,
  type Sql,
  sealExisting,
  sealTargets,
} from '@maxwell/core';
import automod from '@maxwell/core/modules/automod';
import forms from '@maxwell/core/modules/forms';
import moderation from '@maxwell/core/modules/moderation';
import security from '@maxwell/core/modules/security';
import starboard from '@maxwell/core/modules/starboard';
import tickets from '@maxwell/core/modules/tickets';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { FormStore } from '@maxwell/core/stores/forms';
import { InboxStore } from '@maxwell/core/stores/inbox';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { StarboardStore } from '@maxwell/core/stores/starboard';
import { TicketStore } from '@maxwell/core/stores/tickets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('encrypted stores', () => {
  let sql: Sql;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '410000000000000001';
  const mod = '410000000000000009';
  const message = String(420000000000000000n + BigInt(Math.floor(Math.random() * 1e9)));

  beforeAll(async () => {
    configureDataKey(randomBytes(32).toString('base64'));
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: moderation.migrations },
      { module: 'tickets', migrations: tickets.migrations },
      { module: 'automod', migrations: automod.migrations },
      { module: 'starboard', migrations: starboard.migrations },
      { module: 'forms', migrations: forms.migrations },
      { module: 'security', migrations: security.migrations },
    ]);
  });

  afterAll(async () => {
    await new TicketStore(sql).purgeGuild(guild);
    await new FormStore(sql).purgeGuild(guild);
    for (const table of [
      'moderation_cases',
      'moderation_counters',
      'moderation_notes',
      'moderation_names',
      'moderation_inbox',
      'automod_hits',
      'starboard_posts',
    ]) {
      await sql`delete from ${sql(table)} where guild_id = ${guild}`;
    }
    await sql.end();
    configureDataKey(process.env.DATA_KEY || null);
  });

  it('stores case reasons, notes and names encrypted', async () => {
    const store = new ModerationStore(sql);
    const created = await store.create({
      guildId: guild,
      action: 'warn',
      userId: lena,
      moderatorId: mod,
      reason: 'posted a phishing link',
      excerpt: 'free nitro here',
    });
    expect(created.reason).toBe('posted a phishing link');
    const [raw] = await sql<{ reason: string; excerpt: string }[]>`
      select reason, excerpt from moderation_cases where guild_id = ${guild} and number = ${created.number}
    `;
    expect(isSealed(raw?.reason)).toBe(true);
    expect(isSealed(raw?.excerpt)).toBe(true);
    expect((await store.get(guild, created.number))?.excerpt).toBe('free nitro here');

    const changed = await store.setReason(guild, created.number, 'phishing', mod);
    expect(changed?.before).toBe('posted a phishing link');
    await store.voidCase(guild, created.number, mod, 'wrong member');
    expect((await store.get(guild, created.number))?.voidReason).toBe('wrong member');

    const note = await store.addNote(guild, lena, mod, 'talked in DMs');
    expect(note.body).toBe('talked in DMs');
    const [rawNote] = await sql<{ body: string }[]>`
      select body from moderation_notes where id = ${note.id}
    `;
    expect(isSealed(rawNote?.body)).toBe(true);
    expect((await store.notes(guild, lena))[0]?.body).toBe('talked in DMs');

    await store.recordName(guild, lena, 'username', 'lena_new', 'lena_old', false);
    const [name] = await store.nameHistory(guild, lena);
    expect(name?.value).toBe('lena_new');
    expect(name?.previous).toBe('lena_old');
    const exported = await store.memberExport(guild, lena);
    expect(exported.cases[0]?.reason).toBe('phishing');
    expect(exported.names[0]?.value).toBe('lena_new');
  });

  it('searches cases and members after decryption', async () => {
    const store = new ModerationStore(sql);
    await store.create({
      guildId: guild,
      action: 'warn',
      userId: lena,
      moderatorId: mod,
      reason: 'Spamming emotes',
    });
    const found = await store.list(guild, { search: 'spamming' });
    expect(found.map((row) => row.reason)).toEqual(['Spamming emotes']);
    expect(await store.list(guild, { search: 'phish' })).toHaveLength(1);
    expect(await store.list(guild, { search: 'nothing like this' })).toHaveLength(0);

    const members = await store.memberList(guild, {
      view: 'all',
      search: 'LENA_N',
      expiryDays: null,
    });
    expect(members.map((row) => row.userId)).toEqual([lena]);
    expect(members[0]?.username).toBe('lena_new');
  });

  it('appends report text to an encrypted inbox item', async () => {
    const inbox = new InboxStore(sql);
    const first = await inbox.report({
      guildId: guild,
      subjectId: lena,
      reporterId: '410000000000000002',
      channelId: null,
      messageId: message,
      excerpt: 'the bad message',
      body: 'first report',
    });
    const second = await inbox.report({
      guildId: guild,
      subjectId: lena,
      reporterId: '410000000000000003',
      channelId: null,
      messageId: message,
      excerpt: 'the bad message',
      body: 'second report',
    });
    expect(second.kind).toBe('added');
    expect(second.item.body).toBe('first report\nsecond report');
    const [raw] = await sql<{ body: string; excerpt: string }[]>`
      select body, excerpt from moderation_inbox where id = ${first.item.id}
    `;
    expect(isSealed(raw?.body)).toBe(true);
    expect(isSealed(raw?.excerpt)).toBe(true);
    const resolved = await inbox.resolve(guild, first.item.number, {
      status: 'resolved',
      by: mod,
      outcome: 'warned',
      outcomeCase: null,
      note: 'handled in DMs',
    });
    expect(resolved?.after.note).toBe('handled in DMs');
    expect((await inbox.get(guild, first.item.number))?.excerpt).toBe('the bad message');
  });

  it('keeps transcripts encrypted', async () => {
    const store = new TicketStore(sql);
    const ticket = await store.insert({
      guildId: guild,
      number: await store.nextNumber(guild),
      panelId: 'support',
      kind: 'support',
      source: 'panel',
      channelId: message,
      channelName: 'support-1',
      openerId: lena,
      subject: 'my account was hacked',
    });
    expect(ticket.subject).toBe('my account was hacked');
    await store.addMessage(ticket.id, {
      messageId: '430000000000000001',
      authorId: lena,
      authorName: 'Lena',
      bot: false,
      content: 'here is my email',
      attachments: [
        { filename: 'proof.png', url: 'https://cdn/proof.png', contentType: null, size: 1 },
      ],
      createdAt: new Date(),
    });
    await store.editMessage(ticket.id, '430000000000000001', 'here is my email, edited');
    const [raw] = await sql<{ content: string; attachments: unknown }[]>`
      select content, attachments from tickets_messages where ticket_id = ${ticket.id}
    `;
    expect(isSealed(raw?.content)).toBe(true);
    expect(isSealed(raw?.attachments)).toBe(true);
    const [read] = await store.messages(ticket.id);
    expect(read?.content).toBe('here is my email, edited');
    expect(read?.editedAt).not.toBeNull();
    expect(read?.attachments[0]?.filename).toBe('proof.png');
    const transcripts = await store.transcripts([ticket.id]);
    expect(transcripts.get(ticket.id)?.[0]?.content).toBe('here is my email, edited');
    const closed = await store.close(ticket.id, mod, 'solved');
    expect(closed?.closeReason).toBe('solved');
  });

  it('encrypts automod, starboard and form text', async () => {
    const automodStore = new AutomodStore(sql);
    await automodStore.recordHits([
      {
        guildId: guild,
        userId: lena,
        channelId: null,
        messageId: null,
        rule: 'words',
        mode: 'enforce',
        action: 'delete',
        detail: 'matched badword',
        content: 'you are a badword',
      },
    ]);
    const [hit] = await automodStore.hitsForMember(guild, lena);
    expect(hit?.content).toBe('you are a badword');
    expect(hit?.detail).toBe('matched badword');

    const star = await new StarboardStore(sql).upsert({
      messageId: message,
      guildId: guild,
      channelId: message,
      authorId: lena,
      stars: 3,
      content: 'a starred joke',
    });
    expect(star.content).toBe('a starred joke');

    const formStore = new FormStore(sql);
    const submission = await formStore.createSubmission({
      guildId: guild,
      formId: 'apply',
      formName: 'Apply',
      userId: lena,
      answers: [{ questionId: 'age', label: 'Age', type: 'short', value: '19', display: '19' }],
    });
    expect(submission.answers[0]?.display).toBe('19');
    const [raw] = await sql<{ answers: unknown }[]>`
      select answers from forms_submissions where id = ${submission.id}
    `;
    expect(isSealed(raw?.answers)).toBe(true);
    const decided = await formStore.decide(submission.id, 'accepted', mod, 'welcome');
    expect(decided?.note).toBe('welcome');
  });

  it('encrypts existing plaintext rows in batches', async () => {
    const before = await sql<{ id: string }[]>`
      insert into moderation_notes (guild_id, number, user_id, author_id, body)
      select ${guild}, 1000 + n, ${lena}, ${mod}, 'legacy note ' || n
      from generate_series(1, 7) n
      returning id::text
    `;
    await sql`
      insert into automod_hits (guild_id, user_id, rule, mode, detail, content)
      values (${guild}, ${lena}, 'words', 'enforce', 'legacy detail', 'legacy content')
    `;
    const targets = sealTargets.filter((target) =>
      ['moderation_notes', 'automod_hits'].includes(target.table),
    );
    const progress = await sealExisting(sql, { targets, batchSize: 3 });
    const notes = progress.find((entry) => entry.table === 'moderation_notes');
    expect(notes?.sealed).toBeGreaterThanOrEqual(7);
    expect(notes?.batches).toBeGreaterThanOrEqual(3);
    const raw = await sql<{ body: string }[]>`
      select body from moderation_notes where id = any(${before.map((row) => row.id)}::bigint[])
    `;
    expect(raw.every((row) => isSealed(row.body))).toBe(true);
    const store = new ModerationStore(sql);
    const bodies = (await store.notes(guild, lena, 200)).map((note) => note.body);
    expect(bodies).toContain('legacy note 7');
    const hits = await new AutomodStore(sql).hitsForMember(guild, lena);
    expect(hits.map((row) => row.content)).toContain('legacy content');

    const again = await sealExisting(sql, { targets });
    expect(again.every((entry) => entry.sealed === 0)).toBe(true);
  });
});
