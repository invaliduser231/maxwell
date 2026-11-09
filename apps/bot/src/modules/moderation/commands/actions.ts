import type { ArgSpec } from '../../../commands/args.js';
import type { Command, GuildCommand, GuildContext } from '../../../commands/types.js';
import type { IncomingMessage, Permission, Platform } from '../../../platform/types.js';
import { lines, subtext } from '../../../ui/format.js';
import type { IconName } from '../../../ui/icons.js';
import { checkTarget, describeProblem, modRoleAllow } from '../access.js';
import { type ExecutableAction, MAX_BAN_MS, MAX_TIMEOUT_MS, MIN_BAN_MS } from '../config.js';
import { copy } from '../copy.js';
import {
  ActionError,
  type ActResult,
  type EscalationResult,
  type ModerationService,
} from '../service.js';
import { expandReason } from '../templates.js';
import { humanDuration } from '../text.js';
import { noise, usage, who } from './shared.js';

interface Spec {
  name: Exclude<ExecutableAction, 'flag'>;
  description: string;
  args: ArgSpec[];
  examples: string[];
  permissions: Permission[];
  botPermissions: Permission[];
  needsMember: boolean;
  botAction: boolean;
  reasonRequired: boolean;
  icon: IconName;
}

const member: ArgSpec = { name: 'member', type: 'user' };
const duration: ArgSpec = { name: 'duration', type: 'duration', optional: true };
const reason: ArgSpec = { name: 'reason', type: 'text', optional: true };

const specs: Spec[] = [
  {
    name: 'ban',
    description: copy.commands.ban,
    args: [member, duration, reason],
    examples: ['ban @troll raid spam', 'ban @troll 7d spam links'],
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    needsMember: false,
    botAction: true,
    reasonRequired: true,
    icon: 'shield',
  },
  {
    name: 'unban',
    description: copy.commands.unban,
    args: [{ name: 'user', type: 'user' }, reason],
    examples: ['unban 142700000000000000 appeal accepted'],
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    needsMember: false,
    botAction: false,
    reasonRequired: false,
    icon: 'ok',
  },
  {
    name: 'kick',
    description: copy.commands.kick,
    args: [member, reason],
    examples: ['kick @spammer ads in every channel'],
    permissions: ['KickMembers'],
    botPermissions: ['KickMembers'],
    needsMember: true,
    botAction: true,
    reasonRequired: true,
    icon: 'leave',
  },
  {
    name: 'timeout',
    description: copy.commands.timeout,
    args: [member, duration, reason],
    examples: ['timeout @Lena 10m spam', 'timeout @Lena 2h'],
    permissions: ['ModerateMembers'],
    botPermissions: ['ModerateMembers'],
    needsMember: true,
    botAction: true,
    reasonRequired: true,
    icon: 'clock',
  },
  {
    name: 'untimeout',
    description: copy.commands.untimeout,
    args: [member, reason],
    examples: ['untimeout @Lena'],
    permissions: ['ModerateMembers'],
    botPermissions: ['ModerateMembers'],
    needsMember: true,
    botAction: true,
    reasonRequired: false,
    icon: 'ok',
  },
  {
    name: 'warn',
    description: copy.commands.warn,
    args: [member, reason],
    examples: ['warn @Max spam in #general'],
    permissions: ['ModerateMembers'],
    botPermissions: [],
    needsMember: true,
    botAction: false,
    reasonRequired: true,
    icon: 'warn',
  },
];

export function escalationLine(result: EscalationResult, name: string): string | null {
  switch (result.kind) {
    case 'acted': {
      const duration =
        result.row.durationSeconds !== null
          ? humanDuration(result.row.durationSeconds * 1_000)
          : null;
      return copy.escalated(
        result.active,
        result.days,
        name,
        result.step.action,
        duration,
        result.row.number,
      );
    }
    case 'review':
      return copy.escalatedReview(
        result.active,
        result.days,
        result.step.action,
        result.row.number,
      );
    case 'failed':
      return copy.escalationFailed(name);
  }
}

export function confirmation(
  action: Exclude<ExecutableAction, 'flag'>,
  result: ActResult,
  name: string,
): string {
  const { row } = result;
  const span = row.durationSeconds !== null ? humanDuration(row.durationSeconds * 1_000) : null;
  switch (action) {
    case 'ban':
      return copy.done.ban(name, row.number, span);
    case 'unban':
      return copy.done.unban(name, row.number);
    case 'kick':
      return copy.done.kick(name, row.number);
    case 'timeout':
      return copy.done.timeout(name, row.number, span ?? '');
    case 'untimeout':
      return copy.done.untimeout(name, row.number);
    case 'warn':
      return copy.done.warn(name, row.number, Math.max(result.active, 1));
  }
}

function failure(error: ActionError, action: ExecutableAction, name: string): string | null {
  if (error.status === 404) {
    if (action === 'unban') return copy.errors.notBanned(name);
    return copy.errors.notMember(name);
  }
  if (error.status === 403)
    return copy.errors.forbidden(
      (copy.verbs as Record<string, string | undefined>)[action] ?? action,
      name,
    );
  return null;
}

export function excerptOf(message: IncomingMessage): string | null {
  const parts = [message.content.trim(), ...message.attachments.map((file) => file.url)].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join('\n') : null;
}

export async function replyExcerpt(
  platform: Platform,
  message: IncomingMessage,
  userId: string,
): Promise<string | null> {
  if (!message.replyTo) return null;
  const replied = await platform.message(message.channelId, message.replyTo).catch(() => null);
  if (!replied || replied.author.id !== userId) return null;
  return excerptOf(replied);
}

function build(spec: Spec, moderation: ModerationService): GuildCommand {
  const command: GuildCommand = {
    name: spec.name,
    description: spec.description,
    guildOnly: true,
    args: spec.args,
    examples: spec.examples,
    permissions: spec.permissions,
    allow: modRoleAllow,
    botPermissions: spec.botPermissions.length ? spec.botPermissions : undefined,
    async run(ctx: GuildContext) {
      const { voice, platform } = ctx.services;
      const userId = ctx.args.string(spec.args[0]?.name ?? 'member') as string;
      const config = await moderation.config(ctx.guildId);
      const expanded = expandReason(
        config,
        spec.name,
        ctx.args.string('reason')?.trim() || null,
        ctx.args.number('duration') ?? null,
      );
      const reasonText = expanded.reason;
      const durationMs = expanded.durationMs;

      if (spec.reasonRequired && config.requireReason && !reasonText) {
        await usage(ctx, command, copy.errors.reasonRequired);
        return;
      }
      if (spec.name === 'timeout' && durationMs !== null && durationMs > MAX_TIMEOUT_MS) {
        await noise(ctx, copy.errors.timeoutRange);
        return;
      }
      if (
        spec.name === 'ban' &&
        durationMs !== null &&
        (durationMs < MIN_BAN_MS || durationMs > MAX_BAN_MS)
      ) {
        await noise(ctx, copy.errors.banRange);
        return;
      }

      const user = await platform.user(userId);
      const name = who(user, userId);
      const check = await checkTarget(platform, {
        guildId: ctx.guildId,
        actorId: ctx.message.author.id,
        targetId: userId,
        needsMember: spec.needsMember,
        botAction: spec.botAction,
      });
      if (check.problem) {
        await noise(ctx, describeProblem(check.problem, name));
        return;
      }

      let previousUntil: Date | null = null;
      if (spec.name === 'untimeout') {
        const until = check.member?.timeoutUntil ?? null;
        if (!until || until.getTime() <= Date.now()) {
          await noise(ctx, copy.errors.notTimedOut(name));
          return;
        }
        previousUntil = until;
      }

      const excerpt = await replyExcerpt(platform, ctx.message, userId);
      let result: ActResult;
      try {
        result = await moderation.act({
          guildId: ctx.guildId,
          action: spec.name,
          userId,
          moderatorId: ctx.message.author.id,
          reason: reasonText,
          durationMs: spec.name === 'ban' || spec.name === 'timeout' ? durationMs : null,
          deleteMessageSeconds: expanded.deleteMessageSeconds,
          source: 'command',
          previousUntil,
          excerpt,
        });
      } catch (error) {
        if (error instanceof ActionError) {
          const message = failure(error, spec.name, name);
          if (message) {
            await ctx.reply(`${voice.icon('lock')}${message}`);
            return;
          }
          throw error.original;
        }
        throw error;
      }

      const escalation = result.escalation ? escalationLine(result.escalation, name) : null;
      await ctx.reply(
        lines(
          `${voice.icon(spec.icon)}${confirmation(spec.name, result, name)}`,
          escalation,
          !reasonText && subtext(copy.addReason(ctx.prefix, result.row.number)),
          result.dm === 'failed' && subtext(copy.dmFailed),
        ),
      );
    },
  };
  return command;
}

export function actionCommands(moderation: ModerationService): Command[] {
  return specs.map((spec) => build(spec, moderation));
}
