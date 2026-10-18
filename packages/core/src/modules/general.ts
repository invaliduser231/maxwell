import { z } from 'zod';
import { defineModule } from './types.js';

export const languages = ['en', 'de'] as const;

export type Language = (typeof languages)[number];

export const generalConfig = z.object({
  language: z.enum(languages).catch('en'),
  timezone: z.string().min(1).default('UTC'),
  disabledCommands: z.array(z.string()).default([]),
  commandChannels: z.array(z.string()).default([]),
  caseRetentionDays: z.number().int().min(30).nullable().default(null),
});

export type GeneralConfig = z.infer<typeof generalConfig>;

export default defineModule({
  key: 'general',
  name: 'General',
  description: 'Prefix, language, timezone and privacy.',
  group: 'settings',
  pole: 'neutral',
  voteLocked: false,
  defaultEnabled: true,
  toggleable: false,
  config: generalConfig,
  migrations: [],
});
