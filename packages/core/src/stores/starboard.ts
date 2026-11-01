import { openText, sealText } from '../crypto/data.js';
import type { Sql } from '../db/sql.js';

export interface StarboardPost {
  messageId: string;
  guildId: string;
  channelId: string;
  authorId: string;
  postId: string | null;
  postImage: boolean;
  stars: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StarInput {
  messageId: string;
  guildId: string;
  channelId: string;
  authorId: string;
  stars: number;
  content: string;
}

const columns = `message_id as "messageId", guild_id as "guildId", channel_id as "channelId",
  author_id as "authorId", post_id as "postId", post_image as "postImage", stars, content,
  created_at as "createdAt", updated_at as "updatedAt"`;

function openPost(row: StarboardPost): StarboardPost {
  return { ...row, content: openText(row.guildId, row.content) };
}

export class StarboardStore {
  constructor(private readonly sql: Sql) {}

  async get(messageId: string): Promise<StarboardPost | null> {
    const [row] = await this.sql<StarboardPost[]>`
      select ${this.sql.unsafe(columns)} from starboard_posts where message_id = ${messageId}
    `;
    return row ? openPost(row) : null;
  }

  async byPost(postId: string): Promise<StarboardPost | null> {
    const [row] = await this.sql<StarboardPost[]>`
      select ${this.sql.unsafe(columns)} from starboard_posts where post_id = ${postId}
    `;
    return row ? openPost(row) : null;
  }

  async upsert(input: StarInput): Promise<StarboardPost> {
    const [row] = await this.sql<StarboardPost[]>`
      insert into starboard_posts (message_id, guild_id, channel_id, author_id, stars, content)
      values (
        ${input.messageId}, ${input.guildId}, ${input.channelId}, ${input.authorId},
        ${input.stars}, ${sealText(input.guildId, input.content.slice(0, 4000))}
      )
      on conflict (message_id) do update set
        stars = excluded.stars,
        content = excluded.content,
        updated_at = now()
      returning ${this.sql.unsafe(columns)}
    `;
    if (!row) throw new Error('starboard upsert returned nothing');
    return openPost(row);
  }

  async setPost(messageId: string, postId: string | null, image = false): Promise<void> {
    await this.sql`
      update starboard_posts set post_id = ${postId}, post_image = ${postId !== null && image},
        updated_at = now()
      where message_id = ${messageId}
    `;
  }

  async clearPost(postId: string): Promise<boolean> {
    const rows = await this.sql`
      update starboard_posts set post_id = null, post_image = false, updated_at = now()
      where post_id = ${postId}
      returning message_id
    `;
    return rows.length > 0;
  }

  async remove(messageId: string): Promise<StarboardPost | null> {
    const [row] = await this.sql<StarboardPost[]>`
      delete from starboard_posts where message_id = ${messageId}
      returning ${this.sql.unsafe(columns)}
    `;
    return row ? openPost(row) : null;
  }

  async top(
    guildId: string,
    options: { limit?: number; since?: Date; offset?: number } = {},
  ): Promise<StarboardPost[]> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    return this.sql<StarboardPost[]>`
      select ${this.sql.unsafe(columns)} from starboard_posts
      where guild_id = ${guildId} and post_id is not null
        ${options.since ? this.sql`and created_at >= ${options.since}` : this.sql``}
      order by stars desc, created_at desc
      limit ${limit} offset ${offset}
    `.then((rows) => rows.map(openPost));
  }

  async stats(guildId: string): Promise<{ posts: number; stars: number }> {
    const [row] = await this.sql<{ posts: number; stars: number }[]>`
      select count(*)::int as posts, coalesce(sum(stars), 0)::int as stars
      from starboard_posts where guild_id = ${guildId} and post_id is not null
    `;
    return { posts: row?.posts ?? 0, stars: row?.stars ?? 0 };
  }

  async period(
    guildId: string,
    from: Date,
    to: Date | null = null,
  ): Promise<{ posts: number; stars: number }> {
    const [row] = await this.sql<{ posts: number; stars: number }[]>`
      select count(*)::int as posts, coalesce(sum(stars), 0)::int as stars
      from starboard_posts
      where guild_id = ${guildId} and post_id is not null and created_at >= ${from}
        ${to ? this.sql`and created_at < ${to}` : this.sql``}
    `;
    return { posts: row?.posts ?? 0, stars: row?.stars ?? 0 };
  }

  async topChannels(
    guildId: string,
    since: Date | null = null,
    limit = 5,
  ): Promise<{ channelId: string; posts: number; stars: number }[]> {
    return this.sql<{ channelId: string; posts: number; stars: number }[]>`
      select channel_id as "channelId", count(*)::int as posts, sum(stars)::int as stars
      from starboard_posts
      where guild_id = ${guildId} and post_id is not null
        ${since ? this.sql`and created_at >= ${since}` : this.sql``}
      group by channel_id
      order by posts desc, stars desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
  }

  async topAuthors(
    guildId: string,
    limit = 10,
    since: Date | null = null,
  ): Promise<{ authorId: string; posts: number; stars: number }[]> {
    return this.sql<{ authorId: string; posts: number; stars: number }[]>`
      select author_id as "authorId", count(*)::int as posts, sum(stars)::int as stars
      from starboard_posts where guild_id = ${guildId} and post_id is not null
        ${since ? this.sql`and created_at >= ${since}` : this.sql``}
      group by author_id
      order by stars desc, posts desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
  }

  async byAuthor(guildId: string, authorId: string, limit = 500): Promise<StarboardPost[]> {
    return this.sql<StarboardPost[]>`
      select ${this.sql.unsafe(columns)} from starboard_posts
      where guild_id = ${guildId} and author_id = ${authorId}
      order by created_at desc
      limit ${Math.min(Math.max(limit, 1), 5000)}
    `.then((rows) => rows.map(openPost));
  }

  async forgetAuthor(guildId: string, authorId: string): Promise<StarboardPost[]> {
    return this.sql<StarboardPost[]>`
      delete from starboard_posts where guild_id = ${guildId} and author_id = ${authorId}
      returning ${this.sql.unsafe(columns)}
    `.then((rows) => rows.map(openPost));
  }
}
