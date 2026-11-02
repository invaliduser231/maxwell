import type { Actor } from '@maxwell/core';
import { enqueue } from '@maxwell/core';
import type { InboxKind } from '@maxwell/core/modules/moderation';
import {
  type InboxItem,
  type InboxState,
  InboxStore,
  type ReportResult,
} from '@maxwell/core/stores/inbox';
import type { CaseRow } from '@maxwell/core/stores/moderation';
import { SecurityStore } from '@maxwell/core/stores/security';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { z } from 'zod';
import { mention } from '../../commands/mentions.js';
import type { Embed, EmbedField, IncomingMessage, ReactionEvent } from '../../platform/types.js';
import { palette } from '../../ui/palette.js';
import { sameEmoji } from '../roles/emoji.js';
import { copy as securityCopy } from '../security/copy.js';
import { storedReasons } from '../security/risk.js';
import { jumpUrl } from '../starboard/render.js';
import { checkTarget } from './access.js';
import { excerptOf } from './commands/actions.js';
import { inboxAudit, inboxCopy } from './inbox-copy.js';
import { ActionError, type ModerationService } from './service.js';
import { clip } from './text.js';

const MAX_TEXT = 1_500;
const MAX_REPORTERS = 10;

const snowflake = z.string().regex(/^\d{1,21}$/);

export const assignPayload = z.object({
  number: z.number().int().positive(),
  assigneeId: snowflake.nullable(),
  by: snowflake,
});

export const resolvePayload = z.object({
  number: z.number().int().positive(),
  status: z.enum(['resolved', 'dismissed']),
  action: z.enum(['warn', 'timeout', 'kick', 'ban']).nullable().default(null),
  durationSeconds: z.number().int().positive().max(63_072_000).nullable().default(null),
  reason: z.string().max(MAX_TEXT).nullable().default(null),
  deleteMessage: z.boolean().default(false),
  shield: z.boolean().default(false),
  note: z.string().max(MAX_TEXT).nullable().default(null),
  by: snowflake,
});

export type ResolveInput = z.output<typeof resolvePayload>;

const tones: Record<InboxItem['status'], number> = {
  open: palette.warning,
  claimed: palette.south,
  resolved: palette.success,
  dismissed: palette.muted,
};

export class ModInbox {
  readonly store: InboxStore;
  readonly #resolving = new Set<string>();

  constructor(readonly moderation: ModerationService) {
    this.store = new InboxStore(moderation.services.sql);
    moderation.onReview((row) => this.openReview(row));
    moderation.onReviewResolved((guildId, number, approved, by) =>
      this.closeReview(guildId, number, approved, by),
    );
  }

  get services() {
    return this.moderation.services;
  }

  async report(
    guildId: string,
    reporterId: string,
    subjectId: string,
    message: IncomingMessage | null,
    body: string | null,
  ): Promise<ReportResult> {
    const excerpt = message ? excerptOf(message) : null;
    const result = await this.store.report({
      guildId,
      subjectId,
      reporterId,
      channelId: message?.channelId ?? null,
      messageId: message?.id ?? null,
      excerpt: excerpt ? clip(excerpt, 1_000) : null,
      body: body ? clip(body, MAX_TEXT) : null,
    });
    if (result.kind !== 'already') await this.notify(result.item);
    return result;
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    if (!reaction.guildId || reaction.bot) return;
    const { platform, log } = this.services;
    const config = await this.moderation.config(reaction.guildId);
    if (!config.reports || !config.reportEmoji) return;
    if (!sameEmoji(reaction.emoji, config.reportEmoji)) return;
    await platform
      .unreact(reaction.channelId, reaction.messageId, reaction.emoji, reaction.userId)
      .catch((error) => log.debug({ err: error, guild: reaction.guildId }, 'report reaction kept'));
    const message = await platform
      .message(reaction.channelId, reaction.messageId)
      .catch(() => null);
    if (!message || message.author.bot || message.author.id === reaction.userId) return;
    const result = await this.report(
      reaction.guildId,
      reaction.userId,
      message.author.id,
      message,
      null,
    );
    if (result.kind === 'already') return;
    const guild = await platform.guild(reaction.guildId).catch(() => null);
    await platform
      .sendDirect(reaction.userId, inboxCopy.reactionSent(guild?.name ?? reaction.guildId))
      .catch(() => false);
  }

  async openReview(row: CaseRow): Promise<void> {
    if (!row.userId) return;
    const item = await this.store.review(row.guildId, row.userId, row.number, row.reason);
    if (item) await this.notify(item);
  }

  async closeReview(
    guildId: string,
    caseNumber: number,
    approved: boolean,
    by: string | null,
  ): Promise<void> {
    if (this.#resolving.has(`${guildId}:${caseNumber}`)) return;
    const item = await this.store.reviewFor(guildId, caseNumber);
    if (!item || (item.status !== 'open' && item.status !== 'claimed')) return;
    const change = await this.store.resolve(guildId, item.number, {
      status: approved ? 'resolved' : 'dismissed',
      by,
      outcome: approved ? 'approved' : 'declined',
      outcomeCase: null,
      note: null,
    });
    if (change) await this.notify(change.after);
  }

  async notify(item: InboxItem): Promise<void> {
    const { platform, log } = this.services;
    const embed = await this.embed(item);
    try {
      if (item.noticeChannelId && item.noticeMessageId) {
        await platform.edit(item.noticeChannelId, item.noticeMessageId, { embeds: [embed] });
        return;
      }
      const config = await this.moderation.config(item.guildId);
      if (!config.inboxChannelId) return;
      const messageId = await platform.send(config.inboxChannelId, { embeds: [embed] });
      await this.store.setNotice(item.guildId, item.number, config.inboxChannelId, messageId);
    } catch (error) {
      log.warn({ err: error, guild: item.guildId, module: 'moderation' }, 'inbox channel unusable');
    }
  }

  async notifyNumber(guildId: string, number: number): Promise<void> {
    const item = await this.store.get(guildId, number);
    if (item) await this.notify(item);
  }

  async assign(guildId: string, number: number, assigneeId: string | null, by: string) {
    const change = await this.store.assign(guildId, number, assigneeId);
    if (!change) return null;
    const { after, before } = change;
    const summary = assigneeId
      ? inboxAudit.claim(after.kind, after.number)
      : inboxAudit.release(after.kind, after.number);
    await this.moderation.ctx.record(guildId, { id: by }, 'inbox.assign', summary, {
      before: { status: before.status, assigneeId: before.assigneeId },
      after: { status: after.status, assigneeId: after.assigneeId },
      undo: { kind: 'inbox', payload: { item: serialise(before) } },
    });
    await this.notify(after);
    return after;
  }

  async resolve(guildId: string, input: ResolveInput): Promise<InboxItem | null> {
    const item = await this.store.get(guildId, input.number);
    if (!item || (item.status !== 'open' && item.status !== 'claimed')) return null;
    const effect = await this.#apply(item, input);
    if (!effect) return null;
    const change = await this.store.resolve(guildId, item.number, {
      status: input.status,
      by: input.by,
      outcome: effect.outcome,
      outcomeCase: effect.caseNumber,
      note: input.note?.trim() || null,
    });
    if (!change) return null;
    const summary =
      input.status === 'resolved'
        ? inboxAudit.resolve(item.kind, item.number)
        : inboxAudit.dismiss(item.kind, item.number);
    await this.moderation.ctx.record(guildId, { id: input.by }, 'inbox.resolve', summary, {
      before: { status: change.before.status },
      after: {
        status: change.after.status,
        outcome: change.after.outcome,
        outcomeCase: change.after.outcomeCase,
        note: change.after.note,
      },
      undo: { kind: 'inbox', payload: { item: serialise(change.before) } },
    });
    await this.notify(change.after);
    if (item.kind === 'appeal' && item.subjectId) await this.#tellAppellant(change.after);
    return change.after;
  }

  async restore(guildId: string, payload: Record<string, unknown>, _by: Actor): Promise<void> {
    const previous = deserialise(payload.item);
    if (!previous) return;
    const restored = await this.store.restore(guildId, previous);
    if (restored) await this.notify(restored);
  }

  async embed(item: InboxItem): Promise<Embed> {
    const { platform, config: env } = this.services;
    const fields: EmbedField[] = [];
    if (item.subjectId) {
      fields.push({
        name: inboxCopy.fields.member,
        value: mention.user(item.subjectId),
        inline: true,
      });
    }
    if (item.kind === 'report' && item.reporters.length > 0) {
      fields.push({
        name: inboxCopy.fields.reporters,
        value: reporterList(item.reporters),
        inline: true,
      });
    }
    fields.push({ name: inboxCopy.fields.status, value: statusLine(item), inline: true });
    if (item.channelId && item.messageId) {
      const exists = await platform.message(item.channelId, item.messageId).catch(() => null);
      const link = jumpUrl(env.FLUXER_WEB_URL, item.guildId, item.channelId, item.messageId);
      fields.push({
        name: inboxCopy.fields.message,
        value: exists
          ? `[${inboxCopy.jump}](${link})`
          : `${mention.channel(item.channelId)}, ${inboxCopy.gone}`,
      });
    }
    if (item.excerpt) fields.push({ name: '​', value: quote(clip(item.excerpt, 1_000)) });
    const body = await this.#body(item);
    if (body) fields.push({ name: bodyLabel(item.kind), value: clip(body, 1_000) });
    const outcome = outcomeLine(item);
    if (outcome) fields.push({ name: inboxCopy.fields.outcome, value: outcome, inline: true });
    if (item.note) fields.push({ name: inboxCopy.fields.note, value: clip(item.note, 1_000) });
    if (env.DASHBOARD_URL) {
      const url = `${env.DASHBOARD_URL.replace(/\/+$/, '')}/g/${item.guildId}/inbox?item=${item.number}`;
      fields.push({ name: '​', value: `[${inboxCopy.dashboard}](${url})` });
    }
    return {
      title: inboxCopy.titles[item.kind](item.number),
      color: tones[item.status],
      fields,
      timestamp: item.createdAt,
    };
  }

  async #body(item: InboxItem): Promise<string | null> {
    if (item.kind === 'gate') {
      const held = Number(item.body);
      return Number.isFinite(held) ? inboxCopy.gateHeld(held) : null;
    }
    if (item.kind !== 'check') return item.body;
    const state = checkStates.find((entry) => entry === item.body);
    const lines = state ? [inboxCopy.checkStates[state]] : [];
    if (item.refId) {
      const check = await new SecurityStore(this.services.sql)
        .check(item.guildId, item.refId)
        .catch(() => null);
      if (check) {
        const reasons = storedReasons(check.reasons).map(securityCopy.reason).join(', ');
        lines.push(inboxCopy.riskScore(check.score, reasons));
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  async #enqueue(guildId: string, kind: string, payload: Record<string, unknown>) {
    await enqueue(this.services.sql, { kind, guildId, payload });
  }

  async #apply(
    item: InboxItem,
    input: ResolveInput,
  ): Promise<{ outcome: string; caseNumber: number | null } | null> {
    const { platform, log } = this.services;
    const reason = input.reason?.trim() || null;

    if (item.kind === 'review') {
      if (item.caseNumber === null) return { outcome: 'none', caseNumber: null };
      const approve = input.status === 'resolved';
      const key = `${item.guildId}:${item.caseNumber}`;
      this.#resolving.add(key);
      try {
        const result = await this.moderation.resolveReview(
          item.guildId,
          item.caseNumber,
          approve,
          input.by,
        );
        return {
          outcome: approve ? 'approved' : 'declined',
          caseNumber: result?.row.number ?? null,
        };
      } catch (error) {
        return this.#refused(item, error);
      } finally {
        this.#resolving.delete(key);
      }
    }

    if (item.kind === 'gate') {
      if (input.status === 'dismissed') return { outcome: 'none', caseNumber: null };
      const ban = input.action === 'ban';
      await this.#enqueue(item.guildId, ban ? 'automod.gate.banall' : 'automod.gate.letin', {
        by: input.by,
      });
      return { outcome: ban ? 'banned' : 'let_in', caseNumber: null };
    }

    if (item.kind === 'check' && input.status === 'resolved' && !input.action && item.subjectId) {
      await this.#enqueue(item.guildId, 'security.pass', { userId: item.subjectId, by: input.by });
      return { outcome: 'released', caseNumber: null };
    }

    if (input.status === 'dismissed' || !item.subjectId)
      return { outcome: 'none', caseNumber: null };

    if (item.kind === 'appeal') {
      try {
        const result = await this.moderation.act({
          guildId: item.guildId,
          action: 'unban',
          userId: item.subjectId,
          moderatorId: input.by,
          reason: reason ?? item.body,
          source: 'dashboard',
          meta: { inbox: item.number },
        });
        return { outcome: 'unban', caseNumber: result.row.number };
      } catch (error) {
        if (error instanceof ActionError && error.status === 404) {
          return { outcome: 'none', caseNumber: null };
        }
        return this.#refused(item, error);
      }
    }

    let caseNumber: number | null = null;
    let outcome = 'none';
    if (input.action && !this.services.config.OWNER_IDS.includes(input.by)) {
      const { problem } = await checkTarget(platform, {
        guildId: item.guildId,
        actorId: input.by,
        targetId: item.subjectId,
        needsMember: false,
        botAction: false,
      });
      if (problem === 'admin' || problem === 'higher') {
        log.warn(
          { guild: item.guildId, inbox: item.number, action: input.action, problem },
          'inbox action refused',
        );
        return null;
      }
    }
    if (input.action) {
      try {
        const result = await this.moderation.act({
          guildId: item.guildId,
          action: input.action,
          userId: item.subjectId,
          moderatorId: input.by,
          reason: reason ?? item.body,
          durationMs: input.durationSeconds !== null ? input.durationSeconds * 1_000 : null,
          excerpt: item.excerpt,
          source: 'dashboard',
          meta: { inbox: item.number },
        });
        caseNumber = result.row.number;
        outcome = input.action;
        if (input.shield && input.action === 'ban') {
          await new ShieldStore(this.services.sql).report(
            item.guildId,
            item.subjectId,
            'manual',
            input.by,
          );
        }
      } catch (error) {
        return this.#refused(item, error);
      }
    }
    if (input.deleteMessage && item.channelId && item.messageId) {
      const deleted = await platform
        .delete(item.channelId, item.messageId)
        .then(() => true)
        .catch((error) => {
          log.debug({ err: error, guild: item.guildId }, 'reported message not deleted');
          return false;
        });
      if (deleted && outcome === 'none') outcome = 'deleted';
    }
    return { outcome, caseNumber };
  }

  #refused(item: InboxItem, error: unknown): null {
    if (error instanceof ActionError && error.status !== null && error.status < 500) {
      this.services.log.warn(
        { err: error.original, guild: item.guildId, inbox: item.number },
        'inbox action refused',
      );
      return null;
    }
    throw error;
  }

  async #tellAppellant(item: InboxItem): Promise<void> {
    if (!item.subjectId) return;
    const { platform } = this.services;
    const guild = await platform.guild(item.guildId).catch(() => null);
    const name = guild?.name ?? item.guildId;
    const text =
      item.status === 'resolved' ? inboxCopy.appealAccepted(name) : inboxCopy.appealDeclined(name);
    await platform.sendDirect(item.subjectId, text).catch(() => false);
  }
}

function reporterList(ids: readonly string[]): string {
  if (ids.length > MAX_REPORTERS) return inboxCopy.reporters(ids.length);
  return ids.map((id) => mention.user(id)).join(', ');
}

function bodyLabel(kind: InboxKind): string {
  if (kind === 'appeal') return inboxCopy.fields.appeal;
  if (kind === 'review') return inboxCopy.fields.review;
  if (kind === 'gate') return inboxCopy.fields.gate;
  if (kind === 'check') return inboxCopy.fields.check;
  return inboxCopy.fields.report;
}

const checkStates = ['undelivered', 'failed', 'expired'] as const;

function statusLine(item: InboxItem): string {
  const who = (id: string | null) => (id ? mention.user(id) : inboxCopy.status.open);
  switch (item.status) {
    case 'open':
      return inboxCopy.status.open;
    case 'claimed':
      return inboxCopy.status.claimed(who(item.assigneeId));
    case 'resolved':
      return inboxCopy.status.resolved(who(item.resolvedBy));
    case 'dismissed':
      return inboxCopy.status.dismissed(who(item.resolvedBy));
  }
}

function outcomeLine(item: InboxItem): string | null {
  if (!item.outcome) return null;
  const outcomes = inboxCopy.outcomes;
  const n = item.outcomeCase;
  switch (item.outcome) {
    case 'warn':
    case 'timeout':
    case 'kick':
    case 'ban':
    case 'unban':
      return n !== null ? outcomes[item.outcome](n) : outcomes.none;
    case 'approved':
      return outcomes.approved;
    case 'declined':
      return outcomes.declined;
    case 'deleted':
      return outcomes.deleted;
    case 'let_in':
    case 'banned':
    case 'left':
    case 'passed':
    case 'released':
      return outcomes[item.outcome];
    default:
      return outcomes.none;
  }
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function serialise(item: InboxState): Record<string, unknown> {
  return {
    number: item.number,
    status: item.status,
    assigneeId: item.assigneeId,
    outcome: item.outcome,
    outcomeCase: item.outcomeCase,
    note: item.note,
    resolvedBy: item.resolvedBy,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
  };
}

const stored = z.object({
  number: z.number().int().positive(),
  status: z.enum(['open', 'claimed', 'resolved', 'dismissed']),
  assigneeId: snowflake.nullable(),
  outcome: z.string().nullable(),
  outcomeCase: z.number().int().nullable(),
  note: z.string().nullable(),
  resolvedBy: snowflake.nullable(),
  resolvedAt: z.string().nullable(),
});

function deserialise(value: unknown): InboxState | null {
  const parsed = stored.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    number: data.number,
    status: data.status,
    assigneeId: data.assigneeId,
    outcome: data.outcome,
    outcomeCase: data.outcomeCase,
    note: data.note,
    resolvedBy: data.resolvedBy,
    resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
  };
}
