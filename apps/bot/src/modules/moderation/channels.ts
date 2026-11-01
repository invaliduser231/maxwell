import { cancel } from '@maxwell/core';
import type { OverwriteChange, StoredOverwrite } from '@maxwell/core/stores/moderation';
import type { Embed } from '../../platform/types.js';
import { palette } from '../../ui/palette.js';
import { unlockKey } from './config.js';
import { copy, reasons } from './copy.js';
import { channelLogEmbed } from './embeds.js';
import {
  channelState,
  type Keeper,
  lockPlan,
  onlySend,
  revertSend,
  store,
  toOverwrite,
  unlockPlan,
} from './overwrites.js';
import type { ModerationService } from './service.js';
import { auditReason, humanDuration } from './text.js';

export type LockResult =
  | { status: 'locked'; endsAt: Date | null }
  | { status: 'already' | 'missing' };

export type UnlockResult = { status: 'unlocked' } | { status: 'notLocked' | 'missing' };

export type SlowmodeResult = { status: 'set'; previous: number } | { status: 'missing' };

interface Applied {
  id: string;
  type: 'role' | 'member';
  before: StoredOverwrite | null;
  after: StoredOverwrite;
  remove?: boolean;
}

const neutral = (id: string, type: 'role' | 'member'): StoredOverwrite => ({
  id,
  type,
  allow: [],
  deny: [],
});

export class ChannelTools {
  constructor(readonly moderation: ModerationService) {}

  get #services() {
    return this.moderation.services;
  }

  async lock(input: {
    guildId: string;
    channelId: string;
    moderatorId: string | null;
    reason: string | null;
    durationMs: number | null;
  }): Promise<LockResult> {
    const { platform } = this.#services;
    const { guildId, channelId } = input;
    const state = await channelState(platform, guildId, channelId);
    if (!state) return { status: 'missing' };

    const config = await this.moderation.config(guildId);
    const keepers: Keeper[] = config.modRoleIds.map((id) => ({ id, type: 'role' }));
    if (platform.selfId) {
      const missing = await platform
        .missingBotPermissions(guildId, null, ['Administrator'])
        .catch(() => ['Administrator']);
      if (missing.length > 0) keepers.push({ id: platform.selfId, type: 'member' });
    }
    const plan = lockPlan(state.overwrites, guildId, keepers);
    if (plan === 'already') return { status: 'already' };

    const header = await this.#header(input.reason, input.moderatorId);
    await this.#apply(channelId, [...plan.slice(1), ...plan.slice(0, 1)], header);

    const endsAt = input.durationMs ? new Date(Date.now() + input.durationMs) : null;
    await this.moderation.store.saveLock({
      guildId,
      channelId,
      changes: plan,
      moderatorId: input.moderatorId,
      reason: input.reason,
      endsAt,
    });
    await cancel(this.#services.sql, unlockKey(guildId, channelId));
    if (endsAt) {
      await this.moderation.ctx.schedule('unlock', {
        guildId,
        payload: { channelId },
        runAt: endsAt,
        dedupeKey: unlockKey(guildId, channelId),
      });
    }
    await this.moderation.ctx.record(
      guildId,
      { id: input.moderatorId },
      'channel.lock',
      reasons.audit.lock(state.name ?? channelId),
      {
        after: { channelId, reason: input.reason, endsAt: endsAt?.toISOString() ?? null },
        undo: { kind: 'lock', payload: { channelId } },
      },
    );
    await this.#log(guildId, {
      title: copy.logTitles.lock,
      channelId,
      moderatorId: input.moderatorId,
      reason: input.reason,
      color: palette.warning,
    });
    return { status: 'locked', endsAt };
  }

  async unlock(input: {
    guildId: string;
    channelId: string;
    moderatorId: string | null;
    reason: string | null;
    record: boolean;
  }): Promise<UnlockResult> {
    const { guildId, channelId } = input;
    const { platform, sql } = this.#services;
    const state = await channelState(platform, guildId, channelId);
    if (!state) return { status: 'missing' };
    const lock = await this.moderation.store.lock(guildId, channelId);

    let applied: Applied[];
    if (lock) {
      const find = (id: string) => state.overwrites.find((entry) => entry.id === id) ?? null;
      applied = lock.changes.map((change) => {
        const now = find(change.id);
        return {
          id: change.id,
          type: change.type,
          before: now ? store(now) : null,
          after: revertSend(now, change),
          remove:
            change.before === null && onlySend(state.raw.find((entry) => entry.id === change.id)),
        };
      });
    } else {
      const plan = unlockPlan(state.overwrites, guildId);
      if (plan === 'notLocked') return { status: 'notLocked' };
      applied = [{ id: plan.id, type: plan.type, before: plan.before, after: plan.after }];
    }

    const header = await this.#header(input.reason, input.moderatorId);
    await this.#apply(channelId, applied, header);
    await this.moderation.store.deleteLock(guildId, channelId);
    await cancel(sql, unlockKey(guildId, channelId));

    if (input.record) {
      await this.moderation.ctx.record(
        guildId,
        { id: input.moderatorId },
        'channel.unlock',
        reasons.audit.unlock(state.name ?? channelId),
        {
          after: { channelId, reason: input.reason },
          undo: {
            kind: 'unlock',
            payload: { channelId, applied, lock: lock?.changes ?? null },
          },
        },
      );
    }
    await this.#log(guildId, {
      title: copy.logTitles.unlock,
      channelId,
      moderatorId: input.moderatorId,
      reason: input.reason,
      color: palette.success,
    });
    return { status: 'unlocked' };
  }

  async relock(
    guildId: string,
    channelId: string,
    applied: Applied[],
    lock: OverwriteChange[] | null,
  ): Promise<void> {
    const back: Applied[] = applied.map((entry) => ({
      id: entry.id,
      type: entry.type,
      before: entry.remove ? null : entry.after,
      after: entry.before ?? neutral(entry.id, entry.type),
    }));
    await this.#apply(channelId, [...back].reverse(), undefined);
    if (lock) {
      await this.moderation.store.saveLock({
        guildId,
        channelId,
        changes: lock,
        moderatorId: null,
        reason: null,
        endsAt: null,
      });
    }
  }

  async slowmode(input: {
    guildId: string;
    channelId: string;
    seconds: number;
    moderatorId: string | null;
  }): Promise<SlowmodeResult> {
    const { platform } = this.#services;
    const state = await channelState(platform, input.guildId, input.channelId);
    if (!state) return { status: 'missing' };
    const previous = state.rateLimitPerUser;
    const header = await this.#header(null, input.moderatorId);
    await platform.editChannel(input.channelId, { rateLimitPerUser: input.seconds }, header);
    await this.moderation.ctx.record(
      input.guildId,
      { id: input.moderatorId },
      'channel.slowmode',
      reasons.audit.slowmode(state.name ?? input.channelId, input.seconds),
      {
        before: { seconds: previous },
        after: { channelId: input.channelId, seconds: input.seconds },
        undo: { kind: 'slowmode', payload: { channelId: input.channelId, seconds: previous } },
      },
    );
    await this.#log(input.guildId, {
      title: copy.logTitles.slowmode,
      channelId: input.channelId,
      moderatorId: input.moderatorId,
      reason: null,
      detail:
        input.seconds > 0
          ? humanDuration(input.seconds * 1_000)
          : copy.slowmode.off(`<#${input.channelId}>`),
    });
    return { status: 'set', previous };
  }

  async restoreSlowmode(channelId: string, seconds: number): Promise<void> {
    await this.#services.platform.editChannel(channelId, { rateLimitPerUser: seconds });
  }

  async logPurge(
    guildId: string,
    channelId: string,
    moderatorId: string,
    deleted: number,
    filter: string | null,
  ): Promise<void> {
    await this.#log(guildId, {
      title: copy.logTitles.purge,
      channelId,
      moderatorId,
      reason: null,
      detail: filter
        ? `${copy.purge.summary(deleted, `<#${channelId}>`)}\n${filter}`
        : copy.purge.summary(deleted, `<#${channelId}>`),
      color: palette.danger,
    });
  }

  async #apply(channelId: string, changes: Applied[], header: string | undefined): Promise<void> {
    const { platform } = this.#services;
    const done: Applied[] = [];
    try {
      for (const change of changes) {
        if (change.remove) await platform.deleteOverwrite(channelId, change.id, header);
        else await platform.setOverwrite(channelId, toOverwrite(change.after), header);
        done.push(change);
      }
    } catch (error) {
      for (const change of done.reverse()) {
        const undo = change.before
          ? platform.setOverwrite(channelId, toOverwrite(change.before))
          : platform.deleteOverwrite(channelId, change.id);
        await undo.catch(() => {});
      }
      throw error;
    }
  }

  async #header(reason: string | null, moderatorId: string | null): Promise<string> {
    const name = moderatorId
      ? ((await this.#services.platform.user(moderatorId))?.username ?? null)
      : null;
    return auditReason(reason ?? reasons.noReason, name);
  }

  async #log(guildId: string, input: Parameters<typeof channelLogEmbed>[0]): Promise<void> {
    const channelId = await this.moderation.logChannel(guildId);
    if (!channelId) return;
    const embed: Embed = channelLogEmbed(input);
    await this.#services.platform
      .send(channelId, { embeds: [embed], silent: true })
      .catch((error) =>
        this.#services.log.warn(
          { err: error, guild: guildId, module: 'moderation' },
          'mod log unusable',
        ),
      );
  }
}

export type { Applied as AppliedOverwrite };
