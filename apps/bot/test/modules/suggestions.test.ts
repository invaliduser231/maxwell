import { suggestionsConfig } from '@maxwell/core/modules/suggestions';
import type { Suggestion } from '@maxwell/core/stores/suggestions';
import { describe, expect, it } from 'vitest';
import { SuggestionBoard, voteEmojis, voteOf } from '../../src/modules/suggestions/board.js';
import { copy, fallbackVotes } from '../../src/modules/suggestions/copy.js';
import { statusColors, suggestionEmbed } from '../../src/modules/suggestions/render.js';
import type { OutgoingMessage, ReactionEvent } from '../../src/platform/types.js';

const suggestion: Suggestion = {
  id: '7',
  number: 7,
  guildId: '1',
  channelId: '2',
  messageId: '3',
  authorId: '4',
  content: 'A channel for pet pictures',
  upEmoji: 'yes:10',
  downEmoji: 'no:11',
  status: 'open',
  reason: null,
  statusBy: null,
  statusAt: null,
  up: 12,
  down: 3,
  createdAt: new Date(0),
};

describe('votes', () => {
  it('uses the configured emoji or the fallback', () => {
    expect(voteEmojis(suggestionsConfig.parse({}))).toEqual(fallbackVotes);
    expect(
      voteEmojis(suggestionsConfig.parse({ upEmoji: '<:yes:10>', downEmoji: 'no:11' })),
    ).toEqual({ up: 'yes:10', down: 'no:11' });
  });

  it('maps reactions to votes', () => {
    expect(voteOf(suggestion, 'yes:10')).toBe(1);
    expect(voteOf(suggestion, 'no:11')).toBe(-1);
    expect(voteOf(suggestion, 'maybe:12')).toBeNull();
  });
});

describe('embed', () => {
  const author = {
    id: '4',
    username: 'lena',
    displayName: 'Lena',
    bot: false,
    avatarUrl: 'https://example.com/a.png',
  };

  it('keeps open suggestions short', () => {
    const embed = suggestionEmbed(suggestion, author);
    expect(embed.title).toBe('Suggestion 7');
    expect(embed.author?.name).toBe('Lena (@lena)');
    expect(embed.color).toBe(statusColors.open);
    expect(embed.description).toContain('**Status** Open');
    expect(embed.description).not.toContain('**Votes**');
  });

  it('shows the reason and votes once decided', () => {
    const embed = suggestionEmbed(
      { ...suggestion, status: 'declined', reason: 'Not this year.' },
      null,
    );
    expect(embed.author).toBeUndefined();
    expect(embed.color).toBe(statusColors.declined);
    expect(embed.description).toContain('**Status** Declined');
    expect(embed.description).toContain('**Reason** Not this year.');
    expect(embed.description).toContain('**Votes** 12 for, 3 against');
  });
});

describe('config', () => {
  it('has a default for every field', () => {
    const config = suggestionsConfig.parse({});
    expect(config.channelId).toBeNull();
    expect(config.cleanup).toBe(true);
    expect(config.notifyAuthor).toBe(true);
    expect(config.thread).toBe(true);
  });
});

describe('threads', () => {
  it('names the thread after the suggestion', () => {
    expect(copy.threadName('7', 'A channel\nfor  pets')).toBe('7: A channel for pets');
    expect(copy.threadName('7', 'x'.repeat(300))).toHaveLength(100);
  });
});

describe('board', () => {
  const author = {
    id: '4',
    username: 'lena',
    displayName: 'Lena',
    bot: false,
    avatarUrl: 'https://example.com/a.png',
  };

  function setup(thread: boolean, failThread = false) {
    const calls: { kind: string; args: unknown[] }[] = [];
    const votes: string[] = [];
    const platform = {
      selfId: '900',
      async channelInGuild() {
        return true;
      },
      async missingBotPermissions() {
        return [];
      },
      async send(channelId: string, message: OutgoingMessage) {
        calls.push({ kind: 'send', args: [channelId, message] });
        return '3';
      },
      async react(...args: unknown[]) {
        calls.push({ kind: 'react', args });
      },
      async unreact(...args: unknown[]) {
        calls.push({ kind: 'unreact', args });
      },
      async edit(...args: unknown[]) {
        calls.push({ kind: 'edit', args });
      },
      async startThread(...args: unknown[]) {
        calls.push({ kind: 'thread', args });
        if (failThread) throw new Error('no thread rights');
        return '99';
      },
    };
    const store = {
      async create(input: { content: string }) {
        return { ...suggestion, messageId: null, content: input.content };
      },
      async attach() {},
      async discard() {},
      async byMessage() {
        return suggestion;
      },
      async vote(_id: string, userId: string) {
        votes.push(userId);
        return { up: 1, down: 0, previous: null };
      },
      async unvote(_id: string, userId: string) {
        votes.push(`-${userId}`);
        return { up: 0, down: 0, previous: 1 };
      },
    };
    const warnings: string[] = [];
    const ctx = {
      config: async () => suggestionsConfig.parse({ channelId: '2', thread }),
      services: {
        platform,
        log: { warn: (_: unknown, message: string) => warnings.push(message) },
      },
    };
    const board = new SuggestionBoard(ctx as never, store as never);
    return { board, calls, votes, warnings };
  }

  it('opens a thread on the new suggestion by default', async () => {
    const { board, calls } = setup(true);
    const result = await board.post('1', author, 'A channel for pet pictures');
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.kind === 'thread')?.args).toEqual([
      '2',
      '3',
      '7: A channel for pet pictures',
    ]);
  });

  it('skips the thread when turned off and survives a failed one', async () => {
    const off = setup(false);
    await off.board.post('1', author, 'Quiet');
    expect(off.calls.some((c) => c.kind === 'thread')).toBe(false);

    const failing = setup(true, true);
    const result = await failing.board.post('1', author, 'Loud');
    expect(result.ok).toBe(true);
    expect(failing.warnings).toEqual(['suggestion thread failed']);
  });

  it('ignores votes from bots', async () => {
    const { board, votes } = setup(true);
    const vote = (bot: boolean): ReactionEvent => ({
      guildId: '1',
      channelId: '2',
      messageId: '3',
      userId: bot ? '77' : '78',
      emoji: 'yes:10',
      bot,
    });
    await board.onReaction(vote(true));
    await board.onReactionRemove(vote(true));
    await board.onReaction(vote(false));
    expect(votes).toEqual(['78']);
  });

  it('removes the author from posted suggestions', async () => {
    const { board, calls } = setup(true);
    await board.anonymise([
      { ...suggestion, authorId: null },
      { ...suggestion, messageId: null },
    ]);
    const edits = calls.filter((c) => c.kind === 'edit');
    expect(edits).toHaveLength(1);
    const message = edits[0]?.args[2] as OutgoingMessage;
    expect(message.embeds?.[0]?.author).toBeUndefined();
    expect(message.embeds?.[0]?.title).toBe('Suggestion 7');
  });
});
