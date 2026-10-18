import { type Actor, cancel } from '@maxwell/core';
import {
  bonusEntry,
  type GiveawaysConfig,
  type giveawaysConfig,
} from '@maxwell/core/modules/giveaways';
import type { Giveaway, GiveawayStore } from '@maxwell/core/stores/giveaways';
import { levelOf } from '@maxwell/core/stores/levels';
import { z } from 'zod';
import { mention } from '../../commands/mentions.js';
import type { MessageRemoval, ReactionEvent } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { copy, fallbackEmoji } from './copy.js';
import {
  claimShopEntries,
  collectReactors,
  type EntryWallet,
  entryWeight,
  pickWinners,
  REACTION_PAGE,
  reactionForm,
  sameEmoji,
  unmet,
} from './draw.js';
import { endedEmbed, runningEmbed } from './render.js';

type Context = ModuleContext<typeof giveawaysConfig>;

const CACHE_LIMIT = 5_000;
const NOTICE_LIMIT = 10_000;
const MINUTE = 60_000;
const START_SLACK = 5_000;
export const MIN_DURATION = MINUTE;
export const MAX_DURATION = 60 * 24 * 60 * MINUTE;

const snowflake = z.string().regex(/^\d{15,21}$/);

export const giveawaySpec = z.object({
  channelId: snowflake,
  prize: z.string().trim().min(1).max(256),
  winners: z.number().int().min(1).max(50).default(1),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  durationSeconds: z
    .number()
    .int()
    .min(MIN_DURATION / 1000)
    .max(MAX_DURATION / 1000)
    .optional(),
  hostId: snowflake.nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  requiredRoleId: snowflake.nullable().optional(),
  excludedRoleId: snowflake.nullable().optional(),
  minLevel: z.number().int().min(0).max(1000).optional(),
  minMemberDays: z.number().int().min(0).max(3650).optional(),
  bonus: z.array(bonusEntry).max(25).optional(),
  pingRoleId: snowflake.nullable().optional(),
  dmWinners: z.boolean().optional(),
});

export type GiveawaySpec = z.infer<typeof giveawaySpec>;

export function endKey(id: string): string {
  return `giveaways.end:${id}`;
}

export function startKey(id: string): string {
  return `giveaways.start:${id}`;
}

export function resolveTimes(
  spec: Pick<GiveawaySpec, 'startsAt' | 'endsAt' | 'durationSeconds'>,
  now = Date.now(),
): { startsAt: Date; endsAt: Date } | null {
  const startsAt = spec.startsAt && spec.startsAt.getTime() > now ? spec.startsAt : new Date(now);
  const endsAt =
    spec.durationSeconds !== undefined
      ? new Date(startsAt.getTime() + spec.durationSeconds * 1000)
      : spec.endsAt;
  if (!endsAt) return null;
  const length = endsAt.getTime() - startsAt.getTime();
  if (length < MIN_DURATION || length > MAX_DURATION) return null;
  return { startsAt, endsAt };
}

class BoundedMap<V> {
  readonly #map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    return this.#map.get(key);
  }

  has(key: string): boolean {
    return this.#map.has(key);
  }

  set(key: string, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.limit) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
  }
}

export class GiveawayRunner {
  readonly #messages = new BoundedMap<string | null>(CACHE_LIMIT);
  readonly #noticed = new BoundedMap<true>(NOTICE_LIMIT);

  constructor(
    private readonly ctx: Context,
    private readonly store: GiveawayStore,
    private readonly wallet: EntryWallet,
  ) {}

  emojiFor(config: GiveawaysConfig): string {
    const custom = config.emoji ? reactionForm(config.emoji) : '';
    return custom || fallbackEmoji;
  }

  async create(
    guildId: string,
    spec: GiveawaySpec,
    hostId: string | null,
  ): Promise<Giveaway | null> {
    const times = resolveTimes(spec);
    if (!times) return null;
    const config = await this.ctx.config(guildId);
    return this.store.create({
      guildId,
      channelId: spec.channelId,
      hostId: spec.hostId ?? hostId,
      prize: spec.prize,
      winners: spec.winners,
      emoji: this.emojiFor(config),
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      description: spec.description?.trim() || null,
      requiredRoleId:
        spec.requiredRoleId !== undefined ? spec.requiredRoleId : config.requiredRoleId,
      excludedRoleId:
        spec.excludedRoleId !== undefined ? spec.excludedRoleId : config.excludedRoleId,
      minLevel: spec.minLevel ?? config.minLevel,
      minMemberDays: spec.minMemberDays ?? config.minMemberDays,
      bonus: spec.bonus ?? config.bonusEntries,
      pingRoleId: spec.pingRoleId !== undefined ? spec.pingRoleId : config.pingRoleId,
      dmWinners: spec.dmWinners ?? config.dmWinners,
    });
  }

  async launch(giveaway: Giveaway): Promise<Giveaway | null> {
    if (giveaway.startsAt.getTime() > Date.now() + START_SLACK) {
      await this.ctx.schedule('start', {
        guildId: giveaway.guildId,
        payload: { giveawayId: giveaway.id },
        runAt: giveaway.startsAt,
        dedupeKey: startKey(giveaway.id),
      });
      return giveaway;
    }
    return this.start(giveaway.id);
  }

  async start(id: string): Promise<Giveaway | null> {
    const { platform, log } = this.ctx.services;
    const giveaway = await this.store.byId(id);
    if (giveaway?.status !== 'scheduled') return null;

    const visible = await platform
      .channelInGuild(giveaway.guildId, giveaway.channelId)
      .catch(() => false);
    const missing = visible
      ? await platform
          .missingBotPermissions(giveaway.guildId, giveaway.channelId, [
            'SendMessages',
            'EmbedLinks',
          ])
          .catch(() => ['SendMessages' as const])
      : [];
    if (!visible || missing.includes('SendMessages')) {
      log.warn({ guild: giveaway.guildId, giveaway: id }, 'giveaway channel unusable, cancelled');
      await this.store.cancel(id);
      return null;
    }

    const ping = giveaway.pingRoleId;
    const messageId = await platform.send(giveaway.channelId, {
      content: ping ? mention.role(ping) : undefined,
      mentionRoles: ping ? [ping] : undefined,
      embeds: [runningEmbed(giveaway)],
    });
    this.#messages.set(messageId, id);
    await this.store.markRunning(id, messageId);
    await platform.react(giveaway.channelId, messageId, giveaway.emoji).catch((error) => {
      log.warn({ err: error, guild: giveaway.guildId, giveaway: id }, 'giveaway reaction failed');
    });
    await this.ctx.schedule('end', {
      guildId: giveaway.guildId,
      payload: { giveawayId: id },
      runAt: giveaway.endsAt,
      dedupeKey: endKey(id),
    });
    return { ...giveaway, status: 'running', messageId };
  }

  async end(id: string): Promise<Giveaway | null> {
    const current = await this.store.byId(id);
    if (current?.status !== 'running') return null;
    await this.#reconcile(current);
    const giveaway = await this.store.finish(id);
    if (!giveaway) return null;
    await cancel(this.ctx.services.sql, endKey(id)).catch(() => false);
    await this.#shopEntries(giveaway);

    const entries = await this.store.entries(id);
    const winners = await pickWinners(entries, giveaway.winners, new Set(), (userId) =>
      this.#present(giveaway.guildId, userId),
    );
    await this.store.addWinners(id, winners, 1);
    await this.#refresh(giveaway, entries.length);
    await this.#announce(
      giveaway,
      winners.length > 0 ? copy.won(winners, giveaway.prize) : copy.nobodyWon(giveaway.prize),
      winners,
    );
    await this.#congratulate(giveaway, winners);
    return giveaway;
  }

  async reroll(giveaway: Giveaway, count: number): Promise<string[]> {
    const [entries, previous, round] = await Promise.all([
      this.store.entries(giveaway.id),
      this.store.winners(giveaway.id),
      this.store.lastRound(giveaway.id),
    ]);
    const exclude = new Set(previous.map((winner) => winner.userId));
    const winners = await pickWinners(entries, count, exclude, (userId) =>
      this.#present(giveaway.guildId, userId),
    );
    if (winners.length === 0) {
      await this.#announce(giveaway, copy.nobodyLeft(giveaway.prize), []);
      return [];
    }
    await this.store.addWinners(giveaway.id, winners, round + 1);
    await this.#refresh(giveaway, entries.length);
    await this.#announce(giveaway, copy.newWinners(winners, giveaway.prize), winners);
    await this.#congratulate(giveaway, winners);
    return winners;
  }

  async cancel(id: string, removeMessage = true): Promise<Giveaway | null> {
    const giveaway = await this.store.cancel(id);
    if (!giveaway) return null;
    const { sql, platform } = this.ctx.services;
    await cancel(sql, endKey(id)).catch(() => false);
    await cancel(sql, startKey(id)).catch(() => false);
    if (removeMessage && giveaway.messageId) {
      await platform.delete(giveaway.channelId, giveaway.messageId).catch(() => {});
    }
    return giveaway;
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    const giveaway = await this.#forReaction(reaction);
    if (!giveaway) return;
    const { platform, sql } = this.ctx.services;
    const member = await platform.member(giveaway.guildId, reaction.userId);
    if (!member || member.user.bot) return;

    const level =
      giveaway.minLevel > 0 ? await levelOf(sql, giveaway.guildId, reaction.userId) : null;
    const reason = unmet(giveaway, member, level);
    if (!reason) {
      await this.store.enter(
        giveaway.id,
        reaction.userId,
        entryWeight(giveaway.bonus, member.roles),
      );
      return;
    }

    await platform
      .unreact(reaction.channelId, reaction.messageId, reaction.emoji, reaction.userId)
      .catch(() => {});
    const key = `${giveaway.id}:${reaction.userId}`;
    if (this.#noticed.has(key)) return;
    this.#noticed.set(key, true);
    const roleId = reason === 'excluded' ? giveaway.excludedRoleId : giveaway.requiredRoleId;
    const role = roleId
      ? (await platform.roles(giveaway.guildId).catch(() => [])).find(
          (entry) => entry.id === roleId,
        )
      : undefined;
    await platform
      .sendDirect(
        reaction.userId,
        copy.unmet(reason, giveaway.prize, {
          role: role?.name ?? null,
          level: giveaway.minLevel,
          days: giveaway.minMemberDays,
        }),
      )
      .catch(() => false);
  }

  async onReactionRemove(reaction: ReactionEvent): Promise<void> {
    const giveaway = await this.#forReaction(reaction);
    if (!giveaway) return;
    await this.store.leave(giveaway.id, reaction.userId);
  }

  async onMessageRemove(removal: MessageRemoval): Promise<Giveaway | null> {
    if (!removal.guildId) return null;
    const giveaway = await this.#byMessage(removal.id);
    if (giveaway?.status !== 'running') return null;
    return this.cancel(giveaway.id, false);
  }

  remember(messageId: string, giveawayId: string): void {
    this.#messages.set(messageId, giveawayId);
  }

  async #byMessage(messageId: string): Promise<Giveaway | null> {
    const cached = this.#messages.get(messageId);
    if (cached === null) return null;
    const giveaway = await this.store.byMessage(messageId);
    this.#messages.set(messageId, giveaway?.id ?? null);
    return giveaway;
  }

  async #forReaction(reaction: ReactionEvent): Promise<Giveaway | null> {
    if (!reaction.guildId || reaction.bot) return null;
    if (reaction.userId === this.ctx.services.platform.selfId) return null;
    const giveaway = await this.#byMessage(reaction.messageId);
    if (giveaway?.status !== 'running') return null;
    if (giveaway.guildId !== reaction.guildId) return null;
    return sameEmoji(giveaway.emoji, reaction.emoji) ? giveaway : null;
  }

  async #reconcile(giveaway: Giveaway): Promise<void> {
    const messageId = giveaway.messageId;
    if (!messageId) return;
    const { platform, sql } = this.ctx.services;
    const [reactors, entries] = await Promise.all([
      collectReactors((after) =>
        platform.reactionUsers(giveaway.channelId, messageId, giveaway.emoji, REACTION_PAGE, after),
      ),
      this.store.entries(giveaway.id),
    ]);
    const reacting = new Set(reactors.users);
    const known = new Set(entries.map((entry) => entry.userId));
    for (const userId of reacting) {
      if (known.has(userId) || userId === platform.selfId) continue;
      const member = await platform.member(giveaway.guildId, userId);
      if (!member || member.user.bot) continue;
      const level = giveaway.minLevel > 0 ? await levelOf(sql, giveaway.guildId, userId) : null;
      if (unmet(giveaway, member, level)) continue;
      await this.store.enter(giveaway.id, userId, entryWeight(giveaway.bonus, member.roles));
    }
    if (!reactors.complete) {
      this.ctx.services.log.warn(
        { guild: giveaway.guildId, giveaway: giveaway.id, seen: reacting.size },
        'giveaway reactions only partly read',
      );
    }
  }

  async #shopEntries(giveaway: Giveaway): Promise<void> {
    const { settings, log } = this.ctx.services;
    try {
      if (!(await settings.enabled(giveaway.guildId, 'economy'))) return;
      const entries = await this.store.entries(giveaway.id);
      const boosted = await claimShopEntries(this.wallet, giveaway.guildId, giveaway.id, entries);
      for (const [userId, weight] of boosted) {
        await this.store.setWeight(giveaway.id, userId, weight);
      }
    } catch (error) {
      log.warn(
        { err: error, guild: giveaway.guildId, giveaway: giveaway.id },
        'shop giveaway entries not counted',
      );
    }
  }

  async #present(guildId: string, userId: string): Promise<boolean> {
    const member = await this.ctx.services.platform.member(guildId, userId);
    return member !== null && !member.user.bot;
  }

  async #refresh(giveaway: Giveaway, entries: number): Promise<void> {
    if (!giveaway.messageId) return;
    const winners = await this.store.winners(giveaway.id);
    await this.ctx.services.platform
      .edit(giveaway.channelId, giveaway.messageId, {
        embeds: [endedEmbed(giveaway, winners, entries)],
      })
      .catch((error) => {
        this.ctx.services.log.warn(
          { err: error, guild: giveaway.guildId, giveaway: giveaway.id },
          'giveaway message could not be updated',
        );
      });
  }

  async #announce(giveaway: Giveaway, text: string, winners: readonly string[]): Promise<void> {
    await this.ctx.services.platform
      .send(giveaway.channelId, { content: text, mentionUsers: [...winners] })
      .catch((error) => {
        this.ctx.services.log.warn(
          { err: error, guild: giveaway.guildId, giveaway: giveaway.id },
          'giveaway result could not be posted',
        );
      });
  }

  async #congratulate(giveaway: Giveaway, winners: readonly string[]): Promise<void> {
    if (winners.length === 0 || !giveaway.dmWinners) return;
    const guild = await this.ctx.services.platform.guild(giveaway.guildId).catch(() => null);
    for (const userId of winners) {
      await this.ctx.services.platform
        .sendDirect(userId, copy.wonDirect(giveaway.prize, guild?.name ?? copy.theCommunity))
        .catch(() => false);
    }
  }
}

export function actorOf(payload: Record<string, unknown>): Actor {
  return { id: typeof payload.by === 'string' && /^\d+$/.test(payload.by) ? payload.by : null };
}
