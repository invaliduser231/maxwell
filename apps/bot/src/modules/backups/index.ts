import { type Actor, moduleByKey } from '@maxwell/core';
import definition, {
  type SnapshotChannel,
  type SnapshotModule,
  type SnapshotRole,
} from '@maxwell/core/modules/backups';
import { BackupStore } from '@maxwell/core/stores/backups';
import { ChannelKind } from '../../platform/types.js';
import { defineBotModule } from '../../runtime/module.js';
import { backupCommand } from './commands.js';
import { audit } from './copy.js';
import { applyImport, type ImportDeps, previewImport } from './importer.js';
import { MemberRoleBackup } from './members.js';
import {
  channelUndoPatch,
  mapOverwrites,
  type RestoreScope,
  roleInput,
  roleUndoEdit,
} from './restore.js';
import { BackupService } from './service.js';
import { MODULE } from './types.js';
import { DeletionWatch, Expected } from './watch.js';

const DAILY_CHECK = 60 * 60_000;

function checkAt(at: number): { runAt: Date; dedupeKey: string } {
  return { runAt: new Date(at), dedupeKey: `backups.daily:${Math.floor(at / DAILY_CHECK)}` };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function actor(value: unknown): Actor {
  return { id: text(value) ?? null };
}

function scopeOf(payload: Record<string, unknown>): RestoreScope | null {
  const kind = text(payload.scope) ?? 'full';
  const id = text(payload.id);
  switch (kind) {
    case 'full':
      return { kind: 'full' };
    case 'role':
      return id ? { kind: 'role', id } : null;
    case 'channel':
      return id ? { kind: 'channel', id } : null;
    case 'modules':
    case 'configs':
      return { kind: 'modules', modules: texts(payload.modules) };
    case 'pick': {
      const roles = texts(payload.roles);
      const channels = texts(payload.channels);
      const modules = texts(payload.modules);
      return roles.length + channels.length + modules.length > 0
        ? { kind: 'pick', roles, channels, modules }
        : null;
    }
    default:
      return null;
  }
}

function isRole(value: unknown): value is SnapshotRole {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as SnapshotRole).id === 'string' &&
    typeof (value as SnapshotRole).name === 'string'
  );
}

function isChannel(value: unknown): value is SnapshotChannel {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as SnapshotChannel).id === 'string' &&
    typeof (value as SnapshotChannel).type === 'number'
  );
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const { platform, log } = services;
    const store = new BackupStore(services.sql);
    const expected = new Expected();
    const members = new MemberRoleBackup(ctx, store);
    const service = new BackupService(ctx, store, expected, members);
    const watch = new DeletionWatch(ctx, store, expected);
    const running = new Set<string>();

    const once = async (key: string, work: () => Promise<void>) => {
      if (running.has(key)) return;
      running.add(key);
      try {
        await work();
      } finally {
        running.delete(key);
      }
    };

    const importDeps: ImportDeps = {
      platform,
      store,
      record: async (guildId, by, summary, result) => {
        await ctx.record(guildId, by, 'import', summary, {
          after: result,
          undo: {
            kind: 'import',
            payload: {
              roles: result.roles.map((role) => role.id),
              channels: result.channels.map((channel) => channel.id),
              everyoneBefore: result.everyone?.before ?? null,
            },
          },
        });
      },
      onError: (error, what) => log.warn({ err: error, what }, 'template import step failed'),
    };

    ctx.privacy({
      export: async (guildId, userId) => {
        const { snapshots, imports } = await store.createdBy(guildId, userId);
        const roles = await store.memberRolesOf(guildId, userId);
        if (snapshots.length === 0 && imports.length === 0 && roles.length === 0) return null;
        return { snapshotsTaken: snapshots, templateImports: imports, savedRoles: roles };
      },
      forget: async (guildId, userId) => {
        await store.forgetCreator(guildId, userId);
        await store.forgetMemberRoles(guildId, userId);
      },
    });

    ctx.on('auditLog', (entry) => watch.onAuditLog(entry));
    ctx.on('roleDelete', (change) => watch.onRoleDelete(change));
    ctx.on('roleDelete', (change) => members.onRoleDelete(change));
    ctx.on('memberUpdate', (update) => members.onUpdate(update));
    ctx.on('memberLeave', (leave) => members.onLeave(leave));
    ctx.on('channelDelete', (change) => watch.onChannelDelete(change));

    ctx.job('daily', async () => {
      try {
        const taken = await service.daily(platform.guildIds());
        if (taken > 0) log.info({ taken }, 'daily snapshots taken');
      } finally {
        await ctx.schedule('daily', checkAt(Date.now() + DAILY_CHECK));
      }
    });

    ctx.on(
      'ready',
      async () => {
        await ctx.schedule('daily', checkAt(Date.now() + 5 * 60_000));
      },
      { always: true },
    );

    ctx.job('snapshot', async (job) => {
      const guildId = job.guildId;
      if (!guildId || !(await ctx.enabled(guildId))) return;
      await once(`snapshot:${guildId}`, async () => {
        await service.take(
          guildId,
          'manual',
          actor(job.payload.by),
          text(job.payload.label)?.slice(0, 100) ?? null,
        );
      });
    });

    ctx.job('restore', async (job) => {
      const guildId = job.guildId;
      if (!guildId || !(await ctx.enabled(guildId))) return;
      const snapshotId = text(job.payload.snapshotId);
      const scope = scopeOf(job.payload);
      if (!snapshotId || !scope) return;
      const snapshot = await store.get(guildId, snapshotId);
      if (!snapshot) return;
      await once(job.id, async () => {
        const by = actor(job.payload.by);
        if ((await ctx.config(guildId)).snapshotBeforeRestore) {
          await service.take(guildId, 'manual', by, audit.beforeRestore);
        }
        await service.restore(guildId, snapshot, scope, by);
        if (job.payload.automatic === true) {
          await service.take(guildId, 'manual', by, audit.afterRestore);
        }
      });
    });

    ctx.job('import.preview', async (job) => {
      const guildId = job.guildId;
      if (!guildId || !(await ctx.enabled(guildId))) return;
      const code = text(job.payload.code);
      const importId = text(job.payload.importId);
      if (!code) {
        if (importId) await store.failImport(guildId, importId, audit.templateInvalid);
        return;
      }
      await previewImport(importDeps, guildId, code, actor(job.payload.by), importId);
    });

    ctx.job('import.apply', async (job) => {
      const guildId = job.guildId;
      const importId = text(job.payload.importId);
      if (!guildId || !importId || !(await ctx.enabled(guildId))) return;
      await once(`import:${importId}`, async () => {
        await applyImport(importDeps, guildId, importId, actor(job.payload.by));
      });
    });

    ctx.undo('restore', async (entry, payload) => {
      const guildId = entry.guildId;
      await service.removeCreated(guildId, texts(payload.roles), texts(payload.channels));
      for (const item of Array.isArray(payload.roleEdits) ? payload.roleEdits : []) {
        const undo = roleUndoEdit(item);
        if (!undo) continue;
        await platform
          .editRole(guildId, undo.id, undo.edit, audit.undoReason)
          .catch((error) => log.warn({ err: error, guild: guildId }, 'undo role edit failed'));
      }
      for (const item of Array.isArray(payload.edits) ? payload.edits : []) {
        const undo = channelUndoPatch(item);
        if (!undo || Object.keys(undo.patch).length === 0) continue;
        await platform
          .editChannel(undo.id, undo.patch, audit.undoReason)
          .catch((error) => log.warn({ err: error, guild: guildId }, 'undo channel edit failed'));
      }
      const modules = payload.modules;
      if (modules && typeof modules === 'object') {
        const states = Object.fromEntries(
          Object.entries(modules as Record<string, SnapshotModule>).filter(([key]) =>
            moduleByKey(key),
          ),
        );
        await store.writeModuleStates(guildId, states, [MODULE]);
      }
    });

    ctx.undo('import', async (entry, payload) => {
      await service.removeCreated(entry.guildId, texts(payload.roles), texts(payload.channels));
      const everyone = text(payload.everyoneBefore);
      if (everyone && /^\d+$/.test(everyone)) {
        await platform
          .editRole(entry.guildId, entry.guildId, { permissionBits: everyone }, audit.undoReason)
          .catch((error) =>
            log.warn({ err: error, guild: entry.guildId }, 'undo everyone permissions failed'),
          );
      }
    });

    ctx.undo('recreate.role', async (entry, payload) => {
      const role = payload.role;
      if (!isRole(role)) return;
      const guildId = entry.guildId;
      const id = await platform.createRole(guildId, roleInput(role), audit.recreateReason);
      if (role.position > 0) {
        await platform
          .editRole(guildId, id, { position: role.position }, audit.recreateReason)
          .catch((error) => log.warn({ err: error, guild: guildId }, 'role position failed'));
      }
      await members
        .giveBack(guildId, role.id, id, audit.recreateReason)
        .catch((error) =>
          log.warn({ err: error, guild: guildId }, 'giving back member roles failed'),
        );
      const latest = await store.latest(guildId);
      if (!latest) return;
      const live = new Set((await platform.channels(guildId)).map((channel) => channel.id));
      for (const channel of latest.data.channels) {
        if (!live.has(channel.id)) continue;
        const overwrite = channel.overwrites?.find(
          (item) => item.type === 'role' && item.id === role.id,
        );
        if (!overwrite) continue;
        const [mapped] =
          mapOverwrites(guildId, [overwrite], new Map([[role.id, id]]), new Set([id])) ?? [];
        if (!mapped) continue;
        await platform
          .setOverwrite(channel.id, mapped, audit.recreateReason)
          .catch((error) => log.warn({ err: error, guild: guildId }, 'overwrite restore failed'));
      }
    });

    ctx.undo('recreate.channel', async (entry, payload) => {
      const channel = payload.channel;
      if (!isChannel(channel)) return;
      const guildId = entry.guildId;
      const [roles, channels] = await Promise.all([
        platform.roles(guildId),
        platform.channels(guildId),
      ]);
      const liveChannels = new Set(channels.map((item) => item.id));
      const liveRoles = new Set(roles.map((item) => item.id));
      const parentId =
        channel.parentId && liveChannels.has(channel.parentId) ? channel.parentId : null;
      const id = await platform.createChannel(
        guildId,
        {
          name: channel.name || 'channel',
          type: channel.type,
          parentId: channel.type === ChannelKind.Category ? null : parentId,
          topic: channel.topic ?? undefined,
          userLimit: channel.userLimit ?? undefined,
          overwrites: mapOverwrites(guildId, channel.overwrites, new Map(), liveRoles),
        },
        audit.recreateReason,
      );
      if (channel.rateLimitPerUser) {
        await platform
          .editChannel(id, { rateLimitPerUser: channel.rateLimitPerUser }, audit.recreateReason)
          .catch((error) => log.warn({ err: error, guild: guildId }, 'slowmode restore failed'));
      }
      if (channel.type !== ChannelKind.Category) return;
      const latest = await store.latest(guildId);
      for (const child of latest?.data.channels ?? []) {
        if (child.parentId !== channel.id) continue;
        const live = channels.find((item) => item.id === child.id);
        if (!live || live.parentId !== null) continue;
        await platform
          .editChannel(child.id, { parentId: id }, audit.recreateReason)
          .catch((error) => log.warn({ err: error, guild: guildId }, 'child move failed'));
      }
    });

    return [backupCommand(store, service)];
  },
});
