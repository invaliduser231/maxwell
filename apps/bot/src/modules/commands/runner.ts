import type { Actor } from '@maxwell/core';
import {
  type CustomCommand,
  type commandsConfig,
  customCommand,
  validatePattern,
} from '@maxwell/core/modules/commands';
import { generalConfig } from '@maxwell/core/modules/general';
import type { CommandStore, CommandTestResult } from '@maxwell/core/stores/commands';
import { Cooldowns } from '../../commands/cooldowns.js';
import type { IncomingMessage, OutgoingMessage } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { code, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy, reasons } from './copy.js';
import { findTrigger, type Invocation, invocation, Matchers, type Trigger } from './match.js';
import { pick, type Random, type ResponseContext, renderResponse } from './render.js';

type Ctx = ModuleContext<typeof commandsConfig>;

const NOISE_TTL = 8_000;

export interface RoleChange {
  added: string[];
  removed: string[];
}

export function cooldownKey(command: CustomCommand, message: IncomingMessage): string {
  const scope =
    command.cooldownScope === 'guild'
      ? 'guild'
      : command.cooldownScope === 'channel'
        ? message.channelId
        : message.author.id;
  return `${message.guildId}:${command.id}:${scope}`;
}

export function allowed(
  command: CustomCommand,
  message: IncomingMessage,
  commandChannels: readonly string[],
): 'ok' | 'channel' | 'role' {
  const channels =
    command.allowedChannels.length > 0
      ? command.allowedChannels
      : command.trigger === 'command'
        ? commandChannels
        : [];
  if (channels.length > 0 && !channels.includes(message.channelId)) return 'channel';
  if (
    command.allowedRoles.length > 0 &&
    !command.allowedRoles.some((role) => message.memberRoles.includes(role))
  ) {
    return 'role';
  }
  return 'ok';
}

export function planRoles(command: CustomCommand, memberRoles: readonly string[]): RoleChange {
  const has = new Set(memberRoles);
  const removing = new Set(command.removeRoles);
  return {
    added: [...new Set(command.addRoles)].filter((role) => !has.has(role) && !removing.has(role)),
    removed: [...removing].filter((role) => has.has(role)),
  };
}

export function buildResponse(
  command: CustomCommand,
  context: ResponseContext,
  random: Random = Math.random,
): OutgoingMessage | null {
  const template = pick(
    command.responses.filter((entry) => entry.trim()),
    random,
  );
  if (!template) return null;
  const text = renderResponse(template, context, random).trim();
  if (!text) return null;
  if (command.embed) {
    return {
      embeds: [{ color: command.color ?? palette.south, description: truncate(text, 4096) }],
      mentionUsers: [context.user.id],
    };
  }
  return { content: truncate(text, 4000), mentionUsers: [context.user.id] };
}

export class CommandRunner {
  readonly matchers = new Matchers();
  readonly #cooldowns = new Cooldowns();
  readonly #warned = new Set<string>();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: CommandStore,
  ) {}

  builtin(name: string): boolean {
    return this.ctx.services.registry.has(name.trim());
  }

  async #invocation(guildId: string, content: string): Promise<Invocation | null> {
    const prefix = await this.ctx.services.guilds.prefix(guildId);
    if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    return invocation(content.slice(prefix.length));
  }

  async claims(guildId: string, name: string): Promise<boolean> {
    if (this.builtin(name) || !(await this.ctx.enabled(guildId))) return false;
    const key = name.trim().toLowerCase();
    const config = await this.ctx.config(guildId);
    return config.commands.some(
      (command) =>
        command.enabled &&
        command.trigger === 'command' &&
        command.pattern.trim().toLowerCase() === key,
    );
  }

  #onTimeout = (guildId: string) => (command: CustomCommand) => {
    const key = `${guildId}:${command.id}`;
    if (this.#warned.has(key)) return;
    if (this.#warned.size > 1_000) this.#warned.clear();
    this.#warned.add(key);
    this.ctx.services.log.warn(
      { guild: guildId, command: command.id },
      'custom command regex timed out',
    );
  };

  async handle(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook || !message.content) return;
    const config = await this.ctx.config(guildId);
    if (!config.commands.some((command) => command.enabled)) return;

    const invoked = await this.#invocation(guildId, message.content);
    if (invoked && this.builtin(invoked.name)) return;

    const trigger = findTrigger(config.commands, {
      content: message.content,
      invoked,
      matchers: this.matchers,
      onTimeout: this.#onTimeout(guildId),
    });
    if (!trigger) return;
    await this.#run(guildId, message, trigger);
  }

  async #run(guildId: string, message: IncomingMessage, trigger: Trigger): Promise<void> {
    const { command } = trigger;
    const { platform, settings, voice, log } = this.ctx.services;
    const isCommand = command.trigger === 'command';
    const seed = { seed: message.id, scope: message.channelId };
    const noise = (content: string) =>
      platform.reply(message, { content, deleteAfter: NOISE_TTL }).catch(() => '');

    const general = await settings.config(guildId, 'general', generalConfig);
    if (isCommand && general.disabledCommands.includes(command.pattern.trim().toLowerCase()))
      return;

    const access = allowed(command, message, general.commandChannels);
    if (access !== 'ok') {
      if (isCommand) await noise(access === 'channel' ? copy.notHere : copy.notForYou);
      return;
    }

    if (command.cooldown > 0) {
      const wait = this.#cooldowns.take(cooldownKey(command, message), command.cooldown * 1000);
      if (wait > 0) {
        if (isCommand) await noise(voice.cooldown(new Date(Date.now() + wait), seed));
        return;
      }
    }

    const context = await this.#context(guildId, message, trigger);
    const response = buildResponse(command, context);
    const roles = planRoles(command, message.memberRoles);

    if (response) {
      const send = command.reply
        ? platform.reply(message, response)
        : platform.send(message.channelId, response);
      await send.catch((error) =>
        log.warn(
          { err: error, guild: guildId, command: command.id },
          'custom command reply failed',
        ),
      );
    }

    if (roles.added.length || roles.removed.length) {
      await this.#applyRoles(guildId, message.author.id, command, roles);
    }

    if (command.deleteTrigger) {
      await platform
        .delete(message.channelId, message.id, reasons.role(command.pattern))
        .catch((error) =>
          log.debug({ err: error, guild: guildId }, 'custom command trigger delete failed'),
        );
    }

    await this.store
      .used(guildId, command.id, message.author.id)
      .catch((error) => log.warn({ err: error, guild: guildId }, 'custom command usage failed'));
  }

  async #context(
    guildId: string,
    message: IncomingMessage,
    trigger: Trigger,
  ): Promise<ResponseContext> {
    const { platform } = this.ctx.services;
    const [guild, channels] = await Promise.all([
      platform.guild(guildId).catch(() => null),
      platform.channels(guildId).catch(() => []),
    ]);
    return {
      user: {
        id: message.author.id,
        username: message.author.username,
        displayName: message.author.displayName,
      },
      server: { id: guildId, name: guild?.name ?? copy.sampleServer },
      channel: {
        id: message.channelId,
        name: channels.find((channel) => channel.id === message.channelId)?.name ?? null,
      },
      args: trigger.args,
      match: trigger.match,
    };
  }

  async #applyRoles(
    guildId: string,
    userId: string,
    command: CustomCommand,
    plan: RoleChange,
  ): Promise<RoleChange> {
    const { platform, log } = this.ctx.services;
    const reason = reasons.role(command.pattern);
    const done: RoleChange = { added: [], removed: [] };
    for (const roleId of plan.added) {
      try {
        await platform.addRole(guildId, userId, roleId, reason);
        done.added.push(roleId);
      } catch (error) {
        log.warn({ err: error, guild: guildId, role: roleId }, 'custom command role add failed');
      }
    }
    for (const roleId of plan.removed) {
      try {
        await platform.removeRole(guildId, userId, roleId, reason);
        done.removed.push(roleId);
      } catch (error) {
        log.warn({ err: error, guild: guildId, role: roleId }, 'custom command role remove failed');
      }
    }
    if (done.added.length || done.removed.length) {
      const actor: Actor = { id: userId };
      await this.ctx.record(
        guildId,
        actor,
        'command.roles',
        reasons.rolesSummary(code(command.pattern), userId, done.added.length, done.removed.length),
        {
          before: { userId, roles: done.removed },
          after: { userId, roles: done.added },
          undo: { kind: 'roles', payload: { userId, added: done.added, removed: done.removed } },
        },
      );
    }
    return done;
  }

  async undoRoles(guildId: string, payload: Record<string, unknown>): Promise<void> {
    const { platform } = this.ctx.services;
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (!userId) return;
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
    for (const roleId of list(payload.added)) {
      await platform.removeRole(guildId, userId, roleId, reasons.undo);
    }
    for (const roleId of list(payload.removed)) {
      await platform.addRole(guildId, userId, roleId, reasons.undo);
    }
  }

  async test(guildId: string, payload: Record<string, unknown>): Promise<CommandTestResult> {
    const { platform, guilds } = this.ctx.services;
    const empty: CommandTestResult = {
      matched: false,
      problem: 'missing',
      content: null,
      embed: false,
      args: null,
      addRoles: [],
      removeRoles: [],
    };
    let command: CustomCommand | null = null;
    if (payload.command && typeof payload.command === 'object') {
      const parsed = customCommand.safeParse(payload.command);
      command = parsed.success ? parsed.data : null;
    } else if (typeof payload.commandId === 'string') {
      const config = await this.ctx.config(guildId);
      command = config.commands.find((entry) => entry.id === payload.commandId) ?? null;
    }
    if (!command) return empty;

    const content = typeof payload.content === 'string' ? payload.content.slice(0, 4000) : '';
    const prefix = await guilds.prefix(guildId);
    const invoked = content.toLowerCase().startsWith(prefix.toLowerCase())
      ? invocation(content.slice(prefix.length))
      : null;
    let timedOut = false;
    const trigger = findTrigger([{ ...command, enabled: true }], {
      content,
      invoked,
      matchers: this.matchers,
      onTimeout: () => {
        timedOut = true;
      },
    });

    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
    const [user, guild, channels] = await Promise.all([
      userId ? platform.user(userId).catch(() => null) : null,
      platform.guild(guildId).catch(() => null),
      channelId ? platform.channels(guildId).catch(() => []) : [],
    ]);
    const context: ResponseContext = {
      user: {
        id: user?.id ?? userId ?? '0',
        username: user?.username ?? copy.sampleUser,
        displayName: user?.displayName ?? copy.sampleUser,
      },
      server: { id: guildId, name: guild?.name ?? copy.sampleServer },
      channel: {
        id: channelId ?? '0',
        name: channels.find((channel) => channel.id === channelId)?.name ?? null,
      },
      args: trigger?.args ?? '',
      match: trigger?.match ?? [],
    };
    const response = buildResponse(command, context);
    const text = response?.content ?? response?.embeds?.[0]?.description ?? null;
    const invalid = validatePattern(command.trigger, command.pattern);
    const shadowed = command.trigger === 'command' && this.builtin(command.pattern);
    const problem = timedOut
      ? 'timeout'
      : invalid === 'empty'
        ? 'empty'
        : invalid
          ? 'invalid_pattern'
          : shadowed
            ? 'builtin'
            : trigger
              ? null
              : 'no_match';
    return {
      matched: trigger !== null && !shadowed,
      problem,
      content: text,
      embed: command.embed,
      args: trigger?.args ?? null,
      addRoles: command.addRoles,
      removeRoles: command.removeRoles,
    };
  }
}
