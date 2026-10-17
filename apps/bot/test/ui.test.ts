import { describe, expect, it } from 'vitest';
import { suggest } from '../src/commands/suggest.js';
import { count, ordinal, plural, snowflakeDate, timestamp } from '../src/ui/format.js';
import { parseIconSet } from '../src/ui/icons.js';
import { embedToMarkdown, flatten } from '../src/ui/markdown.js';
import { Variants } from '../src/ui/variants.js';

describe('format', () => {
  it('formats numbers and plurals', () => {
    expect(count(1204)).toBe('1,204');
    expect(plural(1, 'member')).toBe('1 member');
    expect(plural(12_000, 'member')).toBe('12,000 members');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 102].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '102nd',
    ]);
  });

  it('builds fluxer timestamps', () => {
    expect(timestamp(new Date(1_700_000_000_000), 'R')).toBe('<t:1700000000:R>');
  });

  it('reads the creation time from a snowflake', () => {
    expect(snowflakeDate('1474874137937518680').getUTCFullYear()).toBe(2026);
  });
});

describe('suggest', () => {
  const names = ['invites', 'invite', 'inv', 'help', 'ping', 'prefix'];

  it('finds close matches', () => {
    expect(suggest('invits', names)).toBe('invites');
    expect(suggest('hepl', names)).toBe(null);
    expect(suggest('hlp', names)).toBe('help');
  });

  it('stays quiet for short or distant words', () => {
    expect(suggest('xy', names)).toBeNull();
    expect(suggest('banana', names)).toBeNull();
  });
});

describe('Variants', () => {
  const options = ['Sorted.', 'Done.', 'Saved.'];

  it('mostly picks the main variant', () => {
    const variants = new Variants();
    const picks = Array.from({ length: 400 }, (_, i) =>
      variants.pick('done', options, `seed-${i}`, `scope-${i}`),
    );
    const main = picks.filter((pick) => pick === 'Sorted.').length / picks.length;
    expect(main).toBeGreaterThan(0.6);
    expect(main).toBeLessThan(0.8);
  });

  it('never repeats the same variant twice in a row in one scope', () => {
    const variants = new Variants();
    let last = '';
    for (let i = 0; i < 50; i++) {
      const pick = variants.pick('done', options, `seed-${i}`, 'channel');
      expect(pick).not.toBe(last);
      last = pick;
    }
  });
});

describe('icons', () => {
  it('renders configured icons and skips the rest', () => {
    const icons = parseIconSet('ok=123456789012345678, nope=1, warn=abc');
    expect(icons.inline('ok')).toBe('<:mx_ok:123456789012345678> ');
    expect(icons.inline('warn')).toBe('');
    expect(icons.reaction('ok')).toBe('mx_ok:123456789012345678');
    expect(icons.reaction('happy')).toBeNull();
  });
});

describe('markdown fallback', () => {
  it('turns an embed into readable markdown', () => {
    const text = embedToMarkdown({
      title: 'Top inviters',
      description: '`#1` <@1> **12**',
      fields: [{ name: 'Total', value: '15' }],
      footer: 'Page 1 of 2',
    });
    expect(text).toBe('### Top inviters\n`#1` <@1> **12**\n**Total** 15\n-# Page 1 of 2');
  });

  it('keeps existing content above the embeds', () => {
    const out = flatten({ content: 'Hi', embeds: [{ description: 'Body' }] });
    expect(out.embeds).toBeUndefined();
    expect(out.content).toBe('Hi\n\nBody');
  });
});
