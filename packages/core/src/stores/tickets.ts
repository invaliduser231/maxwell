import { openJson, openText, sealJson, sealText } from '../crypto/data.js';
import type { Sql } from '../db/sql.js';

export type TicketStatus = 'open' | 'closed';
export type TicketSource = 'panel' | 'modmail' | 'command' | 'form' | 'web';

export interface Ticket {
  id: string;
  guildId: string;
  number: number;
  panelId: string;
  kind: string;
  source: TicketSource;
  channelId: string | null;
  channelName: string | null;
  openerId: string;
  subject: string | null;
  members: string[];
  claimedBy: string | null;
  status: TicketStatus;
  controlMessageId: string | null;
  messageCount: number;
  createdAt: Date;
  firstResponseAt: Date | null;
  lastMessageAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  closeReason: string | null;
  rating: number | null;
  ratingRequestedAt: Date | null;
  ratedAt: Date | null;
  ratingChannelId: string | null;
  ratingMessageId: string | null;
}

export interface TicketAttachment {
  filename: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface TicketEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: string;
  fields?: { name: string; value: string }[];
  footer?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  timestamp?: string;
}

export interface TicketMessage {
  ticketId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  bot: boolean;
  via: string | null;
  content: string;
  attachments: TicketAttachment[];
  embeds: TicketEmbed[];
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export type TicketMessageInput = Omit<
  TicketMessage,
  'ticketId' | 'editedAt' | 'deletedAt' | 'via' | 'authorAvatar' | 'embeds'
> & { via?: string | null; authorAvatar?: string | null; embeds?: TicketEmbed[] };

export interface MemberTicketMessage extends TicketMessage {
  ticketNumber: number;
}

export interface MemberTicketForget {
  messages: number;
  tickets: number;
}

export interface ModmailTarget {
  guildId: string;
  usedAt: Date;
  pinnedUntil: Date | null;
}

export const FORGOTTEN_NAME = 'Deleted member';
export const FORGOTTEN_ID = '0';

export interface NewTicket {
  guildId: string;
  number: number;
  panelId: string;
  kind: string;
  source: TicketSource;
  channelId: string;
  channelName: string;
  openerId: string;
  subject: string | null;
}

export interface PublishedPanel {
  guildId: string;
  panelId: string;
  channelId: string;
  messageId: string;
  emoji: string;
  publishedAt: Date;
}

export interface TicketSummary {
  open: number;
  unclaimed: number;
  closedLastWeek: number;
  averageFirstResponseSeconds: number | null;
  averageRating: number | null;
  ratings: number;
}

export interface TicketOverview {
  open: number;
  unclaimed: number;
  closedWeek: number;
  closedWeekModmail: number;
  medianFirstResponseSeconds: number | null;
  ratings: number;
  averageRating: number | null;
  ratingCounts: number[];
}

export const TRANSCRIPT_LIMIT = 5_000;
const RATING_WINDOW_DAYS = 7;

function columns(sql: Sql) {
  return sql`
    id, guild_id as "guildId", number, panel_id as "panelId", kind, source,
    channel_id as "channelId", channel_name as "channelName", opener_id as "openerId", subject,
    members::text[] as members, claimed_by as "claimedBy", status,
    control_message_id as "controlMessageId", message_count as "messageCount",
    created_at as "createdAt", first_response_at as "firstResponseAt",
    last_message_at as "lastMessageAt", closed_at as "closedAt", closed_by as "closedBy",
    close_reason as "closeReason", rating, rating_requested_at as "ratingRequestedAt",
    rated_at as "ratedAt", rating_channel_id as "ratingChannelId",
    rating_message_id as "ratingMessageId"
  `;
}

function messageColumns(sql: Sql) {
  return sql`
    m.ticket_id as "ticketId", m.message_id as "messageId", m.author_id as "authorId",
    m.author_name as "authorName", m.author_avatar as "authorAvatar", m.bot, m.via, m.content,
    m.attachments, m.embeds, m.created_at as "createdAt", m.edited_at as "editedAt",
    m.deleted_at as "deletedAt"
  `;
}

function openTicket(row: Ticket): Ticket {
  return {
    ...row,
    subject: openText(row.guildId, row.subject),
    closeReason: openText(row.guildId, row.closeReason),
  };
}

function openMessage<T extends TicketMessage>(guildId: string, row: T): T {
  return {
    ...row,
    content: openText(guildId, row.content),
    attachments: openJson<TicketAttachment[]>(guildId, row.attachments, []),
    embeds: openJson<TicketEmbed[]>(guildId, row.embeds, []),
  };
}

const GUILD_CACHE_LIMIT = 5_000;

export class TicketStore {
  readonly #guilds = new Map<string, string>();

  constructor(private readonly sql: Sql) {}

  async #guildOf(ticketId: string): Promise<string | null> {
    const known = this.#guilds.get(ticketId);
    if (known) return known;
    const [row] = await this.sql<{ guildId: string }[]>`
      select guild_id::text as "guildId" from tickets_tickets where id = ${ticketId}
    `;
    if (!row) return null;
    if (this.#guilds.size >= GUILD_CACHE_LIMIT) this.#guilds.clear();
    this.#guilds.set(ticketId, row.guildId);
    return row.guildId;
  }

  async nextNumber(guildId: string): Promise<number> {
    const [row] = await this.sql<{ last: number }[]>`
      insert into tickets_counters (guild_id, last) values (${guildId}, 1)
      on conflict (guild_id) do update set last = tickets_counters.last + 1
      returning last
    `;
    return row?.last ?? 1;
  }

  async insert(input: NewTicket): Promise<Ticket> {
    const [row] = await this.sql<Ticket[]>`
      insert into tickets_tickets
        (guild_id, number, panel_id, kind, source, channel_id, channel_name, opener_id, subject)
      values (
        ${input.guildId}, ${input.number}, ${input.panelId}, ${input.kind}, ${input.source},
        ${input.channelId}, ${input.channelName}, ${input.openerId},
        ${sealText(input.guildId, input.subject)}
      )
      returning ${columns(this.sql)}
    `;
    if (!row) throw new Error('ticket insert returned nothing');
    return openTicket(row);
  }

  async get(id: string): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets where id = ${id}
    `;
    return row ? openTicket(row) : null;
  }

  async getInGuild(guildId: string, id: string): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets where guild_id = ${guildId} and id = ${id}
    `;
    return row ? openTicket(row) : null;
  }

  async byNumber(guildId: string, number: number): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ? openTicket(row) : null;
  }

  async byChannel(channelId: string): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where channel_id = ${channelId}
      order by id desc
      limit 1
    `;
    return row ? openTicket(row) : null;
  }

  async openFor(guildId: string, openerId: string, panelId?: string): Promise<Ticket[]> {
    return this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where guild_id = ${guildId} and opener_id = ${openerId} and status = 'open'
        ${panelId ? this.sql`and panel_id = ${panelId}` : this.sql``}
      order by id desc
    `.then((rows) => rows.map(openTicket));
  }

  async openModmail(userId: string): Promise<Ticket[]> {
    return this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where opener_id = ${userId} and status = 'open' and source = 'modmail'
      order by last_message_at desc
    `.then((rows) => rows.map(openTicket));
  }

  async list(
    guildId: string,
    options: { status?: TicketStatus; before?: string; limit?: number; openerId?: string } = {},
  ): Promise<Ticket[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where guild_id = ${guildId}
        ${options.status ? this.sql`and status = ${options.status}` : this.sql``}
        ${options.openerId ? this.sql`and opener_id = ${options.openerId}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${limit}
    `.then((rows) => rows.map(openTicket));
  }

  async summary(guildId: string): Promise<TicketSummary> {
    const [row] = await this.sql<TicketSummary[]>`
      select
        count(*) filter (where status = 'open')::int as open,
        count(*) filter (where status = 'open' and claimed_by is null)::int as unclaimed,
        count(*) filter (where status = 'closed' and closed_at > now() - interval '7 days')::int
          as "closedLastWeek",
        (avg(extract(epoch from first_response_at - created_at))
          filter (where first_response_at is not null and created_at > now() - interval '30 days'))::float8
          as "averageFirstResponseSeconds",
        (avg(rating) filter (where rating is not null))::float8 as "averageRating",
        count(rating)::int as ratings
      from tickets_tickets
      where guild_id = ${guildId}
    `;
    return (
      row ?? {
        open: 0,
        unclaimed: 0,
        closedLastWeek: 0,
        averageFirstResponseSeconds: null,
        averageRating: null,
        ratings: 0,
      }
    );
  }

  async overview(guildId: string, days = 30): Promise<TicketOverview> {
    const [row] = await this.sql<(Omit<TicketOverview, 'ratingCounts'> & { r: number[] })[]>`
      select
        count(*) filter (where status = 'open')::int as open,
        count(*) filter (where status = 'open' and claimed_by is null)::int as unclaimed,
        count(*) filter (where status = 'closed' and closed_at > now() - interval '7 days')::int
          as "closedWeek",
        count(*) filter (
          where status = 'closed' and closed_at > now() - interval '7 days' and source = 'modmail'
        )::int as "closedWeekModmail",
        (percentile_cont(0.5) within group (
          order by extract(epoch from first_response_at - created_at)
        ) filter (
          where first_response_at is not null
            and created_at > now() - make_interval(days => ${days})
        ))::float8 as "medianFirstResponseSeconds",
        count(rating) filter (where rated_at > now() - make_interval(days => ${days}))::int
          as ratings,
        (avg(rating) filter (where rated_at > now() - make_interval(days => ${days})))::float8
          as "averageRating",
        array[
          count(*) filter (where rating = 1 and rated_at > now() - make_interval(days => ${days})),
          count(*) filter (where rating = 2 and rated_at > now() - make_interval(days => ${days})),
          count(*) filter (where rating = 3 and rated_at > now() - make_interval(days => ${days})),
          count(*) filter (where rating = 4 and rated_at > now() - make_interval(days => ${days})),
          count(*) filter (where rating = 5 and rated_at > now() - make_interval(days => ${days}))
        ]::int[] as r
      from tickets_tickets
      where guild_id = ${guildId}
    `;
    if (!row) {
      return {
        open: 0,
        unclaimed: 0,
        closedWeek: 0,
        closedWeekModmail: 0,
        medianFirstResponseSeconds: null,
        ratings: 0,
        averageRating: null,
        ratingCounts: [0, 0, 0, 0, 0],
      };
    }
    const { r, ...rest } = row;
    return { ...rest, ratingCounts: r.map(Number) };
  }

  async recentlyClosed(
    guildId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Ticket[]> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    return this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where guild_id = ${guildId} and status = 'closed'
      order by closed_at desc nulls last, id desc
      limit ${limit} offset ${offset}
    `.then((rows) => rows.map(openTicket));
  }

  async claim(id: string, userId: string | null): Promise<{ previous: string | null } | null> {
    const [row] = await this.sql<{ previous: string | null }[]>`
      update tickets_tickets t set claimed_by = ${userId}
      from (select id, claimed_by as previous from tickets_tickets where id = ${id} for update) old
      where t.id = old.id
      returning old.previous
    `;
    return row ?? null;
  }

  async addMember(id: string, userId: string): Promise<boolean> {
    const rows = await this.sql`
      update tickets_tickets set members = array_append(members, ${userId}::bigint)
      where id = ${id} and not (${userId}::bigint = any(members))
      returning id
    `;
    return rows.length > 0;
  }

  async removeMember(id: string, userId: string): Promise<boolean> {
    const rows = await this.sql`
      update tickets_tickets set members = array_remove(members, ${userId}::bigint)
      where id = ${id} and ${userId}::bigint = any(members)
      returning id
    `;
    return rows.length > 0;
  }

  async setChannelName(id: string, name: string): Promise<void> {
    await this.sql`update tickets_tickets set channel_name = ${name} where id = ${id}`;
  }

  async setControlMessage(id: string, messageId: string): Promise<void> {
    await this.sql`update tickets_tickets set control_message_id = ${messageId} where id = ${id}`;
  }

  async touch(id: string, authorId: string, at: Date): Promise<void> {
    await this.sql`
      update tickets_tickets set
        message_count = message_count + 1,
        last_message_at = greatest(last_message_at, ${at}),
        first_response_at = case
          when first_response_at is null and opener_id <> ${authorId} then ${at}
          else first_response_at
        end
      where id = ${id}
    `;
  }

  async close(id: string, closedBy: string | null, reason: string | null): Promise<Ticket | null> {
    const guildId = await this.#guildOf(id);
    if (!guildId) return null;
    const [row] = await this.sql<Ticket[]>`
      update tickets_tickets set
        status = 'closed', closed_at = now(), closed_by = ${closedBy},
        close_reason = ${sealText(guildId, reason)}
      where id = ${id} and status = 'open'
      returning ${columns(this.sql)}
    `;
    return row ? openTicket(row) : null;
  }

  async reopen(id: string, channelId: string | null): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      update tickets_tickets set
        status = 'open', closed_at = null, closed_by = null, close_reason = null,
        channel_id = coalesce(${channelId}, channel_id), last_message_at = now(),
        rating = null, rating_requested_at = null, rated_at = null,
        rating_channel_id = null, rating_message_id = null
      where id = ${id} and status = 'closed'
      returning ${columns(this.sql)}
    `;
    return row ? openTicket(row) : null;
  }

  async detachChannel(id: string): Promise<void> {
    await this.sql`update tickets_tickets set channel_id = null where id = ${id}`;
  }

  async markChannelGone(channelId: string): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      update tickets_tickets set
        channel_id = null,
        status = 'closed',
        closed_at = coalesce(closed_at, now()),
        close_reason = case when status = 'open' then 'Channel deleted' else close_reason end
      where channel_id = ${channelId}
      returning ${columns(this.sql)}
    `;
    return row ? openTicket(row) : null;
  }

  async autoCloseDue(limit = 50): Promise<Ticket[]> {
    return this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where id in (
        select t.id from tickets_tickets t
        join guild_modules m on m.guild_id = t.guild_id and m.module = 'tickets' and m.enabled is true
        where t.status = 'open'
          and coalesce((m.config ->> 'autoCloseHours')::int, 0) > 0
          and t.last_message_at < now() - make_interval(hours => (m.config ->> 'autoCloseHours')::int)
        order by t.last_message_at
        limit ${limit}
      )
    `.then((rows) => rows.map(openTicket));
  }

  async addMessage(
    ticketId: string,
    input: TicketMessageInput,
    override = false,
  ): Promise<boolean> {
    const guildId = await this.#guildOf(ticketId);
    if (!guildId) return false;
    const content = sealText(guildId, input.content);
    const attachments = this.sql.json(sealJson(guildId, input.attachments) as never);
    const embeds = this.sql.json(sealJson(guildId, input.embeds ?? []) as never);
    const rows = override
      ? await this.sql`
          insert into tickets_messages
            (ticket_id, message_id, author_id, author_name, author_avatar, bot, via, content, attachments, embeds, created_at)
          select ${ticketId}, ${input.messageId}, ${input.authorId}, ${input.authorName},
            ${input.authorAvatar ?? null}, ${input.bot}, ${input.via ?? null}, ${content},
            ${attachments}, ${embeds}, ${input.createdAt}
          where (select count(*) from tickets_messages where ticket_id = ${ticketId}) < ${TRANSCRIPT_LIMIT}
          on conflict (ticket_id, message_id) do update set
            author_id = excluded.author_id, author_name = excluded.author_name,
            author_avatar = excluded.author_avatar, bot = excluded.bot, via = excluded.via,
            content = excluded.content, attachments = excluded.attachments,
            embeds = excluded.embeds
          returning message_id
        `
      : await this.sql`
          insert into tickets_messages
            (ticket_id, message_id, author_id, author_name, author_avatar, bot, via, content, attachments, embeds, created_at)
          select ${ticketId}, ${input.messageId}, ${input.authorId}, ${input.authorName},
            ${input.authorAvatar ?? null}, ${input.bot}, ${input.via ?? null}, ${content},
            ${attachments}, ${embeds}, ${input.createdAt}
          where (select count(*) from tickets_messages where ticket_id = ${ticketId}) < ${TRANSCRIPT_LIMIT}
          on conflict (ticket_id, message_id) do nothing
          returning message_id
        `;
    return rows.length > 0;
  }

  async editMessage(
    ticketId: string,
    messageId: string,
    content: string,
    embeds?: TicketEmbed[],
  ): Promise<void> {
    const guildId = await this.#guildOf(ticketId);
    if (!guildId) return;
    const [current] = await this.sql<{ content: string }[]>`
      select content from tickets_messages
      where ticket_id = ${ticketId} and message_id = ${messageId} and via is null
    `;
    if (!current) return;
    const changed = openText(guildId, current.content) !== content;
    await this.sql`
      update tickets_messages set
        edited_at = case when ${changed} then now() else edited_at end,
        content = ${sealText(guildId, content)}
        ${embeds ? this.sql`, embeds = ${this.sql.json(sealJson(guildId, embeds) as never)}` : this.sql``}
      where ticket_id = ${ticketId} and message_id = ${messageId} and via is null
    `;
  }

  async deleteMessage(ticketId: string, messageId: string): Promise<void> {
    await this.sql`
      update tickets_messages set deleted_at = now()
      where ticket_id = ${ticketId} and message_id = ${messageId} and deleted_at is null
    `;
  }

  async messages(
    ticketId: string,
    options: { after?: string; limit?: number } = {},
  ): Promise<TicketMessage[]> {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), TRANSCRIPT_LIMIT);
    const guildId = await this.#guildOf(ticketId);
    if (!guildId) return [];
    const rows = await this.sql<TicketMessage[]>`
      select ${messageColumns(this.sql)}
      from tickets_messages m
      where m.ticket_id = ${ticketId}
        ${options.after ? this.sql`and m.message_id > ${options.after}` : this.sql``}
      order by m.created_at, m.message_id
      limit ${limit}
    `;
    return rows.map((row) => openMessage(guildId, row));
  }

  async lastMessages(ticketId: string, limit = 40): Promise<TicketMessage[]> {
    const capped = Math.min(Math.max(limit, 1), 500);
    const guildId = await this.#guildOf(ticketId);
    if (!guildId) return [];
    const rows = await this.sql<TicketMessage[]>`
      select ${messageColumns(this.sql)}
      from tickets_messages m
      where m.ticket_id = ${ticketId}
      order by m.created_at desc, m.message_id desc
      limit ${capped}
    `;
    return rows.reverse().map((row) => openMessage(guildId, row));
  }

  async messageIds(ticketId: string): Promise<Set<string>> {
    const rows = await this.sql<{ id: string }[]>`
      select message_id as id from tickets_messages where ticket_id = ${ticketId}
    `;
    return new Set(rows.map((row) => row.id));
  }

  async transcriptSize(ticketId: string): Promise<number> {
    const [row] = await this.sql<{ total: number }[]>`
      select count(*)::int as total from tickets_messages where ticket_id = ${ticketId}
    `;
    return row?.total ?? 0;
  }

  async savePanel(
    guildId: string,
    panelId: string,
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    await this.sql`
      insert into tickets_panels (guild_id, panel_id, channel_id, message_id, emoji)
      values (${guildId}, ${panelId}, ${channelId}, ${messageId}, ${emoji})
      on conflict (guild_id, panel_id) do update set
        channel_id = excluded.channel_id, message_id = excluded.message_id,
        emoji = excluded.emoji, published_at = now()
    `;
  }

  async panel(guildId: string, panelId: string): Promise<PublishedPanel | null> {
    const [row] = await this.sql<PublishedPanel[]>`
      select guild_id as "guildId", panel_id as "panelId", channel_id as "channelId",
        message_id as "messageId", emoji, published_at as "publishedAt"
      from tickets_panels where guild_id = ${guildId} and panel_id = ${panelId}
    `;
    return row ?? null;
  }

  async panels(guildId: string): Promise<PublishedPanel[]> {
    return this.sql<PublishedPanel[]>`
      select guild_id as "guildId", panel_id as "panelId", channel_id as "channelId",
        message_id as "messageId", emoji, published_at as "publishedAt"
      from tickets_panels where guild_id = ${guildId}
      order by published_at
    `;
  }

  async panelByMessage(messageId: string): Promise<PublishedPanel | null> {
    const [row] = await this.sql<PublishedPanel[]>`
      select guild_id as "guildId", panel_id as "panelId", channel_id as "channelId",
        message_id as "messageId", emoji, published_at as "publishedAt"
      from tickets_panels where message_id = ${messageId}
    `;
    return row ?? null;
  }

  async removePanel(guildId: string, panelId: string, messageId?: string): Promise<boolean> {
    const rows = await this.sql`
      delete from tickets_panels
      where guild_id = ${guildId} and panel_id = ${panelId}
        ${messageId ? this.sql`and message_id = ${messageId}` : this.sql``}
      returning panel_id
    `;
    return rows.length > 0;
  }

  async requestRating(
    id: string,
    target: { channelId: string; messageId: string } | null,
  ): Promise<void> {
    await this.sql`
      update tickets_tickets set
        rating_requested_at = now(),
        rating_channel_id = ${target?.channelId ?? null},
        rating_message_id = ${target?.messageId ?? null}
      where id = ${id}
    `;
  }

  async pendingRating(userId: string): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where opener_id = ${userId} and status = 'closed' and rating is null
        and rating_requested_at > now() - make_interval(days => ${RATING_WINDOW_DAYS})
      order by rating_requested_at desc
      limit 1
    `;
    return row ? openTicket(row) : null;
  }

  async ratingByMessage(messageId: string): Promise<Ticket | null> {
    const [row] = await this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets where rating_message_id = ${messageId}
    `;
    return row ? openTicket(row) : null;
  }

  async rate(id: string, rating: number): Promise<boolean> {
    const rows = await this.sql`
      update tickets_tickets set rating = ${rating}, rated_at = now()
      where id = ${id} and rating is null and status = 'closed'
      returning id
    `;
    return rows.length > 0;
  }

  async rememberDm(userId: string, channelId: string): Promise<void> {
    await this.sql`
      insert into tickets_dm_channels (user_id, channel_id) values (${userId}, ${channelId})
      on conflict (user_id) do update set channel_id = excluded.channel_id, seen_at = now()
    `;
  }

  async dmChannel(userId: string): Promise<string | null> {
    const [row] = await this.sql<{ channelId: string }[]>`
      select channel_id as "channelId" from tickets_dm_channels where user_id = ${userId}
    `;
    return row?.channelId ?? null;
  }

  async modmailGuilds(): Promise<string[]> {
    const rows = await this.sql<{ guildId: string }[]>`
      select guild_id as "guildId" from guild_modules
      where module = 'tickets' and enabled is true
        and coalesce((config -> 'modmail' ->> 'enabled')::boolean, false)
    `;
    return rows.map((row) => row.guildId);
  }

  async openedBy(guildId: string, userId: string): Promise<Ticket[]> {
    return this.sql<Ticket[]>`
      select ${columns(this.sql)} from tickets_tickets
      where guild_id = ${guildId} and opener_id = ${userId}
      order by id
    `.then((rows) => rows.map(openTicket));
  }

  async transcripts(ticketIds: readonly string[]): Promise<Map<string, TicketMessage[]>> {
    const grouped = new Map<string, TicketMessage[]>();
    if (ticketIds.length === 0) return grouped;
    const rows = await this.sql<(TicketMessage & { guildId: string })[]>`
      select ${messageColumns(this.sql)}, t.guild_id::text as "guildId"
      from tickets_messages m
      join tickets_tickets t on t.id = m.ticket_id
      where m.ticket_id in ${this.sql(ticketIds as string[])}
      order by m.ticket_id, m.created_at, m.message_id
    `;
    for (const { guildId, ...row } of rows) {
      const list = grouped.get(row.ticketId) ?? [];
      list.push(openMessage(guildId, row));
      grouped.set(row.ticketId, list);
    }
    return grouped;
  }

  async writtenElsewhere(guildId: string, userId: string): Promise<MemberTicketMessage[]> {
    return this.sql<MemberTicketMessage[]>`
      select ${messageColumns(this.sql)}, t.number as "ticketNumber"
      from tickets_messages m
      join tickets_tickets t on t.id = m.ticket_id
      where t.guild_id = ${guildId} and m.author_id = ${userId} and t.opener_id <> ${userId}
      order by m.created_at, m.message_id
    `.then((rows) => rows.map((row) => openMessage(guildId, row)));
  }

  async forgetMember(guildId: string, userId: string): Promise<MemberTicketForget> {
    return this.sql.begin(async (tx) => {
      const messages = await tx`
        update tickets_messages m set
          author_id = ${FORGOTTEN_ID}, author_name = ${FORGOTTEN_NAME}, author_avatar = null
        from tickets_tickets t
        where t.id = m.ticket_id and t.guild_id = ${guildId} and m.author_id = ${userId}
        returning m.message_id
      `;
      const tickets = await tx`
        update tickets_tickets set
          opener_id = case when opener_id = ${userId} then ${FORGOTTEN_ID}::bigint else opener_id end,
          closed_by = case when closed_by = ${userId} then ${FORGOTTEN_ID}::bigint else closed_by end,
          rating_channel_id = case when opener_id = ${userId} then null else rating_channel_id end,
          rating_message_id = case when opener_id = ${userId} then null else rating_message_id end,
          members = array_remove(members, ${userId}::bigint)
        where guild_id = ${guildId} and status = 'closed'
          and (opener_id = ${userId} or ${userId}::bigint = any(members))
        returning id
      `;
      return { messages: messages.length, tickets: tickets.length };
    });
  }

  async forgetDm(userId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from tickets_dm_channels where user_id = ${userId} returning user_id
    `;
    return rows.length > 0;
  }

  async modmailTargets(userId: string): Promise<ModmailTarget[]> {
    return this.sql<ModmailTarget[]>`
      select guild_id::text as "guildId", used_at as "usedAt", pinned_until as "pinnedUntil"
      from tickets_modmail_targets where user_id = ${userId}
      order by used_at desc
    `;
  }

  async useModmailTarget(userId: string, guildId: string): Promise<void> {
    await this.sql`
      insert into tickets_modmail_targets (user_id, guild_id) values (${userId}, ${guildId})
      on conflict (user_id, guild_id) do update set used_at = now(), pinned_until = null
    `;
  }

  async pinModmailTarget(userId: string, guildId: string, until: Date): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        update tickets_modmail_targets set pinned_until = null
        where user_id = ${userId} and guild_id <> ${guildId}
      `;
      await tx`
        insert into tickets_modmail_targets (user_id, guild_id, pinned_until)
        values (${userId}, ${guildId}, ${until})
        on conflict (user_id, guild_id) do update set used_at = now(), pinned_until = excluded.pinned_until
      `;
    });
  }

  async forgetModmailTargets(userId: string, guildId?: string): Promise<void> {
    if (guildId) {
      await this
        .sql`delete from tickets_modmail_targets where user_id = ${userId} and guild_id = ${guildId}`;
      return;
    }
    await this.sql`delete from tickets_modmail_targets where user_id = ${userId}`;
  }

  async purgeGuild(guildId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from tickets_tickets where guild_id = ${guildId}`;
      await tx`delete from tickets_panels where guild_id = ${guildId}`;
      await tx`delete from tickets_counters where guild_id = ${guildId}`;
      await tx`delete from tickets_modmail_targets where guild_id = ${guildId}`;
    });
  }
}
