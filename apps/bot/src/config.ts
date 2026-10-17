import { z } from 'zod';

const idList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  );

const schema = z.object({
  FLUXER_TOKEN: z.string().min(1),
  FLUXER_API: z.url().optional(),
  DATABASE_URL: z.string().min(1),
  DEFAULT_PREFIX: z.string().min(1).max(8).default('m!'),
  OWNER_IDS: idList,
  ICON_EMOJIS: z.string().default(''),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  FLUXERLIST_API_KEY: z.string().optional(),
  FLUXERLIST_BOT_ID: z.string().optional(),
  FLUXERLIST_API_BASE: z.url().default('https://fluxerlist.com'),
  VOTE_URL: z.url().optional(),
  DASHBOARD_URL: z.url().optional(),
  FLUXER_WEB_URL: z.url().default('https://fluxer.app'),
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`invalid configuration\n${problems.join('\n')}`);
  }
  return result.data;
}
