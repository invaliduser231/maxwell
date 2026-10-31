import 'server-only';
import { isTemplateData } from '@maxwell/core/modules/backups';
import { BackupStore, type TemplateMeta, type TemplateSort } from '@maxwell/core/stores/backups';
import { guildAccess, levelOf, voteBlocked } from './access';
import { communities } from './communities';
import { db } from './db';
import { env } from './env';
import type { FluxerUser } from './fluxer';
import {
  canRemoveTemplate,
  previewOf,
  type TemplateCard,
  type TemplatePreview,
} from './template-view';

export interface TemplateTarget {
  id: string;
  name: string;
  iconUrl: string | null;
  blocked: 'off' | 'vote' | null;
}

function store(): BackupStore {
  return new BackupStore(db().sql);
}

export function toCard(meta: TemplateMeta): TemplateCard {
  return {
    id: String(meta.id),
    title: meta.title,
    description: meta.description,
    guildName: meta.guildName,
    roleCount: meta.roleCount,
    channelCount: meta.channelCount,
    uses: meta.uses,
    createdAt: new Date(meta.createdAt).toISOString(),
  };
}

export async function templateCards(sort: TemplateSort): Promise<TemplateCard[]> {
  return (await store().templates({ sort, limit: 120 })).map(toCard);
}

export async function guildTemplateCards(guildId: string): Promise<TemplateCard[]> {
  return (await store().guildTemplates(guildId)).map(toCard);
}

export async function templateDetail(
  id: string,
): Promise<{ card: TemplateCard; preview: TemplatePreview; guildId: string } | null> {
  const template = await store().template(id);
  if (!template || !isTemplateData(template.data)) return null;
  return {
    card: toCard(template),
    preview: previewOf(template.data),
    guildId: String(template.guildId),
  };
}

export async function templateTargets(user: FluxerUser): Promise<TemplateTarget[]> {
  const list = (await communities(user)).filter((entry) => entry.status === 'in');
  const checked = await Promise.all(
    list.map(async (entry) => {
      const access = await guildAccess(entry.id).catch(() => null);
      if (!access || levelOf(access, 'backups') !== 'edit') return null;
      const enabled = await db().modules.isEnabled(entry.id, 'backups');
      const target: TemplateTarget = {
        id: entry.id,
        name: entry.name,
        iconUrl: entry.iconUrl,
        blocked: voteBlocked(access, 'backups') ? 'vote' : enabled ? null : 'off',
      };
      return target;
    }),
  );
  return checked.filter((entry): entry is TemplateTarget => entry !== null);
}

export async function mayRemove(user: FluxerUser, guildId: string): Promise<boolean> {
  const owner = env().OWNER_IDS.includes(user.id);
  if (owner) return true;
  const access = await guildAccess(guildId).catch(() => null);
  return canRemoveTemplate(false, access ? levelOf(access, 'backups') : null);
}
