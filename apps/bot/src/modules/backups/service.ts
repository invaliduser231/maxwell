import { type Actor, moduleByKey } from '@maxwell/core';
import type { SnapshotData, SnapshotModule } from '@maxwell/core/modules/backups';
import type {
  BackupStore,
  Snapshot,
  SnapshotKind,
  SnapshotMeta,
} from '@maxwell/core/stores/backups';
import { ChannelKind, type ChannelRef } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { audit } from './copy.js';
import {
  executeRestore,
  planRestore,
  type RestoreResult,
  type RestoreScope,
  undoPayload,
} from './restore.js';
import { capture } from './snapshot.js';
import { type backupsConfig, MODULE } from './types.js';
import type { Expected } from './watch.js';

const DAILY_GAP = 23 * 60 * 60_000;

export function dueForDaily(last: Date | null, now = Date.now()): boolean {
  return last === null || now - last.getTime() >= DAILY_GAP;
}

export function deletionOrder(channels: readonly ChannelRef[], ids: readonly string[]): string[] {
  const categories = new Set(
    channels.filter((c) => c.type === ChannelKind.Category).map((c) => c.id),
  );
  const wanted = [...ids];
  return [
    ...wanted.filter((id) => !categories.has(id)),
    ...wanted.filter((id) => categories.has(id)),
  ];
}

export class BackupService {
  constructor(
    private readonly ctx: ModuleContext<typeof backupsConfig>,
    private readonly store: BackupStore,
    private readonly expected: Expected,
  ) {}

  async modules(guildId: string): Promise<Record<string, SnapshotModule>> {
    const states = await this.store.moduleStates(guildId);
    return Object.fromEntries(Object.entries(states).filter(([key]) => moduleByKey(key)));
  }

  async take(
    guildId: string,
    kind: SnapshotKind,
    by: Actor,
    label: string | null = null,
  ): Promise<SnapshotMeta> {
    const config = await this.ctx.config(guildId);
    const data = await capture(this.ctx.services.platform, guildId, async () =>
      config.includeModules ? this.modules(guildId) : {},
    );
    const meta = await this.store.insert(guildId, kind, data, { label, by: by.id });
    await this.store.prune(guildId, {
      retentionDays: config.retentionDays,
      maxManual: config.maxManual,
    });
    if (kind === 'manual') {
      await this.ctx.record(guildId, by, 'snapshot', audit.auditSnapshot(meta.number), {
        after: {
          snapshotId: meta.id,
          number: meta.number,
          roles: meta.roleCount,
          channels: meta.channelCount,
        },
      });
    }
    return meta;
  }

  async daily(guildIds: readonly string[]): Promise<number> {
    let taken = 0;
    for (const guildId of guildIds) {
      try {
        if (!(await this.ctx.enabled(guildId))) continue;
        const config = await this.ctx.config(guildId);
        if (!config.daily) continue;
        if (!dueForDaily(await this.store.latestAt(guildId, 'daily'))) continue;
        await this.take(guildId, 'daily', { id: null });
        taken++;
      } catch (error) {
        this.ctx.services.log.warn({ err: error, guild: guildId }, 'daily snapshot failed');
      }
    }
    return taken;
  }

  async restore(
    guildId: string,
    snapshot: Snapshot,
    scope: RestoreScope,
    by: Actor,
  ): Promise<RestoreResult> {
    const { platform, log } = this.ctx.services;
    const [roles, channels] = await Promise.all([
      platform.roles(guildId),
      platform.channels(guildId),
    ]);
    const plan = planRestore(
      guildId,
      snapshot.data,
      { roles, channels },
      scope,
      (key) => moduleByKey(key) !== undefined,
    );
    const result = await executeRestore(
      {
        platform,
        readModules: (id) => this.store.moduleStates(id),
        writeModules: (id, states) => this.store.writeModuleStates(id, states, [MODULE]),
        onError: (error, what) =>
          log.warn({ err: error, guild: guildId, what }, 'restore step failed'),
      },
      guildId,
      snapshot.data,
      plan,
      audit.restoreReason(snapshot.number),
    );

    const touched =
      result.roles.length +
      result.roleEdits.length +
      result.channels.length +
      result.edits.length +
      result.modules.length;
    if (touched > 0 || result.overwrites > 0) {
      await this.ctx.record(guildId, by, 'restore', this.#summary(snapshot, scope), {
        after: {
          snapshotId: snapshot.id,
          number: snapshot.number,
          scope,
          roles: result.roles,
          roleEdits: result.roleEdits.map((edit) => ({ id: edit.state.id, fields: edit.fields })),
          channels: result.channels,
          edits: result.edits.map((edit) => ({ id: edit.state.id, fields: edit.fields })),
          modules: result.modules,
          failed: result.failed,
          skipped: plan.skipped,
        },
        undo: { kind: 'restore', payload: undoPayload(result) },
      });
    }
    return result;
  }

  #summary(snapshot: Snapshot, scope: RestoreScope): string {
    const data: SnapshotData = snapshot.data;
    switch (scope.kind) {
      case 'role': {
        const name = data.roles.find((role) => role.id === scope.id)?.name ?? scope.id;
        return audit.auditRestoreRole(name, snapshot.number);
      }
      case 'channel': {
        const name = data.channels.find((channel) => channel.id === scope.id)?.name ?? scope.id;
        return audit.auditRestoreChannel(name, snapshot.number);
      }
      case 'modules':
        return audit.auditRestoreModules(snapshot.number);
      case 'pick':
        return audit.auditRestorePick(
          scope.roles.length + scope.channels.length + scope.modules.length,
          snapshot.number,
        );
      default:
        return audit.auditRestoreFull(snapshot.number);
    }
  }

  async removeCreated(
    guildId: string,
    roleIds: readonly string[],
    channelIds: readonly string[],
  ): Promise<void> {
    const { platform, log } = this.ctx.services;
    const channels = await platform.channels(guildId).catch(() => [] as ChannelRef[]);
    const live = new Set(channels.map((channel) => channel.id));
    for (const id of deletionOrder(channels, channelIds)) {
      if (!live.has(id)) continue;
      this.expected.mark(id);
      await platform
        .deleteChannel(id, audit.undoReason)
        .catch((error) => log.warn({ err: error, guild: guildId }, 'undo channel delete failed'));
    }
    const roles = new Set((await platform.roles(guildId).catch(() => [])).map((role) => role.id));
    for (const id of roleIds) {
      if (!roles.has(id)) continue;
      this.expected.mark(id);
      await platform
        .deleteRole(guildId, id, audit.undoReason)
        .catch((error) => log.warn({ err: error, guild: guildId }, 'undo role delete failed'));
    }
  }
}
