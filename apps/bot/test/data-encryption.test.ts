import { randomBytes } from 'node:crypto';
import {
  AuditStore,
  configureDataKey,
  connect,
  isSealed,
  ModuleStore,
  migrate,
  type SealTarget,
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
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { UndoRegistry } from '../src/runtime/undo.js';

const url = process.env.TEST_DATABASE_URL;

interface RawAudit {
  id: string;
  before: { reason?: unknown } | null;
  after: { reason?: unknown } | null;
  undo: { payload?: { reason?: unknown } } | null;
}

describe.skipIf(!url)('encrypted stores', () => {
  let sql: Sql;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '410000000000000001';
  const mod = '410000000000000009';
  const message = String(420000000000000000n + BigInt(Math.floor(Math.random() * 1e9)));
  const ledger = String(BigInt(guild) + 1n);
  const pages = String(BigInt(guild) + 2n);

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
    await sql`delete from audit_entries where guild_id in (${ledger}, ${pages})`;
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

  it('keeps case reasons in the audit log encrypted', async () => {
    const audit = new AuditStore(sql);
    const undo = new UndoRegistry(audit, new ModuleStore(sql, audit));
    const restored: unknown[] = [];
    undo.handle('moderation.reason', async (_entry, payload) => {
      restored.push(payload.reason);
    });
    const id = await audit.record({
      guildId: ledger,
      actor: { id: mod },
      module: 'moderation',
      action: 'case.reason',
      summary: 'Changed the reason of case #7',
      before: { reason: 'Posted a phishing link' },
      after: { reason: 'scam DMs to new members' },
      undo: {
        kind: 'moderation.reason',
        payload: { number: 7, reason: 'Posted a phishing link', unclaim: false },
      },
    });
    const voided = await audit.record({
      guildId: ledger,
      actor: { id: mod },
      module: 'moderation',
      action: 'case.void',
      summary: 'Voided case #7',
      after: { case: 7, reason: 'wrong member' },
      undo: { kind: 'moderation.void', payload: { numbers: [7] } },
    });
    const lock = await audit.record({
      guildId: ledger,
      actor: { id: mod },
      module: 'moderation',
      action: 'lock',
      summary: 'Locked #general',
      after: { channelId: message, reason: 'phishing wave' },
      undo: null,
    });

    const raw = await sql<RawAudit[]>`
      select id::text as id, before, after, undo from audit_entries
      where guild_id = ${ledger} and action like 'case.%'
    `;
    expect(raw).toHaveLength(2);
    expect(JSON.stringify(raw)).not.toMatch(/phishing link|scam DMs|wrong member/i);
    const edit = raw.find((row) => row.id === id);
    expect(isSealed(edit?.before?.reason)).toBe(true);
    expect(isSealed(edit?.after?.reason)).toBe(true);
    expect(isSealed(edit?.undo?.payload?.reason)).toBe(true);

    const entry = await audit.get(ledger, id);
    expect(entry?.before).toEqual({ reason: 'Posted a phishing link' });
    expect(entry?.after).toEqual({ reason: 'scam DMs to new members' });
    expect(entry?.undo).toEqual({
      kind: 'moderation.reason',
      payload: { number: 7, reason: 'Posted a phishing link', unclaim: false },
    });
    const listed = await audit.list(ledger, { module: 'moderation' });
    expect(listed.map((row) => row.id)).toEqual([lock, voided, id]);
    expect(listed[1]?.after).toEqual({ case: 7, reason: 'wrong member' });
    expect(listed[0]?.after).toEqual({ channelId: message, reason: 'phishing wave' });

    const search = async (term: string, limit?: number, before?: string) =>
      (await audit.list(ledger, { search: term, limit, before })).map((row) => row.id);
    expect(await search('PHISHING')).toEqual([lock, id]);
    expect(await search('PHISHING', 1)).toEqual([lock]);
    expect(await search('PHISHING', 1, lock)).toEqual([id]);
    expect(await search('scam dms')).toEqual([id]);
    expect(await search('wrong member')).toEqual([voided]);
    expect(await search('"reason": "scam')).toEqual([id]);
    expect(await search('case #7')).toEqual([voided, id]);
    expect(await search('enc:v1')).toEqual([]);

    expect(await undo.undo(ledger, id, { id: mod })).toBe('done');
    expect(restored).toEqual(['Posted a phishing link']);
  });

  it('finds encrypted reasons further back than one page', async () => {
    const audit = new AuditStore(sql);
    const record = (number: number, reason: string) =>
      audit.record({
        guildId: pages,
        actor: { id: mod },
        module: 'moderation',
        action: 'case.warn',
        summary: `Warned @lena (#${number})`,
        after: { case: number, userId: lena, reason, durationSeconds: null },
        undo: { kind: 'warn', payload: { number, userId: lena } },
      });
    const needle = await record(1, 'needle in the haystack');
    for (let number = 2; number <= 205; number++) await record(number, `spam ${number}`);
    const found = await audit.list(pages, { search: 'NEEDLE', limit: 5 });
    expect(found.map((row) => row.id)).toEqual([needle]);
    expect(found[0]?.after).toEqual({
      case: 1,
      userId: lena,
      reason: 'needle in the haystack',
      durationSeconds: null,
    });
    const cases = (rows: { after: unknown }[]) =>
      rows.map((row) => (row.after as { case: number }).case);
    const first = await audit.list(pages, { search: 'spam', limit: 3 });
    expect(cases(first)).toEqual([205, 204, 203]);
    const next = await audit.list(pages, { search: 'spam', limit: 3, before: first[2]?.id });
    expect(cases(next)).toEqual([202, 201, 200]);
    expect(await audit.list(pages, { search: 'spam', before: needle })).toEqual([]);
    expect(cases(await audit.list(pages, { search: 'spam 2', limit: 200 }))).toEqual([
      205, 204, 203, 202, 201, 200, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 2,
    ]);
    expect(cases(await audit.list(pages, { search: 'spam 2', limit: 7 }))).toEqual([
      205, 204, 203, 202, 201, 200, 29,
    ]);

    const single = postgres(url as string, { max: 1, onnotice: () => {} });
    try {
      const lone = new AuditStore(single);
      const [deep, few, plain] = await Promise.all([
        lone.list(pages, { search: 'needle' }),
        lone.list(pages, { search: 'spam 2', limit: 3 }),
        lone.list(pages, { limit: 1 }),
      ]);
      expect(deep.map((row) => row.id)).toEqual([needle]);
      expect(cases(few)).toEqual([205, 204, 203]);
      expect(cases(plain)).toEqual([205]);
    } finally {
      await single.end();
    }
  });

  it('encrypts case reasons already in the audit log', async () => {
    const insert = async (action: string, before: unknown, after: unknown, undo: unknown) => {
      const [row] = await sql<{ id: string }[]>`
        insert into audit_entries (guild_id, actor_id, module, action, summary, before, after, undo)
        values (
          ${ledger}, ${mod}, 'moderation', ${action}, 'legacy',
          ${before === null ? null : sql.json(before as never)},
          ${sql.json(after as never)},
          ${undo === null ? null : sql.json(undo as never)}
        )
        returning id::text as id
      `;
      return row?.id ?? '';
    };
    const edited = await insert(
      'case.reason',
      { reason: 'old wording' },
      { reason: 'new wording' },
      { kind: 'moderation.reason', payload: { number: 9, reason: 'old wording', unclaim: true } },
    );
    const cleared = await insert(
      'case.clear',
      null,
      { cases: [10, 11], reason: 'appeal accepted' },
      { kind: 'moderation.void', payload: { numbers: [10, 11] } },
    );
    const locked = await insert('lock', null, { channelId: message, reason: 'raid' }, null);

    const [audit] = sealTargets.filter((target) => target.table === 'audit_entries');
    const target: SealTarget = {
      ...(audit as SealTarget),
      where: `${audit?.where} and guild_id = ${ledger}`,
    };
    const progress = await sealExisting(sql, { targets: [target], batchSize: 1 });
    expect(progress).toEqual([{ table: 'audit_entries', scanned: 2, sealed: 2, batches: 2 }]);

    const raw = await sql<RawAudit[]>`
      select id::text as id, before, after, undo from audit_entries
      where id = any(${[edited, cleared, locked]}::bigint[])
    `;
    const rowOf = (id: string) => raw.find((row) => row.id === id);
    expect(isSealed(rowOf(edited)?.before?.reason)).toBe(true);
    expect(isSealed(rowOf(edited)?.after?.reason)).toBe(true);
    expect(isSealed(rowOf(edited)?.undo?.payload?.reason)).toBe(true);
    expect(isSealed(rowOf(cleared)?.after?.reason)).toBe(true);
    expect(rowOf(cleared)?.undo).toEqual({
      kind: 'moderation.void',
      payload: { numbers: [10, 11] },
    });
    expect(rowOf(locked)?.after).toEqual({ channelId: message, reason: 'raid' });

    const store = new AuditStore(sql);
    const entry = await store.get(ledger, edited);
    expect(entry?.before).toEqual({ reason: 'old wording' });
    expect(entry?.after).toEqual({ reason: 'new wording' });
    expect(entry?.undo?.payload).toEqual({ number: 9, reason: 'old wording', unclaim: true });
    expect((await store.get(ledger, cleared))?.after).toEqual({
      cases: [10, 11],
      reason: 'appeal accepted',
    });
    expect((await store.list(ledger, { search: 'appeal accepted' })).map((row) => row.id)).toEqual([
      cleared,
    ]);

    const again = await sealExisting(sql, { targets: [target] });
    expect(again).toEqual([{ table: 'audit_entries', scanned: 0, sealed: 0, batches: 0 }]);
  });
});
