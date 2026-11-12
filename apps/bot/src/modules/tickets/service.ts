import { type Actor, cancel } from '@maxwell/core';
import {
  FORGOTTEN_ID,
  type Ticket,
  type TicketMessageInput,
  type TicketSource,
  TicketStore,
  TRANSCRIPT_LIMIT,
} from '@maxwell/core/stores/tickets';
import { mention } from '../../commands/mentions.js';
import {
  ChannelKind,
  type Embed,
  type IncomingMessage,
  type MessageEdit,
  type MessageRemoval,
  type Outgoing,
  type Overwrite,
  type Permission,
  type ReactionEvent,
  type UserRef,
} from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import type { Services } from '../../services.js';
import { lines, subtext, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { BoundedCache } from './cache.js';
import {
  resolveTarget,
  type TicketsConfig,
  type TicketTarget,
  type ticketsConfig,
} from './config.js';
import { ticketsCopy as copy, ticketsAudit } from './copy.js';
import { displayEmoji, fallbackEmoji, iconReaction, sameEmoji } from './emoji.js';
import { cannedName, cleanChannelName, fillTemplate, ticketChannelName } from './naming.js';
import {
  closeLogEmbed,
  memberRelayEmbed,
  openLogEmbed,
  staffReplyEmbed,
  teamRelayEmbed,
  transcriptEmbeds,
  transcriptUrl,
} from './render.js';

export type TicketsContext = ModuleContext<typeof ticketsConfig>;

const MEMBER_ALLOW: Permission[] = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'AttachFiles',
  'EmbedLinks',
  'AddReactions',
];
const SELF_ALLOW: Permission[] = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'EmbedLinks',
  'AttachFiles',
  'AddReactions',
];
export const OPEN_PERMISSIONS: Permission[] = [
  'ManageChannels',
  'ManageRoles',
  'SendMessages',
  'EmbedLinks',
  'AddReactions',
];
const BACKFILL_PAGES = 50;
const AUDIT_REASON = ticketsAudit.reason;

export interface OpenInput {
  guildId: string;
  target: TicketTarget;
  opener: UserRef;
  source: TicketSource;
  subject?: string | null;
  intro?: string | null;
}

export type OpenResult =
  | { ok: true; ticket: Ticket }
  | { ok: false; reason: 'limit'; existing: Ticket }
  | { ok: false; reason: 'permissions'; missing: Permission[] }
  | { ok: false; reason: 'failed' };

export type DirectTarget = { channelId: string; messageId: string } | 'sent' | null;

const services = new WeakMap<Services, TicketService>();

export function ticketServiceFor(owner: Services): TicketService | null {
  return services.get(owner) ?? null;
}

export class TicketService {
  readonly store: TicketStore;
  readonly #channels = new BoundedCache<string, Ticket | null>(5_000, 5 * 60_000);

  constructor(readonly ctx: TicketsContext) {
    this.store = new TicketStore(ctx.services.sql);
    services.set(ctx.services, this);
  }

  get services(): Services {
    return this.ctx.services;
  }

  closeEmoji(): string {
    return iconReaction(this.services.voice.icons, 'lock', fallbackEmoji.close);
  }

  sentEmoji(): string {
    return iconReaction(this.services.voice.icons, 'ok', fallbackEmoji.sent);
  }

  async ticketForChannel(channelId: string): Promise<Ticket | null> {
    const hit = this.#channels.peek(channelId);
    if (hit) return hit.value;
    const ticket = await this.store.byChannel(channelId);
    this.#channels.set(channelId, ticket);
    return ticket;
  }

  remember(ticket: Ticket): void {
    if (ticket.channelId) this.#channels.set(ticket.channelId, ticket);
  }

  forget(channelId: string): void {
    this.#channels.delete(channelId);
  }

  forgetCached(): void {
    this.#channels.clear();
  }

  async isTeam(guildId: string, userId: string, panelId: string): Promise<boolean> {
    const { platform } = this.services;
    const config = await this.ctx.config(guildId);
    const roles = resolveTarget(config, panelId)?.teamRoleIds ?? [];
    if (roles.length) {
      const member = await platform.member(guildId, userId);
      if (member?.roles.some((role) => roles.includes(role))) return true;
    }
    return platform.hasPermissions(guildId, userId, null, ['ManageChannels']).catch(() => false);
  }

  async canClose(ticket: Ticket, userId: string): Promise<boolean> {
    if (ticket.openerId === userId && ticket.source !== 'modmail') {
      const config = await this.ctx.config(ticket.guildId);
      const panel = config.panels.find((candidate) => candidate.id === ticket.panelId);
      if (config.openerCanClose && !panel?.teamOnlyClose) return true;
    }
    return this.isTeam(ticket.guildId, userId, ticket.panelId);
  }

  async onControlReaction(reaction: ReactionEvent): Promise<boolean> {
    if (!reaction.guildId) return false;
    const ticket = await this.ticketForChannel(reaction.channelId);
    if (!ticket || ticket.controlMessageId !== reaction.messageId) return false;
    if (ticket.status !== 'open' || !sameEmoji(reaction.emoji, this.closeEmoji())) return true;
    if (!(await this.canClose(ticket, reaction.userId))) {
      await this.services.platform
        .unreact(reaction.channelId, reaction.messageId, reaction.emoji, reaction.userId)
        .catch(() => {});
      return true;
    }
    await this.close(ticket, { id: reaction.userId }, null);
    return true;
  }

  async open(input: OpenInput): Promise<OpenResult> {
    const { platform, log } = this.services;
    const { guildId, target, opener } = input;

    const existing = await this.store.openFor(guildId, opener.id, target.id);
    const first = existing[0];
    if (first && existing.length >= target.maxOpenPerMember) {
      return { ok: false, reason: 'limit', existing: first };
    }

    const missing = await platform
      .missingBotPermissions(guildId, null, OPEN_PERMISSIONS)
      .catch(() => OPEN_PERMISSIONS);
    if (missing.length) return { ok: false, reason: 'permissions', missing };

    const parentId = await this.#category(guildId, target.categoryId);
    const number = await this.store.nextNumber(guildId);
    const name = ticketChannelName(target.channelName, {
      panel: cleanChannelName(target.name) || target.id,
      number,
      user: opener.username,
    });
    const members = input.source === 'modmail' ? [] : [opener.id];

    let channelId: string;
    try {
      channelId = await platform.createChannel(
        guildId,
        {
          name,
          type: ChannelKind.Text,
          parentId,
          topic: copy.ticketTopic(target.name, number, opener.id),
          overwrites: this.#overwrites(guildId, target.teamRoleIds, members),
        },
        AUDIT_REASON,
      );
    } catch (error) {
      log.warn({ err: error, guild: guildId, panel: target.id }, 'ticket channel create failed');
      return { ok: false, reason: 'failed' };
    }

    const ticket = await this.store.insert({
      guildId,
      number,
      panelId: target.id,
      kind: target.kind,
      source: input.source,
      channelId,
      channelName: name,
      openerId: opener.id,
      subject: input.subject ? truncate(input.subject, 200) : null,
    });
    this.remember(ticket);

    await this.#greet(ticket, target, input.intro ?? null).catch((error) =>
      log.warn({ err: error, guild: guildId, ticket: ticket.id }, 'ticket greeting failed'),
    );
    await this.#log(guildId, { embeds: [openLogEmbed(ticket, target.name)] });
    return { ok: true, ticket };
  }

  async #category(guildId: string, categoryId: string | null): Promise<string | null> {
    if (!categoryId) return null;
    const channels = await this.services.platform.channels(guildId).catch(() => []);
    const found = channels.find((c) => c.id === categoryId && c.type === ChannelKind.Category);
    if (!found) {
      this.services.log.info({ guild: guildId, category: categoryId }, 'ticket category missing');
      return null;
    }
    return found.id;
  }

  #overwrites(guildId: string, teamRoleIds: readonly string[], userIds: readonly string[]) {
    const overwrites: Overwrite[] = [
      { id: guildId, type: 'role', allow: [], deny: ['ViewChannel'] },
    ];
    const self = this.services.platform.selfId;
    if (self) overwrites.push({ id: self, type: 'member', allow: SELF_ALLOW, deny: [] });
    for (const roleId of teamRoleIds) {
      overwrites.push({ id: roleId, type: 'role', allow: MEMBER_ALLOW, deny: [] });
    }
    for (const userId of new Set(userIds)) {
      if (userId === self) continue;
      overwrites.push({ id: userId, type: 'member', allow: MEMBER_ALLOW, deny: [] });
    }
    return overwrites;
  }

  async #greet(ticket: Ticket, target: TicketTarget, intro: string | null): Promise<void> {
    const { platform } = this.services;
    if (!ticket.channelId) return;
    const config = await this.ctx.config(ticket.guildId);
    const guild = await platform.guild(ticket.guildId);
    const modmail = ticket.source === 'modmail';
    const pingRoles = target.pingTeam ? target.teamRoleIds : [];
    const close = this.closeEmoji();

    const opening = target.openMessage
      ? fillTemplate(target.openMessage, {
          user: mention.user(ticket.openerId),
          server: guild?.name ?? '',
          number: String(ticket.number),
        })
      : copy.openDefault(target.kind);
    const description = lines(
      opening,
      !modmail && ticket.subject && copy.subject(ticket.subject),
      '',
      subtext(
        modmail
          ? `${copy.internalHint(config.modmail.internalMarker)} ${copy.closeHint(displayEmoji(close))}`
          : copy.closeHint(displayEmoji(close)),
      ),
    );
    const pings = [
      ...(modmail ? [] : [mention.user(ticket.openerId)]),
      ...pingRoles.map((role) => mention.role(role)),
    ].join(' ');

    const embed: Embed = {
      color: palette.north,
      title: copy.ticketTitle(target.name, ticket.number),
      description,
    };
    const messageId = await platform.send(ticket.channelId, {
      content: pings || undefined,
      embeds: [embed],
      mentionUsers: modmail ? [] : [ticket.openerId],
      mentionRoles: pingRoles,
    });
    await platform.react(ticket.channelId, messageId, close).catch(() => {});
    await this.store.setControlMessage(ticket.id, messageId);
    ticket.controlMessageId = messageId;
    await this.recordOwn(ticket, messageId, pings, [embed]);

    if (intro) {
      const introId = await platform.send(ticket.channelId, { content: truncate(intro, 2000) });
      await this.recordOwn(ticket, introId, intro);
    }
  }

  async recordOwn(
    ticket: Ticket,
    messageId: string,
    content: string,
    embeds: readonly Embed[] = [],
  ): Promise<void> {
    const config = await this.ctx.config(ticket.guildId);
    if (!config.transcripts) return;
    await this.store.addMessage(
      ticket.id,
      {
        messageId,
        authorId: this.services.platform.selfId ?? '0',
        authorName: 'Maxwell',
        bot: true,
        content,
        attachments: [],
        embeds: transcriptEmbeds(embeds),
        createdAt: new Date(),
      },
      true,
    );
  }

  async #log(guildId: string, out: Outgoing): Promise<void> {
    const config = await this.ctx.config(guildId);
    if (!config.logChannelId) return;
    if (
      !(await this.services.platform
        .channelInGuild(guildId, config.logChannelId)
        .catch(() => false))
    ) {
      this.services.log.warn({ guild: guildId }, 'ticket log channel unusable');
      return;
    }
    const message = typeof out === 'string' ? { content: out } : out;
    await this.services.platform
      .send(config.logChannelId, { ...message, silent: true })
      .catch((error) =>
        this.services.log.warn({ err: error, guild: guildId }, 'ticket log channel unusable'),
      );
  }

  async log(guildId: string, out: Outgoing): Promise<void> {
    await this.#log(guildId, out);
  }

  #lockedFor(ticket: Ticket): string[] {
    const users = ticket.source === 'modmail' ? [] : [ticket.openerId];
    return [...new Set([...users, ...ticket.members])].filter((id) => id !== FORGOTTEN_ID);
  }

  async close(
    ticket: Ticket,
    actor: Actor,
    reason: string | null,
    options: { idle?: boolean } = {},
  ): Promise<Ticket | null> {
    const { platform, log, voice } = this.services;
    const closed = await this.store.close(ticket.id, actor.id, reason);
    if (!closed) return null;
    this.remember(closed);

    const config = await this.ctx.config(closed.guildId);
    const at = new Date(Date.now() + config.closeDelaySeconds * 1000);

    if (closed.channelId) {
      const channelId = closed.channelId;
      for (const userId of this.#lockedFor(closed)) {
        await platform
          .setOverwrite(
            channelId,
            {
              id: userId,
              type: 'member',
              allow: ['ViewChannel', 'ReadMessageHistory'],
              deny: ['SendMessages', 'AddReactions'],
            },
            AUDIT_REASON,
          )
          .catch((error) => log.warn({ err: error, ticket: closed.id }, 'ticket lock failed'));
      }
      const text = lines(
        `${voice.icon('lock')}${options.idle ? copy.closedIdle : copy.closed(actor.id)}`,
        !options.idle && reason && copy.reason(reason),
        config.deleteOnClose ? copy.goesAway(at) : copy.archived,
      );
      const messageId = await platform.send(channelId, text).catch(() => null);
      if (messageId) await this.recordOwn(closed, messageId, text);
    }

    await this.ctx.record(
      closed.guildId,
      actor,
      'ticket.close',
      ticketsAudit.auditClose(closed.number),
      {
        before: { status: 'open' },
        after: { status: 'closed', reason },
        undo: { kind: 'close', payload: { ticketId: closed.id } },
      },
    );
    await this.ctx.schedule('finish', {
      guildId: closed.guildId,
      payload: { ticketId: closed.id },
      runAt: at,
      dedupeKey: `tickets.finish:${closed.id}`,
    });
    return closed;
  }

  async finish(
    guildId: string,
    ticketId: string,
    rate: (ticket: Ticket, guild: string) => Promise<void>,
  ) {
    const { platform, log, config: env } = this.services;
    const ticket = await this.store.getInGuild(guildId, ticketId);
    if (ticket?.status !== 'closed') return;
    const config = await this.ctx.config(ticket.guildId);
    const guild = await platform.guild(ticket.guildId);

    if (ticket.channelId) {
      const channelId = ticket.channelId;
      if (config.transcripts) {
        await this.backfill(ticket).catch((error) =>
          log.warn({ err: error, ticket: ticket.id }, 'transcript backfill failed'),
        );
      }
      if (config.deleteOnClose) {
        try {
          await platform.deleteChannel(channelId, AUDIT_REASON);
          await this.store.detachChannel(ticket.id);
          this.forget(channelId);
        } catch (error) {
          log.warn({ err: error, ticket: ticket.id }, 'ticket channel delete failed');
        }
      } else {
        for (const userId of this.#lockedFor(ticket)) {
          await platform
            .setOverwrite(
              channelId,
              { id: userId, type: 'member', allow: [], deny: ['ViewChannel'] },
              AUDIT_REASON,
            )
            .catch((error) => log.warn({ err: error, ticket: ticket.id }, 'ticket archive failed'));
        }
      }
    }

    const target = resolveTarget(config, ticket.panelId);
    const messages = config.transcripts ? await this.store.transcriptSize(ticket.id) : 0;
    const url = config.transcripts
      ? transcriptUrl(env.DASHBOARD_URL, ticket.guildId, ticket.id)
      : null;
    await this.#log(ticket.guildId, {
      embeds: [closeLogEmbed(ticket, target?.name ?? ticket.panelId, messages, url)],
    });

    const guildName = guild?.name ?? copy.communityFallback;
    if (ticket.openerId === FORGOTTEN_ID) return;
    if (ticket.source === 'modmail') {
      await this.direct(ticket.openerId, copy.modmailClosed(guildName));
    }
    if (config.ratingEnabled) {
      await rate(ticket, guildName).catch((error) =>
        log.warn({ err: error, ticket: ticket.id }, 'rating request failed'),
      );
    }
  }

  async backfill(ticket: Ticket): Promise<number> {
    if (!ticket.channelId) return 0;
    const { platform } = this.services;
    const known = await this.store.messageIds(ticket.id);
    if (known.size >= TRANSCRIPT_LIMIT) return 0;
    let before: string | undefined;
    let added = 0;
    for (let page = 0; page < BACKFILL_PAGES; page++) {
      const batch = await platform.recentMessages(ticket.channelId, 100, before);
      if (batch.length === 0) break;
      for (const message of batch) {
        if (known.has(message.id)) continue;
        const input = toTranscript(message);
        if (!input) continue;
        if (await this.store.addMessage(ticket.id, input)) added++;
      }
      before = batch.at(-1)?.id;
      if (batch.length < 100 || known.size + added >= TRANSCRIPT_LIMIT) break;
    }
    return added;
  }

  async reopen(ticketId: string, actor: Actor): Promise<Ticket | null> {
    const { platform, log, sql, voice } = this.services;
    const ticket = await this.store.get(ticketId);
    if (ticket?.status !== 'closed') return null;
    await cancel(sql, `tickets.finish:${ticket.id}`);

    const config = await this.ctx.config(ticket.guildId);
    const target = resolveTarget(config, ticket.panelId);
    const teamRoleIds = target?.teamRoleIds ?? [];
    const users = this.#lockedFor(ticket);

    let channelId = ticket.channelId;
    if (
      channelId &&
      !(await platform.channelInGuild(ticket.guildId, channelId).catch(() => false))
    ) {
      channelId = null;
    }

    if (channelId) {
      for (const userId of users) {
        await platform
          .setOverwrite(
            channelId,
            { id: userId, type: 'member', allow: MEMBER_ALLOW, deny: [] },
            AUDIT_REASON,
          )
          .catch((error) => log.warn({ err: error, ticket: ticket.id }, 'ticket unlock failed'));
      }
    } else {
      const parentId = await this.#category(ticket.guildId, target?.categoryId ?? null);
      try {
        channelId = await platform.createChannel(
          ticket.guildId,
          {
            name: ticket.channelName ?? `ticket-${ticket.number}`,
            type: ChannelKind.Text,
            parentId,
            topic: copy.ticketTopic(target?.name ?? ticket.panelId, ticket.number, ticket.openerId),
            overwrites: this.#overwrites(ticket.guildId, teamRoleIds, users),
          },
          AUDIT_REASON,
        );
      } catch (error) {
        log.warn({ err: error, ticket: ticket.id }, 'ticket reopen failed');
        throw error;
      }
    }

    const reopened = await this.store.reopen(ticket.id, channelId);
    if (!reopened?.channelId) return reopened;
    this.remember(reopened);

    const close = this.closeEmoji();
    const text = lines(
      `${voice.icon('ok')}${copy.reopened(actor.id)}`,
      subtext(copy.closeHint(displayEmoji(close))),
    );
    const messageId = await platform
      .send(reopened.channelId, {
        content: lines(ticket.source === 'modmail' ? null : mention.user(ticket.openerId), text),
        mentionUsers: ticket.source === 'modmail' ? [] : [ticket.openerId],
      })
      .catch(() => null);
    if (messageId) {
      await platform.react(reopened.channelId, messageId, close).catch(() => {});
      await this.store.setControlMessage(reopened.id, messageId);
      reopened.controlMessageId = messageId;
      await this.recordOwn(reopened, messageId, text);
    }
    return reopened;
  }

  async claim(ticket: Ticket, userId: string | null, actor: Actor): Promise<string | null> {
    const result = await this.store.claim(ticket.id, userId);
    if (!result) return null;
    this.forget(ticket.channelId ?? '');
    if (ticket.channelId) {
      const text = userId ? copy.claimed(userId) : copy.unclaimed;
      const messageId = await this.services.platform.send(ticket.channelId, text).catch(() => null);
      if (messageId) await this.recordOwn(ticket, messageId, text);
    }
    await this.ctx.record(
      ticket.guildId,
      actor,
      userId ? 'ticket.claim' : 'ticket.unclaim',
      userId ? ticketsAudit.auditClaim(ticket.number) : ticketsAudit.auditUnclaim(ticket.number),
      {
        before: { claimedBy: result.previous },
        after: { claimedBy: userId },
        undo: { kind: 'claim', payload: { ticketId: ticket.id, userId: result.previous } },
      },
    );
    return result.previous;
  }

  async addMember(ticket: Ticket, userId: string, actor: Actor | null): Promise<boolean> {
    if (!ticket.channelId) return false;
    await this.services.platform.setOverwrite(
      ticket.channelId,
      { id: userId, type: 'member', allow: MEMBER_ALLOW, deny: [] },
      AUDIT_REASON,
    );
    const added = await this.store.addMember(ticket.id, userId);
    this.forget(ticket.channelId);
    if (!added) return false;
    if (actor) {
      await this.ctx.record(
        ticket.guildId,
        actor,
        'ticket.member.add',
        ticketsAudit.auditAdd(ticket.number),
        {
          after: { userId },
          undo: { kind: 'member.add', payload: { ticketId: ticket.id, userId } },
        },
      );
    }
    return true;
  }

  async removeMember(ticket: Ticket, userId: string, actor: Actor | null): Promise<boolean> {
    if (!ticket.channelId) return false;
    await this.services.platform.deleteOverwrite(ticket.channelId, userId, AUDIT_REASON);
    const removed = await this.store.removeMember(ticket.id, userId);
    this.forget(ticket.channelId);
    if (!removed) return false;
    if (actor) {
      await this.ctx.record(
        ticket.guildId,
        actor,
        'ticket.member.remove',
        ticketsAudit.auditRemove(ticket.number),
        {
          before: { userId },
          undo: { kind: 'member.remove', payload: { ticketId: ticket.id, userId } },
        },
      );
    }
    return true;
  }

  async rename(ticket: Ticket, name: string, actor: Actor | null): Promise<void> {
    if (!ticket.channelId) return;
    await this.services.platform.editChannel(ticket.channelId, { name }, AUDIT_REASON);
    await this.store.setChannelName(ticket.id, name);
    this.forget(ticket.channelId);
    if (actor) {
      await this.ctx.record(
        ticket.guildId,
        actor,
        'ticket.rename',
        ticketsAudit.auditRename(ticket.number, name),
        {
          before: { name: ticket.channelName },
          after: { name },
          undo: ticket.channelName
            ? { kind: 'rename', payload: { ticketId: ticket.id, name: ticket.channelName } }
            : null,
        },
      );
    }
  }

  async onGuildMessage(message: IncomingMessage): Promise<void> {
    if (!message.guildId || message.fromWebhook) return;
    const ticket = await this.ticketForChannel(message.channelId);
    if (!ticket || ticket.guildId !== message.guildId) return;
    const config = await this.ctx.config(ticket.guildId);

    if (config.transcripts) {
      const input = toTranscript(message);
      if (input) await this.store.addMessage(ticket.id, input);
    }
    if (message.author.bot || ticket.status !== 'open') return;
    await this.store.touch(ticket.id, message.author.id, message.createdAt);

    const canned = cannedName(message.content, config.cannedPrefix);
    if (canned !== null) {
      await this.#canned(ticket, message, config, canned);
      return;
    }
    if (ticket.source === 'modmail') await this.#relayToMember(ticket, message, config);
  }

  async onEdit(edit: MessageEdit): Promise<void> {
    const { message } = edit;
    if (!message.guildId) return;
    const ticket = await this.ticketForChannel(message.channelId);
    if (!ticket) return;
    await this.store.editMessage(
      ticket.id,
      message.id,
      message.content,
      transcriptEmbeds(message.embeds),
    );
  }

  async onRemove(removal: MessageRemoval): Promise<void> {
    if (!removal.guildId) return;
    const ticket = await this.ticketForChannel(removal.channelId);
    if (!ticket) return;
    await this.store.deleteMessage(ticket.id, removal.id);
  }

  async onChannelGone(channelId: string): Promise<void> {
    const ticket = await this.ticketForChannel(channelId);
    if (!ticket) return;
    this.forget(channelId);
    await this.store.markChannelGone(channelId);
  }

  async #canned(
    ticket: Ticket,
    message: IncomingMessage,
    config: TicketsConfig,
    name: string,
  ): Promise<void> {
    const { platform } = this.services;
    if (!(await this.isTeam(ticket.guildId, message.author.id, ticket.panelId))) return;
    const reply = config.cannedReplies.find((candidate) => candidate.name === name);
    if (!reply) {
      await platform.reply(message, {
        content: copy.cannedUnknown(
          config.cannedPrefix,
          config.cannedReplies.map((candidate) => candidate.name),
        ),
        deleteAfter: 8_000,
      });
      return;
    }
    const guild = await platform.guild(ticket.guildId);
    const text = fillTemplate(reply.content, {
      user: mention.user(ticket.openerId),
      staff: mention.user(message.author.id),
      server: guild?.name ?? '',
      number: String(ticket.number),
    });
    await platform.delete(message.channelId, message.id).catch(() => {});
    if (!ticket.channelId) return;
    await platform.send(ticket.channelId, {
      content: text,
      mentionUsers: ticket.source === 'modmail' ? [] : [ticket.openerId],
    });
    if (ticket.source === 'modmail') {
      await this.#deliver(ticket, message, config, text, []);
    }
  }

  async #relayToMember(
    ticket: Ticket,
    message: IncomingMessage,
    config: TicketsConfig,
  ): Promise<void> {
    const content = message.content;
    if (content.startsWith(config.modmail.internalMarker)) return;
    const prefix = await this.services.guilds.prefix(ticket.guildId);
    if (content.toLowerCase().startsWith(prefix.toLowerCase())) return;
    if (!content.trim() && message.attachments.length === 0) return;
    await this.#deliver(ticket, message, config, content, message.attachments);
  }

  async #deliver(
    ticket: Ticket,
    message: IncomingMessage,
    config: TicketsConfig,
    content: string,
    attachments: IncomingMessage['attachments'],
  ): Promise<void> {
    const { platform, voice } = this.services;
    const guild = await platform.guild(ticket.guildId);
    const embed = teamRelayEmbed(
      { name: guild?.name ?? copy.theCommunity, iconUrl: guild?.iconUrl ?? null },
      config.modmail.anonymous ? null : message.author,
      content,
      attachments,
    );
    const delivered = await this.direct(ticket.openerId, { embeds: [embed] });
    if (delivered) {
      await platform.react(message.channelId, message.id, this.sentEmoji()).catch(() => {});
    } else {
      await platform
        .reply(message, `${voice.icon('warn')}${copy.modmailUnreachable}`)
        .catch(() => {});
    }
  }

  async relayFromMember(ticket: Ticket, message: IncomingMessage): Promise<boolean> {
    const { platform, log } = this.services;
    if (!ticket.channelId) return false;
    const config = await this.ctx.config(ticket.guildId);
    let messageId: string;
    try {
      messageId = await platform.send(ticket.channelId, {
        embeds: [
          memberRelayEmbed(message.author, message.content, message.attachments, message.createdAt),
        ],
      });
    } catch (error) {
      log.warn({ err: error, ticket: ticket.id }, 'modmail relay failed');
      return false;
    }
    if (config.transcripts) {
      const input = toTranscript(message);
      if (input) await this.store.addMessage(ticket.id, { ...input, messageId, via: 'dm' }, true);
    }
    await this.store.touch(ticket.id, message.author.id, message.createdAt);
    await platform.react(message.channelId, message.id, this.sentEmoji()).catch(() => {});
    return true;
  }

  async staffReply(ticket: Ticket, staffId: string, content: string): Promise<boolean> {
    const { platform, log, voice } = this.services;
    if (!ticket.channelId || ticket.status !== 'open') return false;
    const config = await this.ctx.config(ticket.guildId);
    const [guild, author] = await Promise.all([
      platform.guild(ticket.guildId),
      platform.user(staffId),
    ]);
    const text = truncate(
      fillTemplate(content, {
        user: mention.user(ticket.openerId),
        staff: mention.user(staffId),
        server: guild?.name ?? '',
        number: String(ticket.number),
      }),
      2000,
    );
    if (!text.trim()) return false;
    const modmail = ticket.source === 'modmail';
    let messageId: string;
    try {
      messageId = await platform.send(ticket.channelId, {
        embeds: [staffReplyEmbed(author, text)],
        mentionUsers: [],
      });
    } catch (error) {
      log.warn({ err: error, ticket: ticket.id }, 'dashboard reply failed');
      return false;
    }
    if (config.transcripts) {
      await this.store.addMessage(
        ticket.id,
        {
          messageId,
          authorId: staffId,
          authorName: author?.displayName ?? 'Team',
          authorAvatar: author?.avatarUrl ?? null,
          bot: false,
          via: 'dashboard',
          content: text,
          attachments: [],
          createdAt: new Date(),
        },
        true,
      );
    }
    await this.store.touch(ticket.id, staffId, new Date());
    if (!modmail) return true;
    const embed = teamRelayEmbed(
      { name: guild?.name ?? copy.theCommunity, iconUrl: guild?.iconUrl ?? null },
      config.modmail.anonymous ? null : author,
      text,
      [],
    );
    if (await this.direct(ticket.openerId, { embeds: [embed] })) return true;
    await platform
      .send(ticket.channelId, `${voice.icon('warn')}${copy.modmailUnreachable}`)
      .catch(() => {});
    return true;
  }

  async dmChannel(userId: string): Promise<string | null> {
    const known = await this.store.dmChannel(userId);
    if (known) return known;
    const opened = await this.services.platform.openDirect(userId).catch(() => null);
    if (opened) await this.store.rememberDm(userId, opened);
    return opened;
  }

  async direct(userId: string, out: Outgoing): Promise<DirectTarget> {
    const { platform } = this.services;
    const channelId = await this.dmChannel(userId);
    if (channelId) {
      try {
        const messageId = await platform.send(channelId, out);
        return { channelId, messageId };
      } catch {}
    }
    return (await platform.sendDirect(userId, out)) ? 'sent' : null;
  }
}

export function toTranscript(message: IncomingMessage): TicketMessageInput | null {
  const embeds = transcriptEmbeds(message.embeds);
  if (!message.content.trim() && message.attachments.length === 0 && embeds.length === 0) {
    return null;
  }
  return {
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.author.displayName,
    authorAvatar: message.author.avatarUrl,
    bot: message.author.bot,
    content: message.content,
    attachments: message.attachments.map((file) => ({
      filename: file.filename,
      url: file.url,
      contentType: file.contentType,
      size: file.size,
    })),
    embeds,
    createdAt: message.createdAt,
  };
}
