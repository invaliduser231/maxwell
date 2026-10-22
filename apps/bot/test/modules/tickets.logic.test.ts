import definition, { ticketsConfig } from '@maxwell/core/modules/tickets';
import { describe, expect, it } from 'vitest';
import { BoundedCache, KeyedQueue } from '../../src/modules/tickets/cache.js';
import { findPanel, modmailTarget, resolveTarget } from '../../src/modules/tickets/config.js';
import {
  displayEmoji,
  normalizeEmoji,
  ratingEmojis,
  ratingFromEmoji,
  ratingFromText,
  sameEmoji,
} from '../../src/modules/tickets/emoji.js';
import {
  cannedName,
  cleanChannelName,
  fillTemplate,
  ticketChannelName,
} from '../../src/modules/tickets/naming.js';
import { panelEmbed, panelEmoji } from '../../src/modules/tickets/panels.js';
import { isInternalNote } from '../../src/modules/tickets/privacy.js';
import { transcriptEmbeds } from '../../src/modules/tickets/render.js';
import { toTranscript } from '../../src/modules/tickets/service.js';

const config = ticketsConfig.parse({
  panels: [
    { id: 'support', name: 'Support', teamRoleIds: ['500000000000000001'] },
    { id: 'report', kind: 'report', name: 'Report', emoji: '<:flag:600000000000000001>' },
  ],
  modmail: { enabled: true, teamRoleIds: ['500000000000000002'] },
});

describe('tickets config', () => {
  it('parses an empty config with defaults', () => {
    const parsed = ticketsConfig.parse({});
    expect(parsed.panels).toEqual([]);
    expect(parsed.modmail.enabled).toBe(false);
    expect(parsed.modmail.internalMarker).toBe('//');
    expect(parsed.closeDelaySeconds).toBe(10);
  });

  it('keeps every table behind the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('tickets_')).toBe(true);
    }
  });

  it('finds panels by id or name and resolves modmail', () => {
    expect(findPanel(config, 'REPORT')?.id).toBe('report');
    expect(findPanel(config, 'support')?.name).toBe('Support');
    expect(findPanel(config, 'nope')).toBeNull();
    expect(resolveTarget(config, 'modmail')?.teamRoleIds).toEqual(['500000000000000002']);
    expect(modmailTarget(config).kind).toBe('modmail');
    expect(resolveTarget(config, 'gone')).toBeNull();
  });
});

describe('emoji helpers', () => {
  it('normalizes custom emoji input', () => {
    expect(normalizeEmoji('<:flag:600000000000000001>')).toBe('flag:600000000000000001');
    expect(normalizeEmoji('<a:spin:600000000000000002>')).toBe('spin:600000000000000002');
    expect(normalizeEmoji(' :flag:600000000000000001 ')).toBe('flag:600000000000000001');
    expect(displayEmoji('flag:600000000000000001')).toBe('<:flag:600000000000000001>');
  });

  it('compares emojis by id or without variation selectors', () => {
    expect(sameEmoji('flag:600000000000000001', 'other:600000000000000001')).toBe(true);
    expect(sameEmoji('✅', '✅\u{FE0F}')).toBe(true);
    expect(sameEmoji('✅', '❌')).toBe(false);
  });

  it('reads ratings from reactions and text', () => {
    expect(ratingFromEmoji(ratingEmojis[3] ?? '')).toBe(4);
    expect(ratingFromEmoji('3⃣')).toBe(3);
    expect(ratingFromEmoji('✅')).toBeNull();
    expect(ratingFromText('5')).toBe(5);
    expect(ratingFromText(' 4/5 ')).toBe(4);
    expect(ratingFromText('2 of 5')).toBe(2);
    expect(ratingFromText('6')).toBeNull();
    expect(ratingFromText('1 thing')).toBeNull();
  });

  it('falls back to a default panel emoji', () => {
    const support = config.panels[0];
    const report = config.panels[1];
    if (!support || !report) throw new Error('fixture');
    expect(panelEmoji(report)).toBe('flag:600000000000000001');
    expect(panelEmoji(support)).not.toBe('');
    expect(panelEmbed(report).description).toContain('<:flag:600000000000000001>');
    expect(panelEmbed(support).title).toBe('Support');
  });
});

describe('naming', () => {
  it('builds clean channel names', () => {
    expect(
      ticketChannelName('{panel}-{number}', { panel: 'support', number: 7, user: 'Lena' }),
    ).toBe('support-0007');
    expect(
      ticketChannelName('{user} {panel}', { panel: 'report', number: 1, user: 'Lëna B.' }),
    ).toBe('lena-b-report');
    expect(ticketChannelName('!!!', { panel: 'x', number: 42, user: 'a' })).toBe('ticket-0042');
    expect(cleanChannelName('  Refund -- Lena!  ')).toBe('refund-lena');
  });

  it('fills templates and leaves unknown keys', () => {
    expect(fillTemplate('Hi {user}, {missing}', { user: 'Lena' })).toBe('Hi Lena, {missing}');
  });

  it('detects canned reply triggers', () => {
    expect(cannedName('$refund', '$')).toBe('refund');
    expect(cannedName('  $Refund ', '$')).toBe('refund');
    expect(cannedName('$ two words', '$')).toBeNull();
    expect(cannedName('refund', '$')).toBeNull();
  });
});

describe('transcripts', () => {
  const base = {
    id: '700000000000000001',
    channelId: '1',
    guildId: '2',
    author: {
      id: '3',
      username: 'lena',
      displayName: 'Lena',
      bot: false,
      avatarUrl: 'https://example.invalid/a.png',
    },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(0),
  };

  it('skips empty messages and keeps attachments', () => {
    expect(toTranscript({ ...base, content: '  ' })).toBeNull();
    const row = toTranscript({
      ...base,
      content: '',
      attachments: [{ url: 'u', filename: 'f.png', contentType: 'image/png', size: 3 }],
    });
    expect(row?.attachments).toEqual([
      { filename: 'f.png', url: 'u', contentType: 'image/png', size: 3 },
    ]);
    expect(row?.authorName).toBe('Lena');
    expect(row?.embeds).toEqual([]);
  });

  it('keeps embeds, also on messages without text', () => {
    const at = new Date('2026-10-01T12:00:00Z');
    const row = toTranscript({
      ...base,
      content: '',
      embeds: [
        {
          title: 'Order 12',
          description: 'Shipped',
          color: 0x112233,
          author: { name: 'Shop', iconUrl: 'https://example.invalid/i.png' },
          fields: [{ name: 'Items', value: '3', inline: true }],
          footer: 'Thanks',
          imageUrl: 'https://example.invalid/big.png',
          timestamp: at,
        },
        {},
      ],
    });
    expect(row?.embeds).toEqual([
      {
        title: 'Order 12',
        description: 'Shipped',
        color: 0x112233,
        author: 'Shop',
        fields: [{ name: 'Items', value: '3' }],
        footer: 'Thanks',
        imageUrl: 'https://example.invalid/big.png',
        timestamp: at.toISOString(),
      },
    ]);
  });

  it('caps long embed text and the embed count', () => {
    const embeds = transcriptEmbeds(
      Array.from({ length: 12 }, () => ({ description: 'x'.repeat(5_000) })),
    );
    expect(embeds).toHaveLength(10);
    expect(embeds[0]?.description?.length).toBeLessThanOrEqual(4096);
    expect(transcriptEmbeds(undefined)).toEqual([]);
  });
});

describe('internal notes', () => {
  const message = {
    ticketId: '1',
    messageId: '2',
    authorId: '30',
    authorName: 'Kai',
    authorAvatar: null,
    bot: false,
    via: null,
    content: '// keep this between us',
    attachments: [],
    embeds: [],
    createdAt: new Date(0),
    editedAt: null,
    deletedAt: null,
  };

  it('hides team-only notes from modmail exports only', () => {
    expect(isInternalNote(message, 'modmail', '40', '//')).toBe(true);
    expect(isInternalNote(message, 'panel', '40', '//')).toBe(false);
    expect(isInternalNote({ ...message, authorId: '40' }, 'modmail', '40', '//')).toBe(false);
    expect(isInternalNote({ ...message, content: 'hello' }, 'modmail', '40', '//')).toBe(false);
  });
});

describe('BoundedCache', () => {
  it('evicts the oldest entry and expires by ttl', () => {
    const cache = new BoundedCache<string, number | null>(2, 1_000);
    cache.set('a', 1, 0);
    cache.set('b', null, 0);
    cache.set('c', 3, 0);
    expect(cache.peek('a', 10)).toBeUndefined();
    expect(cache.peek('b', 10)).toEqual({ value: null });
    expect(cache.peek('c', 2_000)).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});

describe('KeyedQueue', () => {
  it('runs tasks for one key in order and cleans up', async () => {
    const queue = new KeyedQueue();
    const seen: number[] = [];
    const slow = queue.run('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen.push(1);
    });
    const fast = queue.run('a', async () => {
      seen.push(2);
    });
    await Promise.all([slow, fast]);
    expect(seen).toEqual([1, 2]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.size).toBe(0);
  });

  it('keeps going after a failure', async () => {
    const queue = new KeyedQueue();
    await expect(queue.run('a', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(queue.run('a', async () => 5)).resolves.toBe(5);
  });
});
