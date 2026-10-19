import { z } from 'zod';
import { defineModule } from './types.js';

export const inviteCampaign = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(60),
});

export type InviteCampaign = z.infer<typeof inviteCampaign>;

export const invitesConfig = z.object({
  logChannelId: z.string().nullable().default(null),
  campaigns: z.array(inviteCampaign).max(200).default([]),
});

export type InvitesConfig = z.infer<typeof invitesConfig>;

export default defineModule({
  key: 'invites',
  name: 'Invites',
  description: 'Who invited whom, and who stayed.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: true,
  toggleable: true,
  config: invitesConfig,
  migrations: [],
});
