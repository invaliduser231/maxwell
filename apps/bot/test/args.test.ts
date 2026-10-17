import { describe, expect, it } from 'vitest';
import { formatArgs, parseArgs } from '../src/commands/args.js';
import { tokenize } from '../src/commands/tokenize.js';

describe('tokenize', () => {
  it('splits on whitespace and keeps the remainder', () => {
    const tokens = tokenize('ban  <@123456789012345678>   spamming links');
    expect(tokens.map((t) => t.value)).toEqual([
      'ban',
      '<@123456789012345678>',
      'spamming',
      'links',
    ]);
    expect(tokens[2]?.rest).toBe('spamming links');
  });

  it('treats quoted text as one token', () => {
    expect(tokenize('say "hello there" now').map((t) => t.value)).toEqual([
      'say',
      'hello there',
      'now',
    ]);
  });

  it('keeps an unterminated quote as a plain word', () => {
    expect(tokenize('say "hello').map((t) => t.value)).toEqual(['say', '"hello']);
  });
});

describe('parseArgs', () => {
  const id = '123456789012345678';

  it('resolves mentions and raw ids', () => {
    const specs = [
      { name: 'user', type: 'user' as const },
      { name: 'channel', type: 'channel' as const },
    ];
    const result = parseArgs(specs, tokenize(`<@!${id}> ${id}`));
    expect(result.ok && result.args.string('user')).toBe(id);
    expect(result.ok && result.args.string('channel')).toBe(id);
  });

  it('fails on a missing required argument', () => {
    const result = parseArgs([{ name: 'user', type: 'user' }], []);
    expect(result.ok).toBe(false);
  });

  it('skips an optional argument that does not match', () => {
    const specs = [
      { name: 'user', type: 'user' as const, optional: true },
      { name: 'reason', type: 'text' as const, optional: true },
    ];
    const result = parseArgs(specs, tokenize('being rude'));
    expect(result.ok && result.args.string('user')).toBeUndefined();
    expect(result.ok && result.args.string('reason')).toBe('being rude');
  });

  it('enforces integer bounds', () => {
    const specs = [{ name: 'count', type: 'integer' as const, min: 1, max: 100 }];
    expect(parseArgs(specs, tokenize('0')).ok).toBe(false);
    expect(parseArgs(specs, tokenize('100')).ok).toBe(true);
    expect(parseArgs(specs, tokenize('1.5')).ok).toBe(false);
  });

  it('parses durations', () => {
    const result = parseArgs([{ name: 'for', type: 'duration' }], tokenize('1h30m'));
    expect(result.ok && result.args.number('for')).toBe(5_400_000);
  });

  it('formats usage', () => {
    expect(
      formatArgs([
        { name: 'member', type: 'user' },
        { name: 'reason', type: 'text', optional: true },
      ]),
    ).toBe('<member> [reason...]');
  });
});
