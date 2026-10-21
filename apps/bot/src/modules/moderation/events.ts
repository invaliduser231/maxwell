import {
  AuditAction,
  type AuditLogEvent,
  type BanChange,
  type MemberUpdate,
} from '../../platform/types.js';
import type { Confirmations } from './confirm.js';
import type { NameTracker } from './names.js';
import type { ModerationService } from './service.js';

export function timeoutTransition(
  update: Pick<MemberUpdate, 'timeoutUntil' | 'before'>,
  now = Date.now(),
): 'set' | 'cleared' | null {
  if (!update.before) return null;
  const previous = update.before.timeoutUntil;
  const next = update.timeoutUntil;
  const wasActive = previous !== null && previous.getTime() > now;
  const isActive = next !== null && next.getTime() > now;
  if (isActive && (!wasActive || previous?.getTime() !== next?.getTime())) return 'set';
  if (!isActive && wasActive) return 'cleared';
  return null;
}

export const ATTRIBUTION_WINDOW_MS = 10_000;

export type AuditCase = 'kick' | 'ban' | 'unban' | 'timeout' | 'untimeout';

export function auditCase(
  entry: Pick<AuditLogEvent, 'action' | 'changes'>,
  now = Date.now(),
): AuditCase | null {
  switch (entry.action) {
    case AuditAction.MemberKick:
      return 'kick';
    case AuditAction.MemberBanAdd:
      return 'ban';
    case AuditAction.MemberBanRemove:
      return 'unban';
    case AuditAction.MemberUpdate: {
      const change = entry.changes.find((item) => item.key === 'communication_disabled_until');
      if (!change) return null;
      const { after } = change;
      const until =
        typeof after === 'string'
          ? Date.parse(after)
          : typeof after === 'number'
            ? after
            : Number.NaN;
      return Number.isFinite(until) && until > now ? 'timeout' : 'untimeout';
    }
    default:
      return null;
  }
}

export function registerEvents(
  moderation: ModerationService,
  names: NameTracker,
  confirmations: Confirmations,
): void {
  const { ctx, store } = moderation;
  const { log, platform } = ctx.services;

  const external = async (
    guildId: string,
    userId: string,
    action: 'ban' | 'unban' | 'timeout' | 'untimeout',
    durationMs: number | null,
    previousUntil: Date | null,
  ) => {
    if (moderation.expected.take(guildId, userId, action)) return;
    const known = moderation.holds.take(guildId, userId, action);
    const result = await moderation.act({
      guildId,
      action,
      userId,
      moderatorId: known?.actorId ?? null,
      reason: known?.reason ?? null,
      durationMs,
      source: 'external',
      previousUntil,
    });
    if (known) return;
    const late = moderation.holds.take(guildId, userId, action);
    if (late) await moderation.attribute(guildId, result.row.number, late);
  };

  ctx.on('memberJoin', (join) => names.onJoin(join.guildId, join.user));

  ctx.on('memberUpdate', async (update: MemberUpdate) => {
    await names
      .onUpdate(update)
      .catch((error) => log.warn({ err: error, guild: update.guildId }, 'name history failed'));
    if (update.user.bot) return;
    const transition = timeoutTransition(update);
    if (transition === 'set' && update.timeoutUntil) {
      await external(
        update.guildId,
        update.user.id,
        'timeout',
        update.timeoutUntil.getTime() - Date.now(),
        null,
      );
    } else if (transition === 'cleared') {
      await external(
        update.guildId,
        update.user.id,
        'untimeout',
        null,
        update.before?.timeoutUntil ?? null,
      );
    }
  });

  ctx.on('banAdd', (ban: BanChange) => external(ban.guildId, ban.user.id, 'ban', null, null));
  ctx.on('banRemove', (ban: BanChange) => external(ban.guildId, ban.user.id, 'unban', null, null));

  ctx.on('auditLog', async (entry: AuditLogEvent) => {
    const { guildId, targetId, actorId } = entry;
    if (!targetId || (actorId !== null && actorId === platform.selfId)) return;
    const action = auditCase(entry);
    if (!action) return;
    const attribution = { actorId, reason: entry.reason?.trim() || null };

    if (action === 'kick') {
      await moderation.act({
        guildId,
        action: 'kick',
        userId: targetId,
        moderatorId: attribution.actorId,
        reason: attribution.reason,
        source: 'external',
      });
      return;
    }

    moderation.holds.hold(guildId, targetId, action, attribution);
    const recent = await store.recentExternal(
      guildId,
      targetId,
      action,
      new Date(Date.now() - ATTRIBUTION_WINDOW_MS),
    );
    if (!recent) return;
    const held = moderation.holds.take(guildId, targetId, action);
    if (held) await moderation.attribute(guildId, recent.number, held);
  });

  ctx.on('reaction', (reaction) => {
    confirmations.handle(reaction);
  });
}
