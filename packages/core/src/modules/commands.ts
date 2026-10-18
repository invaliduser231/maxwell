import { z } from 'zod';
import { defineModule } from './types.js';

export const triggerTypes = ['command', 'keyword', 'regex'] as const;
export const keywordModes = ['word', 'contains', 'exact', 'startsWith'] as const;
export const cooldownScopes = ['user', 'channel', 'guild'] as const;

export type TriggerType = (typeof triggerTypes)[number];
export type KeywordMode = (typeof keywordModes)[number];

export const COMMAND_LIMIT = 100;
export const PATTERN_MAX = 200;
export const COMMAND_NAME = /^[^\s<>@#`]{1,32}$/u;

export const responseVariables = [
  'user',
  'user.mention',
  'user.name',
  'user.id',
  'server',
  'server.id',
  'channel',
  'channel.name',
  'channel.id',
  'args',
  'args.1',
  'match',
  'random:a|b|c',
] as const;

export const customCommand = z.object({
  id: z.string().min(1).max(64),
  trigger: z.enum(triggerTypes).default('command'),
  pattern: z.string().max(PATTERN_MAX).default(''),
  mode: z.enum(keywordModes).default('word'),
  caseSensitive: z.boolean().default(false),
  responses: z.array(z.string().max(2000)).max(20).default([]),
  embed: z.boolean().default(false),
  color: z.number().int().min(0).max(0xffffff).nullable().default(null),
  reply: z.boolean().default(true),
  deleteTrigger: z.boolean().default(false),
  addRoles: z.array(z.string()).max(10).default([]),
  removeRoles: z.array(z.string()).max(10).default([]),
  cooldown: z.number().int().min(0).max(86_400).default(0),
  cooldownScope: z.enum(cooldownScopes).default('user'),
  allowedRoles: z.array(z.string()).max(50).default([]),
  allowedChannels: z.array(z.string()).max(50).default([]),
  enabled: z.boolean().default(true),
});

export type CustomCommand = z.output<typeof customCommand>;

export const commandsConfig = z.object({
  commands: z.array(customCommand).max(COMMAND_LIMIT).default([]),
});

export type CommandsConfig = z.output<typeof commandsConfig>;

export type PatternProblem = 'empty' | 'too_long' | 'invalid' | 'unsafe' | 'name';

const QUANTIFIER = /^(?:[*+]|\{\d+,\d*\})/;

export function isRiskyRegex(source: string): boolean {
  if (/\\[1-9]|\\k</.test(source)) return true;
  const stack: { quantified: boolean }[] = [];
  let quantifiedInside = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '[') {
      const end = findClassEnd(source, i);
      if (end === -1) return false;
      i = end;
      continue;
    }
    if (char === '(') {
      stack.push({ quantified: quantifiedInside });
      quantifiedInside = false;
      continue;
    }
    if (char === ')') {
      const outer = stack.pop();
      const next = source.slice(i + 1);
      const repeated = QUANTIFIER.test(next);
      if (repeated && quantifiedInside) return true;
      quantifiedInside = (outer?.quantified ?? false) || quantifiedInside || repeated;
      continue;
    }
    if (QUANTIFIER.test(source.slice(i))) quantifiedInside = true;
  }
  return false;
}

function findClassEnd(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === ']') return i;
  }
  return -1;
}

export function validatePattern(trigger: TriggerType, pattern: string): PatternProblem | null {
  const value = pattern.trim();
  if (!value) return 'empty';
  if (value.length > PATTERN_MAX) return 'too_long';
  if (trigger === 'command') return COMMAND_NAME.test(value) ? null : 'name';
  if (trigger === 'keyword') return null;
  try {
    new RegExp(value, 'u');
  } catch {
    return 'invalid';
  }
  return isRiskyRegex(value) ? 'unsafe' : null;
}

export default defineModule({
  key: 'commands',
  name: 'Custom commands',
  description: 'Your own commands and auto replies.',
  group: 'tools',
  pole: 'south',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: commandsConfig,
  migrations: [
    {
      id: '1-usage',
      up: `
        create table commands_usage (
          guild_id bigint not null,
          command_id text not null,
          uses integer not null default 0,
          last_used_at timestamptz,
          last_user_id bigint,
          primary key (guild_id, command_id)
        );

        create table commands_tests (
          guild_id bigint not null,
          request_id text not null,
          result jsonb not null,
          created_at timestamptz not null default now(),
          primary key (guild_id, request_id)
        );
      `,
    },
  ],
});
