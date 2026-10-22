import type { Sql } from '../db/sql.js';

export interface VoiceRoom {
  channelId: string;
  guildId: string;
  lobbyId: string;
  ownerId: string;
  number: number;
  members: string[];
  locked: boolean;
  createdAt: Date;
}

export class VoiceStore {
  constructor(private readonly sql: Sql) {}

  async create(room: Omit<VoiceRoom, 'createdAt' | 'locked'>): Promise<VoiceRoom> {
    const [row] = await this.sql<VoiceRoom[]>`
      insert into voice_rooms (channel_id, guild_id, lobby_id, owner_id, number, members)
      values (
        ${room.channelId}, ${room.guildId}, ${room.lobbyId}, ${room.ownerId}, ${room.number},
        ${this.sql.array(room.members)}::bigint[]
      )
      on conflict (channel_id) do update set owner_id = excluded.owner_id, members = excluded.members
      returning channel_id as "channelId", guild_id as "guildId", lobby_id as "lobbyId",
        owner_id as "ownerId", number, members, locked, created_at as "createdAt"
    `;
    if (!row) throw new Error('voice room insert returned nothing');
    return row;
  }

  async get(channelId: string): Promise<VoiceRoom | null> {
    const [row] = await this.sql<VoiceRoom[]>`
      select channel_id as "channelId", guild_id as "guildId", lobby_id as "lobbyId",
        owner_id as "ownerId", number, members, locked, created_at as "createdAt"
      from voice_rooms where channel_id = ${channelId}
    `;
    return row ?? null;
  }

  async list(guildId: string): Promise<VoiceRoom[]> {
    return this.sql<VoiceRoom[]>`
      select channel_id as "channelId", guild_id as "guildId", lobby_id as "lobbyId",
        owner_id as "ownerId", number, members, locked, created_at as "createdAt"
      from voice_rooms where guild_id = ${guildId}
      order by created_at
    `;
  }

  async listFor(guildIds: readonly string[]): Promise<VoiceRoom[]> {
    if (guildIds.length === 0) return [];
    return this.sql<VoiceRoom[]>`
      select channel_id as "channelId", guild_id as "guildId", lobby_id as "lobbyId",
        owner_id as "ownerId", number, members, locked, created_at as "createdAt"
      from voice_rooms where guild_id = any(${this.sql.array([...guildIds])}::bigint[])
    `;
  }

  async count(guildId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from voice_rooms where guild_id = ${guildId}
    `;
    return row?.count ?? 0;
  }

  async setMembers(channelId: string, members: readonly string[]): Promise<void> {
    await this.sql`
      update voice_rooms set members = ${this.sql.array([...members])}::bigint[]
      where channel_id = ${channelId}
    `;
  }

  async setOwner(channelId: string, ownerId: string): Promise<void> {
    await this.sql`update voice_rooms set owner_id = ${ownerId} where channel_id = ${channelId}`;
  }

  async setLocked(channelId: string, locked: boolean): Promise<void> {
    await this.sql`update voice_rooms set locked = ${locked} where channel_id = ${channelId}`;
  }

  async remove(channelId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from voice_rooms where channel_id = ${channelId} returning channel_id
    `;
    return rows.length > 0;
  }
}
