import {
  defaultReasonTemplates,
  findTemplate,
  moderationConfig,
  parseMemberIds,
  splitMassBan,
} from '@maxwell/core/modules/moderation';
import { describe, expect, it } from 'vitest';
import { expandReason } from '../../src/modules/moderation/templates.js';

const A = '142700000000000001';
const B = '142700000000000002';
const C = '142700000000000003';

describe('reason templates', () => {
  const config = moderationConfig.parse({
    banDeleteMessageDays: 0,
    reasonTemplates: [
      { key: 'Spam', text: 'Spam in public channels', timeoutMinutes: 30, deleteMessages: true },
      { key: 'rude', text: 'Rude to other members' },
    ],
  });

  it('gives new communities a few defaults', () => {
    expect(moderationConfig.parse({}).reasonTemplates).toEqual(defaultReasonTemplates);
  });

  it('normalizes keys and rejects duplicates', () => {
    expect(config.reasonTemplates[0]?.key).toBe('spam');
    expect(config.reasonTemplates[1]).toMatchObject({
      timeoutMinutes: null,
      deleteMessages: false,
    });
    const doubled = moderationConfig.safeParse({
      reasonTemplates: [
        { key: 'spam', text: 'One' },
        { key: 'SPAM', text: 'Two' },
      ],
    });
    expect(doubled.success).toBe(false);
    expect(
      moderationConfig.safeParse({ reasonTemplates: [{ key: 'two words', text: 'x' }] }).success,
    ).toBe(false);
  });

  it('matches only the exact key', () => {
    expect(findTemplate(config.reasonTemplates, ' SPAM ')?.text).toBe('Spam in public channels');
    expect(findTemplate(config.reasonTemplates, 'spam links')).toBeNull();
    expect(findTemplate(config.reasonTemplates, null)).toBeNull();
  });

  it('expands a timeout with the template length', () => {
    expect(expandReason(config, 'timeout', 'spam', null)).toMatchObject({
      reason: 'Spam in public channels',
      durationMs: 30 * 60_000,
      deleteMessageSeconds: null,
    });
  });

  it('keeps a length given in the command', () => {
    expect(expandReason(config, 'timeout', 'spam', 5 * 60_000).durationMs).toBe(5 * 60_000);
  });

  it('deletes messages on a ban but keeps the ban permanent', () => {
    expect(expandReason(config, 'ban', 'spam', null)).toMatchObject({
      reason: 'Spam in public channels',
      durationMs: null,
      deleteMessageSeconds: 86_400,
    });
    const longer = { ...config, banDeleteMessageDays: 7 };
    expect(expandReason(longer, 'ban', 'spam', null).deleteMessageSeconds).toBe(7 * 86_400);
    expect(expandReason(config, 'kick', 'spam', null).deleteMessageSeconds).toBeNull();
  });

  it('leaves free text alone', () => {
    expect(expandReason(config, 'warn', 'posted spam twice', null)).toEqual({
      reason: 'posted spam twice',
      durationMs: null,
      deleteMessageSeconds: null,
      template: null,
    });
  });
});

describe('member id lists', () => {
  it('reads ids and mentions separated by lines, spaces and commas', () => {
    expect(parseMemberIds(`${A}\n<@${B}>, <@!${C}>;${A}`)).toEqual({ ids: [A, B, C], invalid: [] });
  });

  it('reports what it could not read', () => {
    expect(parseMemberIds(`${A} hello 123 hello`)).toEqual({ ids: [A], invalid: ['hello', '123'] });
    expect(parseMemberIds('  ')).toEqual({ ids: [], invalid: [] });
  });

  it('splits a command into members and reason', () => {
    expect(splitMassBan(`${A} <@${B}>,${C} raid wave 2`)).toEqual({
      ids: [A, B, C],
      reason: 'raid wave 2',
    });
    expect(splitMassBan(`${A} ${A}`)).toEqual({ ids: [A], reason: null });
    expect(splitMassBan(`spam ${A}`)).toEqual({ ids: [], reason: `spam ${A}` });
  });
});
