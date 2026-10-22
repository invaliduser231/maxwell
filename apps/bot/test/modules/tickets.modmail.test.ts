import { ticketsConfig } from '@maxwell/core/modules/tickets';
import type { ModmailTarget } from '@maxwell/core/stores/tickets';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Language, setLanguageSource } from '../../src/i18n/language.js';
import {
  type Candidate,
  Modmail,
  mapLimited,
  matchCandidates,
  orderCandidates,
  PAGE_SIZE,
  PICK_MS,
} from '../../src/modules/tickets/modmail.js';
import type { TicketService } from '../../src/modules/tickets/service.js';
import type { IncomingMessage, Outgoing, ReactionEvent } from '../../src/platform/types.js';
import { parseIconSet } from '../../src/ui/icons.js';
import { Voice } from '../../src/ui/voice.js';

const userId = '700000000000000001';
const dm = '710000000000000001';

interface FakeGuild {
  name: string;
  enabled: boolean;
  modmail: boolean;
  member: boolean | null;
  language: Language;
}

function text(out: Outgoing): string {
  return typeof out === 'string' ? out : (out.content ?? '');
}

function guildId(index: number): string {
  return String(800000000000000000n + BigInt(index));
}

function setup(count: number, options: { targets?: ModmailTarget[] } = {}) {
  const guilds = new Map<string, FakeGuild>();
  for (let i = 1; i <= count; i++) {
    guilds.set(guildId(i), {
      name: `Community ${String(i).padStart(3, '0')}`,
      enabled: true,
      modmail: true,
      member: false,
      language: 'en',
    });
  }
  const present = new Set(guilds.keys());
  const replies: string[] = [];
  const edits: string[] = [];
  const reactions: string[] = [];
  let next = 0;
  let inflight = 0;
  let peak = 0;
  const clock = { t: 1_000_000 };
  const targets = options.targets ?? [];

  const platform = {
    guildIds: () => [...present],
    isMember: vi.fn(async (id: string) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inflight--;
      const guild = guilds.get(id);
      return guild ? guild.member : false;
    }),
    guild: async (id: string) => ({
      id,
      name: guilds.get(id)?.name ?? id,
      memberCount: 1,
      iconUrl: null,
    }),
    reply: vi.fn(async (_message: IncomingMessage, out: Outgoing) => {
      replies.push(text(out));
      next++;
      return `9000${next}`;
    }),
    react: vi.fn(async (_channel: string, _message: string, emoji: string) => {
      reactions.push(emoji);
    }),
    edit: vi.fn(async (_channel: string, _message: string, out: Outgoing) => {
      edits.push(text(out));
    }),
  };
  const store = {
    openModmail: vi.fn(async () => [] as unknown[]),
    modmailGuilds: vi.fn(async () => [...guilds.keys()]),
    modmailTargets: vi.fn(async () => targets),
    useModmailTarget: vi.fn(async () => {}),
  };
  const ctx = {
    enabled: async (id: string) => guilds.get(id)?.enabled ?? false,
    config: async (id: string) =>
      ticketsConfig.parse({ modmail: { enabled: guilds.get(id)?.modmail ?? false } }),
  };
  const opened: { guildId: string; subject: string | null }[] = [];
  const service = {
    ctx,
    store,
    services: {
      platform,
      log: { warn() {}, info() {}, debug() {}, error() {} },
      voice: new Voice(parseIconSet('')),
    },
    open: vi.fn(async (input: { guildId: string; subject: string | null }) => {
      opened.push({ guildId: input.guildId, subject: input.subject });
      return { ok: true, ticket: { id: 't1', guildId: input.guildId, channelId: 'c1' } };
    }),
    relayFromMember: vi.fn(async () => true),
  };
  setLanguageSource(async (id) => guilds.get(id)?.language ?? 'en');
  const modmail = new Modmail(service as unknown as TicketService, () => clock.t);

  function message(content: string): IncomingMessage {
    next++;
    return {
      id: `5000${next}`,
      channelId: dm,
      guildId: null,
      content,
      author: { id: userId, username: 'mo', displayName: 'Mo', bot: false, avatarUrl: null },
      memberRoles: [],
      fromWebhook: false,
      attachments: [],
      embeds: [],
      mentionUsers: [],
      mentionRoles: [],
      mentionEveryone: false,
      replyTo: null,
      createdAt: new Date(),
    } as unknown as IncomingMessage;
  }

  function reaction(messageId: string, emoji: string): ReactionEvent {
    return { guildId: null, channelId: dm, messageId, userId, emoji, bot: false };
  }

  function join(...indexes: number[]): void {
    for (const index of indexes) {
      const guild = guilds.get(guildId(index));
      if (guild) guild.member = true;
    }
  }

  return {
    guilds,
    present,
    replies,
    edits,
    reactions,
    opened,
    clock,
    store,
    platform,
    service,
    modmail,
    message,
    reaction,
    join,
    peak: () => peak,
    lastListId: () => `9000${next}`,
  };
}

afterEach(() => {
  setLanguageSource(null);
});

describe('modmail helpers', () => {
  const list: Candidate[] = [
    { id: '1', name: 'Pixel Club' },
    { id: '2', name: 'Pixel Art' },
    { id: '3', name: 'Garden' },
  ];

  it('matches names by part, exact names first', () => {
    expect(matchCandidates(list, 'garden').map((guild) => guild.id)).toEqual(['3']);
    expect(matchCandidates(list, 'pixel').map((guild) => guild.id)).toEqual(['1', '2']);
    expect(matchCandidates(list, 'pixel art').map((guild) => guild.id)).toEqual(['2']);
    expect(matchCandidates(list, '  ')).toEqual([]);
  });

  it('puts recently used communities first', () => {
    const ordered = orderCandidates(list, [
      { guildId: '3', usedAt: new Date(2), pinnedUntil: null },
      { guildId: '2', usedAt: new Date(1), pinnedUntil: null },
    ]);
    expect(ordered.map((guild) => guild.id)).toEqual(['3', '2', '1']);
  });

  it('runs at most the given number of tasks at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimited([...Array(30).keys()], 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(out[29]).toBe(58);
  });
});

describe('modmail', () => {
  it('finds the one community out of many without a cap', async () => {
    const t = setup(120);
    t.join(117);
    await t.modmail.handle(t.message('Someone is spamming me'));
    expect(t.opened).toEqual([{ guildId: guildId(117), subject: 'Someone is spamming me' }]);
    expect(t.peak()).toBeLessThanOrEqual(8);
    expect(t.store.useModmailTarget).toHaveBeenCalledWith(userId, guildId(117));
  });

  it('caches membership checks for a while', async () => {
    const t = setup(5);
    await t.modmail.handle(t.message('hello'));
    await t.modmail.handle(t.message('hello again'));
    expect(t.platform.isMember).toHaveBeenCalledTimes(5);
  });

  it('lists every match over pages and picks by global number', async () => {
    const t = setup(25);
    t.join(...Array.from({ length: 25 }, (_, i) => i + 1));
    await t.modmail.handle(t.message('help'));
    const list = t.replies.at(-1) ?? '';
    expect(list).toContain('Page 1 of 3');
    expect(list).toContain('Community 010');
    expect(list).not.toContain('Community 011');
    expect(t.reactions).toEqual(['◀️', '▶️']);

    const listId = t.lastListId();
    expect(await t.modmail.onPage(t.reaction(listId, '▶️'))).toBe(true);
    expect(t.edits.at(-1)).toContain('`11` **Community 011**');
    expect(await t.modmail.onPage(t.reaction(listId, '◀️'))).toBe(true);
    expect(await t.modmail.onPage(t.reaction(listId, '◀️'))).toBe(true);
    expect(t.edits.at(-1)).toContain('Page 3 of 3');

    await t.modmail.handle(t.message('15'));
    expect(t.opened).toEqual([{ guildId: guildId(15), subject: 'help' }]);
    expect(t.modmail.picking(userId)).toBe(false);
  });

  it('picks by part of the name and narrows the list when several match', async () => {
    const t = setup(3);
    t.join(1, 2, 3);
    const garden = t.guilds.get(guildId(2));
    if (garden) garden.name = 'Garden Friends';
    const club = t.guilds.get(guildId(3));
    if (club) club.name = 'Garden Club';
    await t.modmail.handle(t.message('hi'));

    await t.modmail.handle(t.message('garden'));
    const narrowed = t.replies.at(-1) ?? '';
    expect(narrowed).toContain('`1` **Garden Club**');
    expect(narrowed).toContain('`2` **Garden Friends**');
    expect(narrowed).not.toContain('Community');

    await t.modmail.handle(t.message('nothing like this'));
    expect(t.replies.at(-1)).toContain('No community in the list matches');
    expect(t.opened).toEqual([]);

    await t.modmail.handle(t.message('friends'));
    expect(t.opened).toEqual([{ guildId: guildId(2), subject: 'hi' }]);
  });

  it('puts the last used community at the top', async () => {
    const t = setup(3, {
      targets: [{ guildId: guildId(3), usedAt: new Date(), pinnedUntil: null }],
    });
    t.join(1, 2, 3);
    await t.modmail.handle(t.message('hi'));
    expect(t.replies.at(-1)).toContain('`1` **Community 003**');
  });

  it('goes straight to a community picked with the command', async () => {
    const t = setup(3, {
      targets: [{ guildId: guildId(2), usedAt: new Date(), pinnedUntil: new Date(2_000_000) }],
    });
    t.join(1, 2, 3);
    await t.modmail.handle(t.message('about the ban'));
    expect(t.opened).toEqual([{ guildId: guildId(2), subject: 'about the ban' }]);
    expect(t.replies.some((reply) => reply.includes('Which community'))).toBe(false);
  });

  it('ignores a pin that ran out', async () => {
    const t = setup(3, {
      targets: [{ guildId: guildId(2), usedAt: new Date(), pinnedUntil: new Date(10) }],
    });
    t.join(1, 2);
    await t.modmail.handle(t.message('hi'));
    expect(t.opened).toEqual([]);
    expect(t.replies.at(-1)).toContain('Which community');
  });

  it('says the list ran out and sends a fresh one', async () => {
    const t = setup(3);
    t.join(1, 2);
    await t.modmail.handle(t.message('first words'));
    expect(t.modmail.picking(userId)).toBe(true);
    t.clock.t += PICK_MS + 1;
    expect(t.modmail.picking(userId)).toBe(false);

    await t.modmail.handle(t.message('2'));
    expect(t.opened).toEqual([]);
    expect(t.replies.at(-2)).toContain('ran out after 5 minutes');
    expect(t.replies.at(-1)).toContain('Which community');

    await t.modmail.handle(t.message('2'));
    expect(t.opened).toEqual([{ guildId: guildId(2), subject: 'first words' }]);
  });

  it('refuses a community that turned modmail off after the list went out', async () => {
    const t = setup(3);
    t.join(1, 2, 3);
    await t.modmail.handle(t.message('hi'));
    const second = t.guilds.get(guildId(2));
    if (second) second.modmail = false;
    await t.modmail.handle(t.message('2'));
    expect(t.opened).toEqual([]);
    expect(t.replies.at(-1)).toContain("can't take your message");
    expect(t.modmail.picking(userId)).toBe(true);
  });

  it('refuses a community Maxwell left after the list went out', async () => {
    const t = setup(2);
    t.join(1, 2);
    await t.modmail.handle(t.message('hi'));
    t.present.delete(guildId(1));
    await t.modmail.handle(t.message('1'));
    expect(t.opened).toEqual([]);
    expect(t.replies.at(-1)).toContain("can't take your message");
    await t.modmail.handle(t.message('community 002'));
    expect(t.opened).toEqual([{ guildId: guildId(2), subject: 'hi' }]);
  });

  it('refuses a community the person left after the list went out', async () => {
    const t = setup(2);
    t.join(1, 2);
    await t.modmail.handle(t.message('hi'));
    const first = t.guilds.get(guildId(1));
    if (first) first.member = false;
    await t.modmail.handle(t.message('1'));
    expect(t.opened).toEqual([]);
    expect(t.replies.at(-1)).toContain("can't take your message");
  });

  it('asks to try later when membership checks fail', async () => {
    const t = setup(4);
    for (const guild of t.guilds.values()) guild.member = null;
    await t.modmail.handle(t.message('hi'));
    expect(t.opened).toEqual([]);
    expect(t.replies.at(-1)).toContain('Try again in a minute');
  });

  it('keeps going with the communities it could check', async () => {
    const t = setup(4);
    t.join(2);
    const broken = t.guilds.get(guildId(3));
    if (broken) broken.member = null;
    await t.modmail.handle(t.message('hi'));
    expect(t.opened).toEqual([{ guildId: guildId(2), subject: 'hi' }]);
  });

  it('stays quiet when nobody takes modmail', async () => {
    const t = setup(3);
    await t.modmail.handle(t.message('hi'));
    expect(t.replies).toEqual([]);
    expect(t.opened).toEqual([]);
  });

  it('sends DMs to an open modmail first', async () => {
    const t = setup(2);
    t.join(1, 2);
    t.store.openModmail.mockResolvedValueOnce([{ id: 't9', guildId: guildId(1), channelId: 'c9' }]);
    await t.modmail.handle(t.message('more details'));
    expect(t.service.relayFromMember).toHaveBeenCalledOnce();
    expect(t.opened).toEqual([]);
  });

  it('writes the list in German when every community uses German', async () => {
    const t = setup(2);
    t.join(1, 2);
    for (const guild of t.guilds.values()) guild.language = 'de';
    await t.modmail.handle(t.message('hallo'));
    expect(t.replies.at(-1)).toContain('Für welche Community');
  });

  it('falls back to English when the languages differ', async () => {
    const t = setup(2);
    t.join(1, 2);
    const first = t.guilds.get(guildId(1));
    if (first) first.language = 'de';
    await t.modmail.handle(t.message('hallo'));
    expect(t.replies.at(-1)).toContain('Which community');
  });

  it('ignores page reactions on other messages and after the list ran out', async () => {
    const t = setup(PAGE_SIZE + 2);
    t.join(...Array.from({ length: PAGE_SIZE + 2 }, (_, i) => i + 1));
    await t.modmail.handle(t.message('hi'));
    const listId = t.lastListId();
    expect(await t.modmail.onPage(t.reaction('123', '▶️'))).toBe(false);
    t.clock.t += PICK_MS + 1;
    expect(await t.modmail.onPage(t.reaction(listId, '▶️'))).toBe(false);
  });
});
