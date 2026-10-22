import 'server-only';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  FLUXER_TOKEN: z.string().min(1),
  FLUXER_API: z.url().default('https://api.fluxer.app/v1'),
  FLUXER_CLIENT_ID: z.string().regex(/^\d+$/).optional(),
  FLUXER_CLIENT_SECRET: z.string().min(1).optional(),
  DASHBOARD_URL: z.url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32),
  FLUXERLIST_API_KEY: z.string().optional(),
  FLUXERLIST_BOT_ID: z.string().optional(),
  FLUXERLIST_API_BASE: z.url().default('https://fluxerlist.com'),
  VOTE_URL: z.url().optional(),
  OWNER_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function oauth(): { clientId: string; clientSecret: string } | null {
  const { FLUXER_CLIENT_ID: clientId, FLUXER_CLIENT_SECRET: clientSecret } = env();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
