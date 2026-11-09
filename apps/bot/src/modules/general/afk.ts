import { generalConfig } from '@maxwell/core/modules/general';
import type { AfkStore } from '@maxwell/core/stores/afk';
import type { Command } from '../../commands/types.js';
import { inGuild } from '../../i18n/language.js';
import type { IncomingMessage } from '../../platform/types.js';
import type { Services } from '../../services.js';
import { truncate } from '../../ui/format.js';
import { humanDuration } from '../moderation/text.js';
import { copy } from './copy.js';

const NOTICE_GAP = 60_000;
const BACK_TTL = 10_000;
const REASON_MAX = 200;

export class AfkTracker {
  readonly #users = new Map<string, Set<string>>();
  readonly #noticed = new Map<string, number>();

  constructor(
    private readonly services: Services,
    private readonly store: AfkStore,
  ) {}

  async #known(guildId: string): Promise<Set<string>> {
    let users = this.#users.get(guildId);
    if (!users) {
      users = new Set(await this.store.users(guildId));
      this.#users.set(guildId, users);
    }
    return users;
  }

  async set(guildId: string, userId: string, reason: string): Promise<void> {
    await this.store.set(guildId, userId, reason);
    (await this.#known(guildId)).add(userId);
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.store.clear(guildId, userId);
    this.#users.get(guildId)?.delete(userId);
  }

  #recent(key: string): boolean {
    const now = Date.now();
    const last = this.#noticed.get(key);
    if (last !== undefined && now - last < NOTICE_GAP) return true;
    if (this.#noticed.size > 5_000) this.#noticed.clear();
    this.#noticed.set(key, now);
    return false;
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const users = await this.#known(guildId);
    const author = message.author.id;
    const mentioned = message.mentionUsers.filter((id) => id !== author && users.has(id));
    if (!users.has(author) && mentioned.length === 0) return;

    const { settings, guilds, platform } = this.services;
    const general = await settings.config(guildId, 'general', generalConfig);
    if (general.disabledCommands.includes('afk')) return;

    await inGuild(guildId, async () => {
      if (users.has(author)) {
        const prefix = await guilds.prefix(guildId);
        const body = message.content.trim().toLowerCase();
        if (!body.startsWith(`${prefix.toLowerCase()}afk`)) {
          users.delete(author);
          const was = await this.store.clear(guildId, author);
          if (was) {
            await platform.reply(message, {
              content: copy.afk.back(humanDuration(Date.now() - was.since.getTime())),
              deleteAfter: BACK_TTL,
            });
          }
        }
      }

      const away = (await this.store.get(guildId, mentioned)).filter(
        (entry) => !this.#recent(`${message.channelId}:${entry.userId}`),
      );
      if (away.length === 0) return;
      await platform.reply(message, {
        content: away
          .map((entry) => copy.afk.away(`<@${entry.userId}>`, entry.reason, entry.since))
          .join('\n'),
        mentionUsers: [],
      });
    });
  }
}

export function afkCommand(tracker: AfkTracker): Command {
  return {
    name: 'afk',
    description: copy.commands.afk,
    guildOnly: true,
    cooldown: 10_000,
    args: [{ name: 'reason', type: 'text', optional: true }],
    examples: ['afk', 'afk sleeping'],
    async run(ctx) {
      const reason = truncate(ctx.args.string('reason')?.trim() ?? '', REASON_MAX);
      await tracker.set(ctx.guildId, ctx.message.author.id, reason);
      await ctx.reply({ content: copy.afk.set(reason), mentionUsers: [] });
    },
  };
}
