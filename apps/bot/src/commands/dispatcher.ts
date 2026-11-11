import { randomBytes } from 'node:crypto';
import { generalConfig } from '@maxwell/core/modules/general';
import { Chatter } from '../chatter.js';
import { inGuild } from '../i18n/language.js';
import type { IncomingMessage, Outgoing } from '../platform/types.js';
import type { Services } from '../services.js';
import { uiCopy } from '../ui/copy.js';
import { moduleText } from '../ui/modules.js';
import { formatArgs, parseArgs } from './args.js';
import { Cooldowns } from './cooldowns.js';
import { Lanes } from './lanes.js';
import { suggest } from './suggest.js';
import { tokenize } from './tokenize.js';
import type { Command, CommandContext, GuildContext } from './types.js';

const NOISE_TTL = 8_000;
const USAGE_TTL = 30_000;
const SUGGEST_TTL = 15_000;
const LANE_WAIT = 30_000;

export function stripPrefix(content: string, prefix: string, selfId: string | null): string | null {
  if (content.toLowerCase().startsWith(prefix.toLowerCase())) {
    return content.slice(prefix.length).trim();
  }
  if (selfId) {
    const match = new RegExp(`^<@!?${selfId}>`).exec(content);
    if (match) return content.slice(match[0].length).trim();
  }
  return null;
}

export function usageLine(prefix: string, path: readonly string[], command: Command): string {
  const args = command.args?.length ? ` ${formatArgs(command.args)}` : '';
  return `${prefix}${path.join(' ')}${args}`;
}

function errorCode(): string {
  return `E-${randomBytes(2).toString('hex').toUpperCase()}`;
}

export class Dispatcher {
  readonly #cooldowns = new Cooldowns();
  readonly #chatter: Chatter;
  readonly #lanes = new Lanes(LANE_WAIT);

  constructor(private readonly services: Services) {
    this.#chatter = new Chatter(services);
  }

  handle(message: IncomingMessage): Promise<void> {
    if (message.author.bot || message.fromWebhook) return Promise.resolve();
    return this.#lanes.run(
      `${message.channelId}:${message.author.id}`,
      () => inGuild(message.guildId, () => this.#run(message)),
      (error) => this.services.log.error({ err: error }, 'dispatch failed'),
    );
  }

  async #run(message: IncomingMessage): Promise<void> {
    const { platform, guilds, registry, config, log, voice, settings } = this.services;
    const prefix = await guilds.prefix(message.guildId);
    const body = stripPrefix(message.content, prefix, platform.selfId);
    if (body === null) {
      await this.#chatter.ambient(message);
      return;
    }

    const viaPrefix = message.content.toLowerCase().startsWith(prefix.toLowerCase());
    const seed = { seed: message.id, scope: message.channelId };
    const reply = (out: Outgoing) => platform.reply(message, out);
    const noise = (content: string, ttl: number) => reply({ content, deleteAfter: ttl });

    const tokens = tokenize(body);
    if (tokens.length === 0) {
      if (!viaPrefix) await this.#chatter.mentionOnly(message, prefix);
      return;
    }

    const resolved = registry.resolve(tokens);
    if (!resolved) {
      if (!viaPrefix && (await this.#chatter.addressed(message, body))) return;
      const typed = tokens[0]?.value ?? '';
      if (viaPrefix && message.guildId && (await registry.claimed(message.guildId, typed))) return;
      const guess = viaPrefix ? suggest(typed, registry.names()) : null;
      if (guess)
        await noise(voice.unknownCommand(`${prefix}${typed}`, `${prefix}${guess}`), SUGGEST_TTL);
      return;
    }
    const first = tokens[0]?.value.toLowerCase() ?? '';
    const alias = first !== resolved.path[0]?.toLowerCase();
    if (alias && viaPrefix && message.guildId && (await registry.claimed(message.guildId, first))) {
      return;
    }
    const { command, path, rest } = resolved;

    if (command.ownerOnly && !config.OWNER_IDS.includes(message.author.id)) return;

    if (message.guildId && resolved.module.key !== 'general') {
      if (!(await settings.enabled(message.guildId, resolved.module.key))) {
        await noise(
          voice.moduleOff(moduleText(resolved.module.key, resolved.module).name),
          USAGE_TTL,
        );
        return;
      }
    }

    if (message.guildId) {
      const general = await settings.config(message.guildId, 'general', generalConfig);
      if (
        general.disabledCommands.includes(command.name) ||
        general.disabledCommands.includes(path[0] ?? '')
      )
        return;
      const restricted =
        general.commandChannels.length > 0 && !general.commandChannels.includes(message.channelId);
      if (
        restricted &&
        !(await platform.hasPermissions(message.guildId, message.author.id, message.channelId, [
          'ManageGuild',
        ]))
      )
        return;
    }

    if (!command.run) {
      const names = command.subcommands?.map((sub) => sub.name).join('|') ?? '';
      await noise(voice.usage(uiCopy.pickOne, `${prefix}${path.join(' ')} <${names}>`), USAGE_TTL);
      return;
    }

    if (command.guildOnly && !message.guildId) {
      await reply(voice.guildOnly());
      return;
    }

    if (command.permissions?.length && message.guildId) {
      const allowed =
        (await platform.hasPermissions(
          message.guildId,
          message.author.id,
          message.channelId,
          command.permissions,
        )) || (command.allow ? await command.allow(message, this.services) : false);
      if (!allowed) {
        await reply(voice.missingPermissions(command.permissions));
        return;
      }
    }

    if (command.botPermissions?.length && message.guildId) {
      const missing = await platform.missingBotPermissions(
        message.guildId,
        message.channelId,
        command.botPermissions,
      );
      if (missing.length) {
        await reply(voice.botMissingPermissions(missing));
        return;
      }
    }

    const parsed = parseArgs(command.args ?? [], rest);
    if (!parsed.ok) {
      const problem = voice.argProblem(parsed.arg, parsed.missing);
      await noise(voice.usage(problem, usageLine(prefix, path, command)), USAGE_TTL);
      return;
    }

    if (command.cooldown) {
      const wait = this.#cooldowns.take(`${path.join(' ')}:${message.author.id}`, command.cooldown);
      if (wait > 0) {
        await noise(voice.cooldown(new Date(Date.now() + wait), seed), Math.min(wait, NOISE_TTL));
        return;
      }
    }

    const ctx: CommandContext = {
      message,
      guildId: message.guildId,
      prefix,
      path,
      args: parsed.args,
      services: this.services,
      platform,
      seed,
      reply,
    };

    const started = performance.now();
    try {
      if (command.guildOnly) {
        await command.run(ctx as GuildContext);
      } else {
        await command.run(ctx);
      }
      log.debug(
        { command: path.join(' '), ms: Math.round(performance.now() - started) },
        'command',
      );
    } catch (error) {
      const code = errorCode();
      log.error(
        { err: error, code, command: path.join(' '), guild: message.guildId },
        'command failed',
      );
      await reply(voice.failed(code)).catch(() => {});
    }
  }
}
