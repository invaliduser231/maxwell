import { z } from 'zod';
import { defineModule } from './types.js';

export const languages = ['en', 'de', 'es'] as const;

export type Language = (typeof languages)[number];

const INVITE_CODE = /^[A-Za-z0-9-]{2,64}$/;

const INVITE_LINK =
  /^(?:https?:\/\/)?(?:www\.)?(?:fluxer\.gg|(?:web\.)?fluxer\.app\/invite)\/([A-Za-z0-9-]{2,64})\/?$/i;

export function parseInviteCode(input: string): string | null {
  const value = input.trim();
  if (INVITE_CODE.test(value)) return value;
  return INVITE_LINK.exec(value)?.[1] ?? null;
}

export function inviteLink(code: string): string {
  return `https://fluxer.gg/${code}`;
}

export const PUBLIC_DESCRIPTION_MAX = 300;

export const publicPageConfig = z.object({
  enabled: z.boolean().default(false),
  description: z.string().trim().max(PUBLIC_DESCRIPTION_MAX).default(''),
  invite: z.string().regex(INVITE_CODE).nullable().default(null),
});

export type PublicPageConfig = z.infer<typeof publicPageConfig>;

export const generalConfig = z.object({
  language: z.enum(languages).catch('en'),
  timezone: z.string().min(1).default('UTC'),
  disabledCommands: z.array(z.string()).default([]),
  commandChannels: z.array(z.string()).default([]),
  caseRetentionDays: z.number().int().min(30).nullable().default(730),
  publicPage: publicPageConfig.default({ enabled: false, description: '', invite: null }),
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
  migrations: [
    {
      id: '1-afk',
      up: `
        create table general_afk (
          guild_id bigint not null,
          user_id bigint not null,
          reason text not null default '',
          since timestamptz not null default now(),
          primary key (guild_id, user_id)
        );
      `,
    },
  ],
});
