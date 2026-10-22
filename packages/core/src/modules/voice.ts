import { z } from 'zod';
import { defineModule } from './types.js';

const id = z.string().regex(/^\d{1,21}$/);

export const roomVariables = ['name', 'username', 'n'] as const;

export const voiceLobby = z.object({
  channelId: id,
  categoryId: id.nullable().default(null),
  nameTemplate: z.string().min(1).max(100).default("{name}'s room"),
  userLimit: z.number().int().min(0).max(99).default(0),
});

export type VoiceLobby = z.infer<typeof voiceLobby>;

export const voiceConfig = z.object({
  lobbies: z.array(voiceLobby).max(10).default([]),
  ownerPermissions: z.boolean().default(true),
  transferOnLeave: z.boolean().default(true),
  maxRooms: z.number().int().min(1).max(200).default(50),
});

export type VoiceConfig = z.infer<typeof voiceConfig>;

export default defineModule({
  key: 'voice',
  name: 'Voice rooms',
  description: 'Join to create voice channels.',
  group: 'tools',
  pole: 'south',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: voiceConfig,
  migrations: [
    {
      id: '1-rooms',
      up: `
        create table voice_rooms (
          channel_id bigint primary key,
          guild_id bigint not null,
          lobby_id bigint not null,
          owner_id bigint not null,
          number integer not null default 1,
          members bigint[] not null default '{}',
          locked boolean not null default false,
          created_at timestamptz not null default now()
        );

        create index voice_rooms_guild on voice_rooms (guild_id);
      `,
    },
  ],
});
