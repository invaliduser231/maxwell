import {
  type CustomCommand,
  customCommand,
  isRiskyRegex,
  validatePattern,
} from '@maxwell/core/modules/commands';
import { describe, expect, it } from 'vitest';
import { findTrigger, invocation, Matchers } from '../../src/modules/commands/match.js';
import { type ResponseContext, renderResponse } from '../../src/modules/commands/render.js';
import {
  allowed,
  buildResponse,
  cooldownKey,
  planRoles,
  targetOf,
} from '../../src/modules/commands/runner.js';
import type { IncomingMessage } from '../../src/platform/types.js';

const command = (patch: Partial<CustomCommand>): CustomCommand =>
  customCommand.parse({ id: 'c1', ...patch });

const context: ResponseContext = {
  user: { id: '300000000000000001', username: 'lena', displayName: 'Lena' },
  server: { id: '100000000000000001', name: 'Magnets' },
  channel: { id: '200000000000000001', name: 'general' },
  args: 'one two three',
  match: ['hello world', 'world'],
};

const message = (patch: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: '900000000000000001',
  channelId: '200000000000000001',
  guildId: '100000000000000001',
  content: 'hi',
  author: {
    id: '300000000000000001',
    username: 'lena',
    displayName: 'Lena',
    bot: false,
    avatarUrl: '',
  },
  memberRoles: [],
  fromWebhook: false,
  attachments: [],
  mentionUsers: [],
  mentionRoles: [],
  mentionEveryone: false,
  replyTo: null,
  createdAt: new Date(),
  embeds: [],
  ...patch,
});

describe('renderResponse', () => {
  it('fills user, server, channel and args', () => {
    expect(
      renderResponse(
        '{user} {user.mention} {user.name} {server} {channel} {channel.name} {args}',
        context,
      ),
    ).toBe('Lena <@300000000000000001> lena Magnets <#200000000000000001> general one two three');
  });

  it('supports indexed args and regex groups', () => {
    expect(renderResponse('{args.2} {args.9}|{match} {match.1}', context)).toBe(
      'two |hello world world',
    );
  });

  it('picks from random lists, including variables inside', () => {
    expect(renderResponse('{random:hi {user}|hey|yo}', context, () => 0)).toBe('hi Lena');
    expect(renderResponse('{random:hi {user}|hey|yo}', context, () => 0.99)).toBe('yo');
  });

  it('fills the target and falls back to the user', () => {
    const target = { id: '300000000000000002', username: 'max', displayName: 'Max' };
    expect(renderResponse('{target} {target.mention}', { ...context, target })).toBe(
      'Max <@300000000000000002>',
    );
    expect(renderResponse('{target.name}', context)).toBe('lena');
  });

  it('leaves unknown variables alone and does not expand member input', () => {
    const sneaky = { ...context, args: '{user.mention} {random:a|b}' };
    expect(renderResponse('{nope} {args}', sneaky)).toBe('{nope} {user.mention} {random:a|b}');
  });
});

describe('pattern safety', () => {
  it('flags nested quantifiers and backreferences', () => {
    expect(isRiskyRegex('(a+)+')).toBe(true);
    expect(isRiskyRegex('((ab*)c)*')).toBe(true);
    expect(isRiskyRegex('(\\w+\\s?)*$')).toBe(true);
    expect(isRiskyRegex('(a)\\1')).toBe(true);
    expect(isRiskyRegex('^hello\\s+(world|there)$')).toBe(false);
    expect(isRiskyRegex('[(+)]+')).toBe(false);
    expect(isRiskyRegex('(ab)+c+')).toBe(false);
  });

  it('validates each trigger type', () => {
    expect(validatePattern('command', 'rules')).toBeNull();
    expect(validatePattern('command', 'two words')).toBe('name');
    expect(validatePattern('keyword', '')).toBe('empty');
    expect(validatePattern('regex', '(unclosed')).toBe('invalid');
    expect(validatePattern('regex', '(x+)+y')).toBe('unsafe');
    expect(validatePattern('regex', 'x'.repeat(201))).toBe('too_long');
  });
});

describe('matching', () => {
  it('parses an invocation', () => {
    expect(invocation('Rules  please  now')).toEqual({ name: 'rules', args: 'please  now' });
    expect(invocation('   ')).toBeNull();
  });

  it('matches keywords by mode', () => {
    const matchers = new Matchers();
    const word = command({ trigger: 'keyword', pattern: 'cat', mode: 'word' });
    expect(matchers.keyword(word, 'I love my Cat!')).toEqual(['Cat']);
    expect(matchers.keyword(word, 'concatenate')).toBeNull();
    const contains = command({ trigger: 'keyword', pattern: 'cat', mode: 'contains' });
    expect(matchers.keyword(contains, 'concatenate')).toEqual(['cat']);
    const exact = command({ trigger: 'keyword', pattern: 'gm', mode: 'exact' });
    expect(matchers.keyword(exact, ' GM ')).toEqual(['GM']);
    expect(matchers.keyword(exact, 'gm all')).toBeNull();
    const starts = command({
      trigger: 'keyword',
      pattern: 'Hey',
      mode: 'startsWith',
      caseSensitive: true,
    });
    expect(matchers.keyword(starts, 'hey there')).toBeNull();
  });

  it('runs regex triggers with groups', () => {
    const matchers = new Matchers();
    const regex = command({ trigger: 'regex', pattern: 'ticket #(\\d+)' });
    expect(matchers.regex(regex, 'see TICKET #42 please')).toEqual(['TICKET #42', '42']);
    expect(matchers.regex(command({ trigger: 'regex', pattern: '(a+)+$' }), 'aaa')).toBeNull();
  });

  it('stops a catastrophic pattern and blocks it after repeated timeouts', () => {
    let now = 0;
    const matchers = new Matchers(() => now);
    const evil = command({ trigger: 'regex', pattern: '^(a|aa)+$' });
    const input = `${'a'.repeat(60)}b`;
    expect(matchers.regex(evil, input)).toBe('timeout');
    expect(matchers.regex(evil, input)).toBe('timeout');
    expect(matchers.regex(evil, input)).toBe('timeout');
    expect(matchers.blocked(evil)).toBe(true);
    expect(matchers.regex(evil, 'aa')).toBeNull();
    now = 2 * 60 * 60 * 1000;
    expect(matchers.blocked(evil)).toBe(false);
  });

  it('prefers command triggers, then keywords, then regex', () => {
    const matchers = new Matchers();
    const commands = [
      command({ id: 'r', trigger: 'regex', pattern: 'rules' }),
      command({ id: 'k', trigger: 'keyword', pattern: 'rules' }),
      command({ id: 'c', trigger: 'command', pattern: 'Rules' }),
      command({ id: 'off', trigger: 'command', pattern: 'faq', enabled: false }),
    ];
    const found = findTrigger(commands, {
      content: 'm!rules 3',
      invoked: { name: 'rules', args: '3' },
      matchers,
    });
    expect(found?.command.id).toBe('c');
    expect(found?.args).toBe('3');
    expect(
      findTrigger(commands, { content: 'read the rules', invoked: null, matchers })?.command.id,
    ).toBe('k');
    expect(
      findTrigger(commands, {
        content: 'm!faq',
        invoked: { name: 'faq', args: '' },
        matchers,
      }),
    ).toBeNull();
  });
});

describe('execution rules', () => {
  it('limits by channel and role', () => {
    const limited = command({ allowedChannels: ['1'], allowedRoles: ['9'] });
    expect(allowed(limited, message({ channelId: '2' }), [])).toBe('channel');
    expect(allowed(limited, message({ channelId: '1' }), [])).toBe('role');
    expect(allowed(limited, message({ channelId: '1', memberRoles: ['9'] }), [])).toBe('ok');
  });

  it('falls back to the command channels for command triggers only', () => {
    expect(allowed(command({ trigger: 'command' }), message({ channelId: '2' }), ['1'])).toBe(
      'channel',
    );
    expect(allowed(command({ trigger: 'keyword' }), message({ channelId: '2' }), ['1'])).toBe('ok');
  });

  it('scopes cooldowns', () => {
    expect(cooldownKey(command({ cooldownScope: 'user' }), message())).toBe(
      '100000000000000001:c1:300000000000000001',
    );
    expect(cooldownKey(command({ cooldownScope: 'channel' }), message())).toBe(
      '100000000000000001:c1:200000000000000001',
    );
    expect(cooldownKey(command({ cooldownScope: 'guild' }), message())).toBe(
      '100000000000000001:c1:guild',
    );
  });

  it('finds the member a command points at', () => {
    const self = '500000000000000001';
    const other = '300000000000000002';
    expect(targetOf(message({ mentionUsers: [self, other] }), '', self)).toBe(other);
    expect(targetOf(message(), `<@${other}> thanks`, self)).toBe(other);
    expect(targetOf(message(), other, self)).toBe(other);
    expect(targetOf(message(), `<@${self}>`, self)).toBeNull();
    expect(targetOf(message(), 'nobody', self)).toBeNull();
  });

  it('plans only the role changes that do something', () => {
    const plan = planRoles(command({ addRoles: ['1', '2', '3'], removeRoles: ['3', '4'] }), [
      '1',
      '4',
    ]);
    expect(plan).toEqual({ added: ['2'], removed: ['4'] });
  });

  it('builds plain and embed responses', () => {
    const plain = buildResponse(command({ responses: ['', 'Hi {user}'] }), context, () => 0);
    expect(plain).toEqual({ content: 'Hi Lena', mentionUsers: ['300000000000000001'] });
    const embed = buildResponse(
      command({ responses: ['Hi'], embed: true, color: 0x112233 }),
      context,
    );
    expect(embed?.embeds?.[0]).toEqual({ color: 0x112233, description: 'Hi' });
    expect(buildResponse(command({ responses: [] }), context)).toBeNull();
  });
});
