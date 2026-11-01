import type { Actor } from '@maxwell/core';
import { isTemplateData } from '@maxwell/core/modules/backups';
import type { BackupStore } from '@maxwell/core/stores/backups';
import { permissionNames } from '../../platform/permissions.js';
import {
  ChannelKind,
  type Overwrite,
  type Permission,
  type Platform,
} from '../../platform/types.js';
import { dangerous } from '../security/nuke.js';
import { audit } from './copy.js';
import { withNamedPermissions } from './permissions.js';
import {
  CHANNEL_LIMIT,
  EVERYONE,
  fetchTemplate,
  type ImportPlan,
  isImportPlan,
  mapMaxwellTemplate,
  mapTemplate,
  maxwellTemplateId,
  type PlanOverwrite,
  parseTemplateCode,
  ROLE_LIMIT,
  TemplateError,
} from './template.js';

export interface ImportResult {
  roles: { key: string; id: string; name: string }[];
  channels: { key: string; id: string; name: string }[];
  everyone: { before: string; after: string } | null;
  failed: { kind: 'role' | 'channel' | 'everyone'; name: string }[];
  withheld?: Permission[];
}

export interface ImportDeps {
  platform: Platform;
  store: BackupStore;
  fetcher?: typeof fetch;
  operator?(userId: string): boolean;
  record(guildId: string, by: Actor, summary: string, result: ImportResult): Promise<void>;
  onError(error: unknown, what: string): void;
}

export async function previewImport(
  deps: ImportDeps,
  guildId: string,
  input: string,
  by: Actor,
  importId?: string,
): Promise<string> {
  const templateId = maxwellTemplateId(input);
  const code = templateId ? null : parseTemplateCode(input);
  const id =
    importId ?? (await deps.store.createImport(guildId, code ?? input.slice(0, 100), by.id));
  if (templateId) return previewMaxwell(deps, guildId, templateId, id);
  if (!code) {
    await deps.store.failImport(guildId, id, audit.templateInvalid);
    return id;
  }
  try {
    const template = await fetchTemplate(code, deps.fetcher);
    await deps.store.setImportPlan(guildId, id, mapTemplate(template, await room(deps, guildId)));
  } catch (error) {
    if (error instanceof TemplateError) {
      await deps.store.failImport(guildId, id, error.message);
      return id;
    }
    deps.onError(error, 'preview');
    await deps.store.failImport(guildId, id, audit.templateUnavailable);
  }
  return id;
}

async function room(
  deps: ImportDeps,
  guildId: string,
): Promise<{ roles: number; channels: number }> {
  const [roles, channels] = await Promise.all([
    deps.platform.roles(guildId),
    deps.platform.channels(guildId),
  ]);
  return {
    roles: Math.max(ROLE_LIMIT - roles.length, 0),
    channels: Math.max(CHANNEL_LIMIT - channels.length, 0),
  };
}

async function previewMaxwell(
  deps: ImportDeps,
  guildId: string,
  templateId: string,
  id: string,
): Promise<string> {
  try {
    const template = await deps.store.template(templateId);
    if (!template || !isTemplateData(template.data)) {
      await deps.store.failImport(guildId, id, audit.templateGone);
      return id;
    }
    const plan = mapMaxwellTemplate(template, await room(deps, guildId));
    await deps.store.setImportPlan(guildId, id, plan);
  } catch (error) {
    deps.onError(error, 'preview');
    await deps.store.failImport(guildId, id, audit.templateBroken);
  }
  return id;
}

function without(names: readonly Permission[], withheld: ReadonlySet<Permission>): Permission[] {
  return names.filter((name) => !withheld.has(name));
}

function toOverwrites(
  guildId: string,
  list: readonly PlanOverwrite[],
  roles: ReadonlyMap<string, string>,
  withheld: ReadonlySet<Permission>,
): Overwrite[] {
  const out: Overwrite[] = [];
  for (const overwrite of list) {
    const id = overwrite.target === EVERYONE ? guildId : roles.get(overwrite.target);
    if (!id) continue;
    out.push({ id, type: 'role', allow: without(overwrite.allow, withheld), deny: overwrite.deny });
  }
  return out;
}

async function ungranted(
  deps: ImportDeps,
  guildId: string,
  plan: ImportPlan,
  by: Actor,
): Promise<Set<Permission>> {
  const granted = new Set<Permission>([
    ...(plan.everyone ?? []),
    ...plan.roles.flatMap((role) => role.permissions),
    ...plan.channels.flatMap((channel) =>
      channel.overwrites.flatMap((overwrite) => overwrite.allow),
    ),
  ]);
  const wanted = dangerous.filter((name) => granted.has(name));
  const userId = by.id;
  if (wanted.length === 0 || (userId && deps.operator?.(userId))) return new Set();
  if (!userId) return new Set(wanted);
  const missing = new Set<Permission>();
  if (await deps.platform.hasPermissions(guildId, userId, null, wanted)) return missing;
  for (const name of wanted) {
    if (!(await deps.platform.hasPermissions(guildId, userId, null, [name]))) missing.add(name);
  }
  return missing;
}

export async function applyImport(
  deps: ImportDeps,
  guildId: string,
  importId: string,
  by: Actor,
): Promise<ImportResult | null> {
  const row = await deps.store.claimImport(guildId, importId);
  if (!row) return null;
  if (!isImportPlan(row.plan)) {
    await deps.store.failImport(guildId, importId, audit.templateInvalid);
    return null;
  }
  const plan: ImportPlan = row.plan;
  const templateId = typeof plan.source.template === 'string' ? plan.source.template : null;
  const reason = templateId
    ? audit.templateReason(plan.source.name)
    : audit.importReason(plan.source.name);
  const result: ImportResult = { roles: [], channels: [], everyone: null, failed: [] };
  const roleIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  let crashed = false;

  try {
    const withheld = await ungranted(deps, guildId, plan, by);
    if (withheld.size > 0) result.withheld = [...withheld];
    if (Array.isArray(plan.everyone)) {
      try {
        const live = (await deps.platform.roles(guildId)).find((role) => role.id === guildId);
        if (live) {
          const current = permissionNames(live.permissions);
          const after = withNamedPermissions(
            live.permissions,
            plan.everyone.filter((name) => !withheld.has(name) || current.includes(name)),
          );
          if (after !== live.permissions) {
            await deps.platform.editRole(guildId, guildId, { permissionBits: after }, reason);
            result.everyone = { before: live.permissions, after };
          }
        }
      } catch (error) {
        deps.onError(error, 'everyone');
        result.failed.push({ kind: 'everyone', name: '@everyone' });
      }
    }

    for (const role of plan.roles) {
      try {
        const id = await deps.platform.createRole(
          guildId,
          {
            name: role.name,
            color: role.color,
            permissions: without(role.permissions, withheld),
            hoist: role.hoist,
            mentionable: role.mentionable,
          },
          reason,
        );
        roleIds.set(role.key, id);
        result.roles.push({ key: role.key, id, name: role.name });
      } catch (error) {
        deps.onError(error, 'role');
        result.failed.push({ kind: 'role', name: role.name });
      }
    }

    for (const channel of plan.channels) {
      const parentId =
        channel.type === ChannelKind.Category || !channel.parentKey
          ? null
          : (channelIds.get(channel.parentKey) ?? null);
      try {
        const id = await deps.platform.createChannel(
          guildId,
          {
            name: channel.name,
            type: channel.type,
            parentId,
            topic: channel.topic ?? undefined,
            userLimit: channel.userLimit ?? undefined,
            nsfw: channel.nsfw || undefined,
            rateLimitPerUser: channel.rateLimitPerUser || undefined,
            overwrites: toOverwrites(guildId, channel.overwrites, roleIds, withheld),
          },
          reason,
        );
        channelIds.set(channel.key, id);
        result.channels.push({ key: channel.key, id, name: channel.name });
      } catch (error) {
        deps.onError(error, 'channel');
        result.failed.push({ kind: 'channel', name: channel.name });
      }
    }
  } catch (error) {
    crashed = true;
    deps.onError(error, 'apply');
  }

  if (result.roles.length > 0 || result.channels.length > 0 || result.everyone || result.withheld) {
    const summary = templateId
      ? audit.auditImportTemplate(plan.source.name)
      : audit.auditImport(plan.source.name);
    await deps.record(guildId, by, summary, result);
  }
  if (crashed) await deps.store.failImport(guildId, importId, audit.importFailed);
  else await deps.store.finishImport(guildId, importId, result);
  if (templateId && (result.roles.length > 0 || result.channels.length > 0)) {
    await deps.store.countTemplateUse(templateId).catch((error) => deps.onError(error, 'uses'));
  }
  return result;
}
