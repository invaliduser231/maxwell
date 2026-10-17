import { z } from 'zod';
import { defineModule } from './types.js';

export const cardsConfig = z.object({
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .default(null),
  background: z.enum(['field', 'plain', 'image']).default('field'),
  dim: z.number().min(0).max(0.9).default(0.6),
});

export type CardsConfig = z.infer<typeof cardsConfig>;

export default defineModule({
  key: 'cards',
  name: 'Cards',
  description: 'Colors and backgrounds of the image cards.',
  group: 'settings',
  pole: 'neutral',
  voteLocked: false,
  defaultEnabled: true,
  toggleable: false,
  config: cardsConfig,
  migrations: [],
});
