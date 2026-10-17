import { type Actor, maxwell } from '@maxwell/core';
import type { AutomodStore, HitInput } from '@maxwell/core/stores/automod';
import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import type { Embed, IncomingMessage } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines, subtext, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { audit, copy, ruleNames } from './copy.js';
import type { RuleHit } from './rules.js';
import type { AutomodAction, AutomodConfig, automodConfig } from './types.js';

const RANK: Record<AutomodAction, number> = { delete: 0, warn: 1, timeout: 2, kick: 3, ban: 4 };
const REPEAT_GUARD_MS = 30_000;
const GUARD_CAP = 10_000;
const BAN_DELETE_SECONDS = 3_600;
const REASON_LIMIT = 1_500;
export const MODERATION = 'moderation';
export const MODERATION_ACTION = 'moderation.action';

export interface Verdict {
  action: AutomodAction | null;
  timeoutMinutes: number;
  deleteMessage: boolean;
  primary: RuleHit | null;
}

export function decide(config: Pick<AutomodConfig, 'rules'>, hits: readonly RuleHit[]): Verdict {
  let action: AutomodAction | null = null;
  let primary: RuleHit | null = null;
  let timeoutMinutes = 0;
  let deleteMessage = false;
  for (const hit of hits) {
    const rule = config.rules[hit.rule];
    if (rule.mode !== 'enforce') continue;
    if (rule.action === 'delete' || rule.deleteMessage) deleteMessage = true;
    if (rule.action === 'timeout') timeoutMinutes = Math.max(timeoutMinutes, rule.timeoutMinutes);
    if (action === null || RANK[rule.action] > RANK[action]) {
      action = rule.action;
      primary = hit;
    }
  }
  if (primary === null) {
    primary = hits[0] ?? null;
  }
  return { action, timeoutMinutes, deleteMessage, primary };
}

export function quote(text: string, max = 1_000): string {
  return truncate(text, max)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

type Ctx = ModuleContext<typeof automodConfig>;

export class Enforcer {
  readonly #recent = new Map<string, number>();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: AutomodStore,
  ) {}

  #guard(guildId: string, userId: string, now: number): boolean {
    const key = `${guildId}:${userId}`;
    const last = this.#recent.get(key);
    if (last !== undefined && now - last < REPEAT_GUARD_MS) return false;
    this.#recent.delete(key);
    while (this.#recent.size >= GUARD_CAP) {
      const oldest = this.#recent.keys().next().value;
      if (oldest === undefined) break;
      this.#recent.delete(oldest);
    }
    this.#recent.set(key, now);
    return true;
  }

  async apply(
    message: IncomingMessage,
    guildId: string,
    config: AutomodConfig,
    hits: readonly RuleHit[],
  ): Promise<void> {
    const { platform, log } = this.ctx.services;
    const verdict = decide(config, hits);
    const userId = message.author.id;
    let applied: string | null = null;

    if (verdict.deleteMessage) {
      await platform
        .delete(
          message.channelId,
          message.id,
          verdict.primary ? audit.reason(ruleNames[verdict.primary.rule]) : undefined,
        )
        .then(() => {
          applied = copy.actions.delete;
        })
        .catch((error) => log.warn({ err: error, guild: guildId }, 'automod delete failed'));
    }

    if (verdict.action && verdict.action !== 'delete' && verdict.primary) {
      if (this.#guard(guildId, userId, Date.now())) {
        const done = await this.#act(message, guildId, config, verdict).catch((error) => {
          log.warn({ err: error, guild: guildId, action: verdict.action }, 'automod action failed');
          return null;
        });
        if (done) applied = done;
      }
    }

    const records: HitInput[] = hits.map((hit) => {
      const rule = config.rules[hit.rule];
      return {
        guildId,
        userId,
        channelId: message.channelId,
        messageId: message.id,
        rule: hit.rule,
        mode: rule.mode,
        action: rule.mode === 'enforce' ? rule.action : null,
        detail: hit.detail,
        content: message.content,
      };
    });
    await this.store
      .recordHits(records)
      .catch((error) => log.warn({ err: error, guild: guildId }, 'automod hit record failed'));

    await this.#log(message, guildId, config, hits, verdict, applied);
  }

  async #act(
    message: IncomingMessage,
    guildId: string,
    config: AutomodConfig,
    verdict: Verdict,
  ): Promise<string | null> {
    const { platform, voice } = this.ctx.services;
    const primary = verdict.primary;
    if (!primary) return null;
    const label = copy.rules[primary.rule];
    const ruleName = ruleNames[primary.rule];
    const reason = audit.reason(ruleName);
    const user = message.author;
    const name = `@${user.username}`;
    const actor: Actor = maxwell;
    const guildName = config.notifyMembers
      ? ((await platform.guild(guildId).catch(() => null))?.name ?? copy.theCommunity)
      : '';
    const dm = async (text: string) => {
      if (!config.notifyMembers) return;
      await platform.sendDirect(user.id, lines(text, subtext(copy.dmFooter))).catch(() => false);
    };

    switch (verdict.action) {
      case 'warn': {
        const warned = await this.#moderationWarn(
          guildId,
          user.id,
          message.id,
          truncate(copy.warnReason(label, primary.detail), REASON_LIMIT),
        );
        if (warned) return copy.actions.warn;
        await platform.send(message.channelId, {
          content: `${voice.icon('warn')}${copy.warn(mention.user(user.id), label)}`,
          mentionUsers: [user.id],
          deleteAfter: 30_000,
        });
        await this.ctx.record(guildId, actor, 'automod.warn', audit.auditWarn(name, ruleName), {
          after: { userId: user.id, rule: primary.rule, detail: primary.detail },
        });
        return copy.actions.warn;
      }
      case 'timeout': {
        const ms = Math.max(verdict.timeoutMinutes, 1) * 60_000;
        const duration = formatDuration(ms);
        await platform.timeout(guildId, user.id, new Date(Date.now() + ms), reason);
        await dm(copy.dmTimeout(guildName, duration, label));
        await this.ctx.record(
          guildId,
          actor,
          'automod.timeout',
          audit.auditTimeout(name, duration, ruleName),
          {
            after: {
              userId: user.id,
              rule: primary.rule,
              detail: primary.detail,
              minutes: ms / 60_000,
            },
            undo: { kind: 'timeout', payload: { userId: user.id } },
          },
        );
        return copy.actions.timeout(duration);
      }
      case 'kick': {
        await dm(copy.dmKick(guildName, label));
        await platform.kick(guildId, user.id, reason);
        await this.ctx.record(guildId, actor, 'automod.kick', audit.auditKick(name, ruleName), {
          after: { userId: user.id, rule: primary.rule, detail: primary.detail },
        });
        return copy.actions.kick;
      }
      case 'ban': {
        await dm(copy.dmBan(guildName, label));
        await platform.ban(guildId, user.id, { reason, deleteMessageSeconds: BAN_DELETE_SECONDS });
        await this.ctx.record(guildId, actor, 'automod.ban', audit.auditBan(name, ruleName), {
          after: { userId: user.id, rule: primary.rule, detail: primary.detail },
          undo: { kind: 'ban', payload: { userId: user.id } },
        });
        return copy.actions.ban;
      }
      default:
        return null;
    }
  }

  async #moderationWarn(
    guildId: string,
    userId: string,
    messageId: string,
    reason: string,
  ): Promise<boolean> {
    const { settings, jobs, log } = this.ctx.services;
    try {
      if (!(await settings.enabled(guildId, MODERATION))) return false;
      await jobs.enqueue({
        kind: MODERATION_ACTION,
        guildId,
        payload: { action: 'warn', userId, moderatorId: null, reason, source: 'automod' },
        dedupeKey: `automod.warn:${guildId}:${messageId}`,
      });
      return true;
    } catch (error) {
      log.warn({ err: error, guild: guildId }, 'automod warning hand-off failed');
      return false;
    }
  }

  async #log(
    message: IncomingMessage,
    guildId: string,
    config: AutomodConfig,
    hits: readonly RuleHit[],
    verdict: Verdict,
    applied: string | null,
  ): Promise<void> {
    if (!config.logChannelId || !verdict.primary) return;
    const logOnly = verdict.action === null;
    const severe = verdict.action === 'kick' || verdict.action === 'ban';
    const user = message.author;
    const embed: Embed = {
      color: severe ? palette.danger : palette.warning,
      author: { name: `${user.displayName} (@${user.username})`, iconUrl: user.avatarUrl },
      title: copy.logTitle(copy.rules[verdict.primary.rule], logOnly),
      description: lines(
        message.content ? quote(message.content) : null,
        message.content ? '' : null,
        copy.logWhere(mention.user(user.id), mention.channel(message.channelId)),
        ...hits.map((hit) => `**${copy.rules[hit.rule]}** ${hit.detail}`),
        `**${copy.logAction}** ${logOnly ? copy.actions.logOnly : (applied ?? copy.actions.logOnly)}`,
      ),
      footer: copy.logFooter(user.id, message.id),
      timestamp: message.createdAt,
    };
    await this.ctx.services.platform
      .send(config.logChannelId, { embeds: [embed], silent: true })
      .catch((error) =>
        this.ctx.services.log.warn({ err: error, guild: guildId }, 'automod log channel unusable'),
      );
  }
}
