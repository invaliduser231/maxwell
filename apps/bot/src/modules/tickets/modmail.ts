import type { ModmailTarget } from '@maxwell/core/stores/tickets';
import { inGuild, type Language, languageOf, withLanguage } from '../../i18n/language.js';
import type { IncomingMessage, ReactionEvent } from '../../platform/types.js';
import { truncate } from '../../ui/format.js';
import { BoundedCache } from './cache.js';
import { modmailTarget } from './config.js';
import { ticketsCopy as copy } from './copy.js';
import type { TicketService } from './service.js';

export const PICK_MS = 5 * 60_000;
export const PIN_MS = 30 * 60_000;
export const PAGE_SIZE = 10;
const LAPSE_MS = 60 * 60_000;
const MEMBER_MS = 10 * 60_000;
const CONCURRENCY = 8;
const fallbackArrows = { prev: '◀️', next: '▶️' };

export interface Candidate {
  id: string;
  name: string;
}

interface Pending {
  guilds: Candidate[];
  shown: Candidate[];
  page: number;
  first: IncomingMessage;
  channelId: string;
  listId: string | null;
  language: Language;
  at: number;
}

export function matchCandidates(guilds: readonly Candidate[], query: string): Candidate[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const exact = guilds.filter((guild) => guild.name.toLocaleLowerCase() === needle);
  if (exact.length > 0) return exact;
  return guilds.filter((guild) => guild.name.toLocaleLowerCase().includes(needle));
}

export function orderCandidates(
  guilds: readonly Candidate[],
  targets: readonly ModmailTarget[],
): Candidate[] {
  const rank = new Map(targets.map((target, index) => [target.guildId, index]));
  const position = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...guilds].sort(
    (a, b) => position(a.id) - position(b.id) || a.name.localeCompare(b.name),
  );
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class Modmail {
  readonly #pending = new BoundedCache<string, Pending>(1_000, LAPSE_MS);
  readonly #members = new BoundedCache<string, boolean>(20_000, MEMBER_MS);

  constructor(
    private readonly service: TicketService,
    private readonly now: () => number = Date.now,
  ) {}

  picking(userId: string): boolean {
    const hit = this.#pending.peek(userId, this.now());
    return hit !== undefined && this.now() - hit.value.at <= PICK_MS;
  }

  forget(userId: string): void {
    this.#pending.delete(userId);
  }

  async handle(message: IncomingMessage): Promise<void> {
    const { ctx, store } = this.service;
    const userId = message.author.id;

    for (const ticket of await store.openModmail(userId)) {
      if (!ticket.channelId || !(await ctx.enabled(ticket.guildId))) continue;
      if (await inGuild(ticket.guildId, () => this.service.relayFromMember(ticket, message)))
        return;
    }

    const hit = this.#pending.peek(userId, this.now());
    if (hit) {
      const pending = hit.value;
      if (this.now() - pending.at <= PICK_MS) {
        await withLanguage(pending.language, () => this.#answer(pending, message));
        return;
      }
      this.#pending.delete(userId);
      if (/^\s*\d{1,4}\s*$/.test(message.content)) {
        await this.#start(pending.first, message, true);
        return;
      }
    }
    await this.#start(message, message, false);
  }

  async onPage(reaction: ReactionEvent): Promise<boolean> {
    if (reaction.guildId || reaction.bot) return false;
    const hit = this.#pending.peek(reaction.userId, this.now());
    const pending = hit?.value;
    if (!pending || pending.listId !== reaction.messageId) return false;
    if (this.now() - pending.at > PICK_MS) return false;
    const { prev, next } = this.#arrows();
    const step = reaction.emoji === next ? 1 : reaction.emoji === prev ? -1 : 0;
    if (step === 0) return false;
    const pages = pageCount(pending.shown.length);
    pending.page = (pending.page + step + pages) % pages;
    pending.at = this.now();
    await withLanguage(pending.language, () =>
      this.service.services.platform
        .edit(pending.channelId, reaction.messageId, this.#render(pending))
        .catch(() => {}),
    );
    return true;
  }

  async #start(first: IncomingMessage, latest: IncomingMessage, expired: boolean): Promise<void> {
    const { store, services } = this.service;
    const userId = first.author.id;
    const targets = await store.modmailTargets(userId);

    const pinned = targets.find(
      (target) => target.pinnedUntil && target.pinnedUntil.getTime() > this.now(),
    );
    if (pinned && (await this.#eligible(pinned.guildId, userId))) {
      await this.#open(
        { id: pinned.guildId, name: await this.#name(pinned.guildId) },
        first,
        latest,
      );
      return;
    }

    const { guilds, uncertain } = await this.#candidates(userId);
    const ordered = orderCandidates(guilds, targets);
    const only = ordered[0];
    if (ordered.length === 1 && only) {
      await this.#open(only, first, latest);
      return;
    }

    const language = await this.#languageFor(ordered);
    await withLanguage(language, async () => {
      if (!only) {
        if (uncertain > 0 || expired) {
          await services.platform.reply(latest, copy.modmailTryLater).catch(() => {});
        }
        return;
      }
      const pending: Pending = {
        guilds: ordered,
        shown: ordered,
        page: 0,
        first,
        channelId: latest.channelId,
        listId: null,
        language,
        at: this.now(),
      };
      this.#pending.set(userId, pending, this.now());
      if (expired) await services.platform.reply(latest, copy.modmailExpired).catch(() => {});
      await this.#show(pending, latest);
    });
  }

  async #answer(pending: Pending, message: IncomingMessage): Promise<void> {
    const { platform } = this.service.services;
    const userId = message.author.id;
    const text = message.content.trim();
    if (!text) {
      await this.#show(pending, message);
      return;
    }

    let picked: Candidate | undefined;
    if (/^\d{1,4}$/.test(text)) {
      picked = pending.shown[Number(text) - 1];
    } else {
      const matches = matchCandidates(pending.guilds, text);
      if (matches.length > 1) {
        pending.shown = matches;
        pending.page = 0;
        pending.at = this.now();
        await this.#show(pending, message);
        return;
      }
      picked = matches[0];
    }
    if (!picked) {
      await platform.reply(message, copy.modmailNoMatch(truncate(text, 80))).catch(() => {});
      return;
    }

    if (!(await this.#eligible(picked.id, userId))) {
      const gone = picked.id;
      this.#members.delete(`${gone}:${userId}`);
      pending.guilds = pending.guilds.filter((guild) => guild.id !== gone);
      pending.shown = pending.shown.filter((guild) => guild.id !== gone);
      if (pending.shown.length === 0) pending.shown = pending.guilds;
      pending.page = Math.min(pending.page, pageCount(pending.shown.length) - 1);
      if (pending.guilds.length === 0) this.#pending.delete(userId);
      await platform.reply(message, copy.modmailGone(picked.name)).catch(() => {});
      return;
    }

    this.#pending.delete(userId);
    await this.#open(picked, pending.first, message);
  }

  async #show(pending: Pending, replyTo: IncomingMessage): Promise<void> {
    const { platform } = this.service.services;
    const id = await platform.reply(replyTo, this.#render(pending)).catch(() => null);
    pending.listId = id;
    if (!id || pageCount(pending.shown.length) <= 1) return;
    const { prev, next } = this.#arrows();
    await platform.react(pending.channelId, id, prev).catch(() => {});
    await platform.react(pending.channelId, id, next).catch(() => {});
  }

  #render(pending: Pending): string {
    const pages = pageCount(pending.shown.length);
    const start = pending.page * PAGE_SIZE;
    const entries = pending.shown
      .slice(start, start + PAGE_SIZE)
      .map((guild, index) => ({ number: start + index + 1, name: guild.name }));
    return copy.modmailPick(entries, pending.page + 1, pages);
  }

  #arrows(): { prev: string; next: string } {
    const { icons } = this.service.services.voice;
    return {
      prev: icons.reaction('prev') ?? fallbackArrows.prev,
      next: icons.reaction('next') ?? fallbackArrows.next,
    };
  }

  async #candidates(userId: string): Promise<{ guilds: Candidate[]; uncertain: number }> {
    const { platform } = this.service.services;
    const { ctx, store } = this.service;
    const present = new Set(platform.guildIds());
    const ids = (await store.modmailGuilds()).filter((id) => present.has(id));
    let uncertain = 0;
    const found = await mapLimited(ids, CONCURRENCY, async (guildId) => {
      try {
        if (!(await ctx.enabled(guildId))) return null;
        const config = await ctx.config(guildId);
        if (!config.modmail.enabled) return null;
        const member = await this.#isMember(guildId, userId);
        if (member === null) {
          uncertain++;
          return null;
        }
        if (!member) return null;
        return { id: guildId, name: await this.#name(guildId) };
      } catch {
        uncertain++;
        return null;
      }
    });
    return {
      guilds: found.filter((guild): guild is Candidate => guild !== null),
      uncertain,
    };
  }

  async #isMember(guildId: string, userId: string): Promise<boolean | null> {
    const key = `${guildId}:${userId}`;
    const cached = this.#members.peek(key, this.now());
    if (cached) return cached.value;
    const member = await this.service.services.platform.isMember(guildId, userId);
    if (member !== null) this.#members.set(key, member, this.now());
    return member;
  }

  async #eligible(guildId: string, userId: string): Promise<boolean> {
    const { platform } = this.service.services;
    const { ctx } = this.service;
    if (!platform.guildIds().includes(guildId)) return false;
    if (!(await ctx.enabled(guildId))) return false;
    const config = await ctx.config(guildId);
    if (!config.modmail.enabled) return false;
    return (await platform.isMember(guildId, userId)) !== false;
  }

  async #name(guildId: string): Promise<string> {
    const guild = await this.service.services.platform.guild(guildId).catch(() => null);
    return guild?.name ?? guildId;
  }

  async #languageFor(guilds: readonly Candidate[]): Promise<Language> {
    if (guilds.length === 0) return 'en';
    const found = new Set(await Promise.all(guilds.map((guild) => languageOf(guild.id))));
    const [only] = found;
    return found.size === 1 && only ? only : 'en';
  }

  #open(guild: Candidate, first: IncomingMessage, latest: IncomingMessage): Promise<void> {
    return inGuild(guild.id, () => this.#openIn(guild, first, latest));
  }

  async #openIn(guild: Candidate, first: IncomingMessage, latest: IncomingMessage): Promise<void> {
    const { platform, log, voice } = this.service.services;
    const { store } = this.service;
    const config = await this.service.ctx.config(guild.id);
    const result = await this.service.open({
      guildId: guild.id,
      target: modmailTarget(config),
      opener: first.author,
      source: 'modmail',
      subject: truncate(first.content.trim(), 200) || null,
    });

    const ticket = result.ok ? result.ticket : result.reason === 'limit' ? result.existing : null;
    if (!ticket) {
      log.warn(
        { guild: guild.id, reason: result.ok ? null : result.reason },
        'modmail open failed',
      );
      await platform
        .reply(latest, `${voice.icon('no')}${copy.modmailUnavailable(guild.name)}`)
        .catch(() => {});
      return;
    }
    await store.useModmailTarget(first.author.id, guild.id).catch(() => {});
    const relayed = await this.service.relayFromMember(ticket, first);
    if (relayed) await platform.reply(latest, copy.modmailSent(guild.name)).catch(() => {});
  }
}
