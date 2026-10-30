import type { LevelStore } from '@maxwell/core/stores/levels';
import { describe, expect, it } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { withLanguage } from '../../src/i18n/language.js';
import type { BackgroundSource } from '../../src/modules/levels/background.js';
import type { CardPager } from '../../src/modules/levels/board.js';
import { levelCommands } from '../../src/modules/levels/commands.js';
import type { LevelTracker } from '../../src/modules/levels/tracker.js';

const guildId = '900000000000000002';
const lena = '300000000000000002';

function setup() {
  const hidden = new Set<string>();
  const replies: unknown[] = [];
  const store = {
    async setPublicHidden(guild: string, userId: string, hide: boolean) {
      const key = `${guild}:${userId}`;
      const had = hidden.has(key);
      if (hide) hidden.add(key);
      else hidden.delete(key);
      return had !== hide;
    },
  } as unknown as LevelStore;
  const commands = levelCommands(
    {} as Parameters<typeof levelCommands>[0],
    store,
    {} as LevelTracker,
    {} as CardPager,
    {} as BackgroundSource,
  );
  const rank = commands.find((command) => command.name === 'rank');
  const sub = (name: string) => rank?.subcommands?.find((command) => command.name === name);
  const cmd = {
    guildId,
    seed: 1,
    message: { author: { id: lena } },
    services: { voice: { done: (text: string) => `done:${text}` } },
    reply: async (message: unknown) => {
      replies.push(message);
      return '1';
    },
  } as unknown as GuildContext;
  return { rank, sub, cmd, replies, hidden };
}

describe('rank hide and show', () => {
  it('keeps the bare rank command and adds hide and show', () => {
    const { rank, sub } = setup();
    expect(rank?.run).toBeTypeOf('function');
    expect(sub('hide')?.permissions).toBeUndefined();
    expect(sub('show')?.permissions).toBeUndefined();
  });

  it('hides the author and says so', async () => {
    const { sub, cmd, replies, hidden } = setup();
    await sub('hide')?.run?.(cmd);
    expect(hidden.has(`${guildId}:${lena}`)).toBe(true);
    expect(String(replies[0])).toContain('off the public community page');
  });

  it('answers quietly when nothing changes', async () => {
    const { sub, cmd, replies } = setup();
    await sub('hide')?.run?.(cmd);
    await sub('hide')?.run?.(cmd);
    expect(replies[1]).toMatchObject({ content: 'You are already off the public community page.' });
    await sub('show')?.run?.(cmd);
    await sub('show')?.run?.(cmd);
    expect(String(replies[2])).toContain('show up on the public community page again');
    expect(replies[3]).toMatchObject({
      content: 'You are not hidden from the public community page.',
    });
  });

  it('answers in German', async () => {
    const { sub, cmd, replies } = setup();
    await withLanguage('de', () => sub('hide')?.run?.(cmd));
    expect(String(replies[0])).toContain('öffentlichen Community-Seite');
  });
});
