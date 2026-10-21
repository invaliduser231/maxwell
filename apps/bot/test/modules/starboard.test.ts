import definition, { starboardConfig } from '@maxwell/core/modules/starboard';
import type { StarboardPost, StarboardStore } from '@maxwell/core/stores/starboard';
import { describe, expect, it, vi } from 'vitest';
import { isNsfw, Starboard, watches } from '../../src/modules/starboard/board.js';
import {
  countStars,
  firstImage,
  imageName,
  jumpUrl,
  postEmbed,
} from '../../src/modules/starboard/render.js';
import type { ChannelRef, IncomingMessage } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const guildId = '900000000000000001';
const board = '200000000000000009';
const source = '200000000000000001';
const author = '300000000000000001';
const self = '100000000000000000';

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: '700000000000000001',
    channelId: source,
    guildId,
    content: 'look at this',
    author: { id: author, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: 'a' },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function textChannel(id: string, nsfw = false): ChannelRef {
  return {
    id,
    guildId,
    name: 'x',
    type: 0,
    parentId: null,
    position: 0,
    topic: null,
    nsfw,
    userLimit: null,
    rateLimitPerUser: 0,
    overwrites: [],
  };
}

describe('starboard config', () => {
  it('parses an empty object', () => {
    const config = starboardConfig.parse({});
    expect(config.threshold).toBe(3);
    expect(config.emoji).toBe('⭐');
    expect(config.selfStar).toBe(false);
  });

  it('keeps table names prefixed with the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('starboard_')).toBe(true);
    }
  });
});

describe('counting', () => {
  it('ignores the author and the bot unless self stars count', () => {
    const users = [author, self, '1', '2', '2'];
    expect(countStars(users, author, self, false)).toBe(2);
    expect(countStars(users, author, self, true)).toBe(3);
  });

  it('watches every channel except the board and ignored ones', () => {
    const config = starboardConfig.parse({ channelId: board, ignoredChannelIds: ['5'] });
    expect(watches(config, source)).toBe(true);
    expect(watches(config, board)).toBe(false);
    expect(watches(config, '5')).toBe(false);
    expect(watches(starboardConfig.parse({}), source)).toBe(false);
  });

  it('reads the nsfw flag', () => {
    const channel = textChannel('1');
    expect(isNsfw(channel)).toBe(false);
    expect(isNsfw({ ...channel, nsfw: true })).toBe(true);
    expect(isNsfw(undefined)).toBe(false);
  });
});

describe('post rendering', () => {
  const image = { url: 'https://cdn/x.PNG', filename: 'x.PNG', contentType: null, size: 1 };
  const doc = {
    url: 'https://cdn/a.pdf',
    filename: 'a.pdf',
    contentType: 'application/pdf',
    size: 1,
  };

  it('picks the first image', () => {
    expect(firstImage([doc, image])).toBe(image);
    expect(firstImage([doc])).toBeNull();
    expect(imageName(image)).toBe('starred.png');
  });

  it('links back to the message and lists other files', () => {
    const jump = jumpUrl('https://web.fluxer.app/', guildId, source, '700000000000000001');
    expect(jump).toBe(`https://web.fluxer.app/channels/${guildId}/${source}/700000000000000001`);
    const embed = postEmbed(message({ attachments: [image, doc] }), jump, image, 'Lenchen');
    expect(embed.author?.name).toBe('Lenchen');
    expect(embed.imageUrl).toBe('attachment://starred.png');
    expect(embed.description).toContain('Attachment: a.pdf');
    expect(embed.description).toContain(`(${jump})`);
    expect(embed.footer).toBe('ID 700000000000000001');
  });
});

describe('Starboard', () => {
  function setup(
    stars: string[],
    existing: Partial<StarboardPost> | null = null,
    found: IncomingMessage | null = message(),
  ) {
    const config = starboardConfig.parse({ channelId: board, threshold: 2 });
    const platform = {
      selfId: self,
      message: vi.fn(async () => found),
      reactionUsers: vi.fn(
        async (_c: string, _m: string, _e: string, limit = 100, after?: string) => {
          const start = after ? stars.indexOf(after) + 1 : 0;
          return stars.slice(start, start + limit);
        },
      ),
      member: async () => null,
      missingBotPermissions: async () => [],
      send: vi.fn(async () => '800000000000000001'),
      edit: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      channels: vi.fn(async () => [] as ChannelRef[]),
    };
    const post = existing
      ? ({
          messageId: '700000000000000001',
          guildId,
          channelId: source,
          authorId: author,
          postId: null,
          postImage: false,
          stars: 0,
          content: 'look at this',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...existing,
        } as StarboardPost)
      : null;
    const store = {
      get: async () => post,
      upsert: vi.fn(async (input: object) => ({ ...post, ...input, postId: post?.postId ?? null })),
      setPost: vi.fn(async () => {}),
      remove: vi.fn(async () => post),
      byAuthor: vi.fn(async () => (post ? [post] : [])),
      forgetAuthor: vi.fn(async () => (post ? [post] : [])),
    };
    const schedule = vi.fn(async () => '1');
    const ctx = {
      config: async () => config,
      enabled: async () => true,
      schedule,
      services: {
        platform,
        config: { FLUXER_WEB_URL: 'https://fluxer.app' },
        log: { warn() {}, info() {}, debug() {}, error() {} },
      },
    } as unknown as ModuleContext<typeof starboardConfig>;
    const job = {
      id: '1',
      kind: 'starboard.sync',
      guildId,
      payload: { channelId: source, messageId: '700000000000000001' },
      runAt: new Date(),
      attempts: 1,
    };
    return {
      starboard: new Starboard(ctx, store as unknown as StarboardStore),
      platform,
      store,
      job,
      schedule,
    };
  }

  it('posts once the threshold is reached without counting the author', async () => {
    const { starboard, platform, store, job } = setup([author, '1', '2']);
    await starboard.sync(job);
    expect(platform.send).toHaveBeenCalledWith(
      board,
      expect.objectContaining({ content: expect.stringContaining('**2**') }),
    );
    expect(store.setPost).toHaveBeenCalledWith('700000000000000001', '800000000000000001', false);
  });

  it('stays quiet below the threshold', async () => {
    const { starboard, platform, job } = setup([author, '1']);
    await starboard.sync(job);
    expect(platform.send).not.toHaveBeenCalled();
  });

  it('edits only the star line of an existing post', async () => {
    const { starboard, platform, job } = setup(['1', '2', '3'], {
      postId: '800000000000000001',
      postImage: true,
    });
    await starboard.sync(job);
    expect(platform.edit).toHaveBeenCalledWith(board, '800000000000000001', {
      content: expect.stringContaining('**3**'),
    });
    expect(platform.send).not.toHaveBeenCalled();
  });

  it('redraws the embed when the message text changed', async () => {
    const { starboard, platform, job } = setup(['1', '2', '3'], {
      postId: '800000000000000001',
      content: 'older text',
    });
    await starboard.sync(job);
    const edit = (platform.edit.mock.calls[0] as unknown[])[2] as {
      embeds?: { description?: string }[];
      files?: unknown;
    };
    expect(edit.embeds?.[0]?.description).toContain('look at this');
    expect(edit.embeds?.[0]?.description).toContain(
      `https://fluxer.app/channels/${guildId}/${source}/700000000000000001`,
    );
    expect(edit.files).toBeUndefined();
  });

  it('counts stars past the first page', async () => {
    const many = Array.from({ length: 150 }, (_, n) => String(400000000000000000n + BigInt(n)));
    const { starboard, platform, job } = setup(many);
    await starboard.sync(job);
    expect(platform.reactionUsers).toHaveBeenCalledTimes(2);
    expect(platform.send).toHaveBeenCalledWith(
      board,
      expect.objectContaining({ content: expect.stringContaining('**150**') }),
    );
  });

  it('skips nsfw channels', async () => {
    const { starboard, platform, job } = setup(['1', '2', '3']);
    platform.channels.mockResolvedValue([textChannel(source, true)]);
    await starboard.sync(job);
    expect(platform.message).not.toHaveBeenCalled();
    expect(platform.send).not.toHaveBeenCalled();
  });

  it('removes the entry when the message is gone', async () => {
    const { starboard, platform, store, job } = setup(
      ['1', '2'],
      { postId: '800000000000000001' },
      null,
    );
    await starboard.sync(job);
    expect(platform.delete).toHaveBeenCalledWith(board, '800000000000000001', expect.any(String));
    expect(store.remove).toHaveBeenCalledWith('700000000000000001');
  });

  it('ignores reactions from bots', async () => {
    const { starboard, schedule } = setup([]);
    const reaction = {
      guildId,
      channelId: source,
      messageId: '700000000000000001',
      userId: self,
      emoji: '⭐',
      bot: true,
    };
    await starboard.onReaction(reaction);
    expect(schedule).not.toHaveBeenCalled();
    await starboard.onReaction({ ...reaction, bot: false });
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('exports and forgets starred messages', async () => {
    const { starboard, platform, store } = setup([], { postId: '800000000000000001', stars: 4 });
    const privacy = starboard.privacy();
    expect(await privacy.export?.(guildId, author)).toEqual({
      starredMessages: [
        expect.objectContaining({ messageId: '700000000000000001', stars: 4, onBoard: true }),
      ],
    });
    await privacy.forget?.(guildId, author);
    expect(store.forgetAuthor).toHaveBeenCalledWith(guildId, author);
    expect(platform.delete).toHaveBeenCalledWith(board, '800000000000000001', expect.any(String));
  });

  it('removes the post when stars drop below the threshold', async () => {
    const { starboard, platform, store, job } = setup(['1'], { postId: '800000000000000001' });
    await starboard.sync(job);
    expect(platform.delete).toHaveBeenCalledWith(board, '800000000000000001', expect.any(String));
    expect(store.setPost).toHaveBeenCalledWith('700000000000000001', null);
  });
});
