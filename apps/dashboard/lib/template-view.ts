import type { AccessLevel } from '@maxwell/core';
import {
  permissionBits,
  TEMPLATE_CATEGORY,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_EVERYONE,
  TEMPLATE_TITLE_MAX,
  type TemplateData,
} from '@maxwell/core/modules/backups';

export interface TemplateCard {
  id: string;
  title: string;
  description: string;
  guildName: string | null;
  roleCount: number;
  channelCount: number;
  uses: number;
  createdAt: string;
}

export interface PreviewRole {
  key: string;
  name: string;
  color: number;
  hoist: boolean;
}

export interface PreviewChannel {
  key: string;
  name: string;
  type: number;
  nsfw: boolean;
  hidden: boolean;
}

export interface PreviewGroup {
  key: string;
  name: string | null;
  hidden: boolean;
  channels: PreviewChannel[];
}

export interface TemplatePreview {
  roles: PreviewRole[];
  groups: PreviewGroup[];
}

export interface PublishInput {
  snapshotId: string;
  title: string;
  description: string;
  showName: boolean;
}

const VIEW = 1n << BigInt(permissionBits.ViewChannel);

function denies(bits: string, flag: bigint): boolean {
  try {
    return (BigInt(bits) & flag) === flag;
  } catch {
    return false;
  }
}

function hiddenFromEveryone(channel: TemplateData['channels'][number]): boolean {
  return channel.overwrites.some(
    (overwrite) => overwrite.target === TEMPLATE_EVERYONE && denies(overwrite.deny, VIEW),
  );
}

export function previewOf(data: TemplateData): TemplatePreview {
  const roles = data.roles.map((role) => ({
    key: role.key,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
  }));
  const loose: PreviewChannel[] = [];
  const groups: PreviewGroup[] = [];
  const byKey = new Map<string, PreviewGroup>();
  for (const channel of data.channels) {
    if (channel.type !== TEMPLATE_CATEGORY) continue;
    const group = {
      key: channel.key,
      name: channel.name,
      hidden: hiddenFromEveryone(channel),
      channels: [],
    };
    groups.push(group);
    byKey.set(channel.key, group);
  }
  for (const channel of data.channels) {
    if (channel.type === TEMPLATE_CATEGORY) continue;
    const entry = {
      key: channel.key,
      name: channel.name,
      type: channel.type,
      nsfw: channel.nsfw,
      hidden: hiddenFromEveryone(channel),
    };
    const parent = channel.parentKey ? byKey.get(channel.parentKey) : undefined;
    if (parent) parent.channels.push(entry);
    else loose.push(entry);
  }
  return {
    roles,
    groups:
      loose.length > 0
        ? [{ key: '', name: null, hidden: false, channels: loose }, ...groups]
        : groups,
  };
}

export function parseTemplateLink(input: string): string | null {
  const text = input.trim();
  const code = /^template:(\d{1,18})$/.exec(text);
  if (code?.[1]) return code[1];
  const link = /^(?:https?:\/\/[^/\s]+)?\/templates\/(\d{1,18})\/?(?:[?#].*)?$/i.exec(text);
  return link?.[1] ?? null;
}

export function parsePublish(value: unknown): PublishInput | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'Pick a snapshot.' };
  const input = value as Record<string, unknown>;
  const snapshotId = typeof input.snapshotId === 'string' ? input.snapshotId : '';
  if (!/^\d{1,20}$/.test(snapshotId)) return { error: 'Pick a snapshot.' };
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
  if (title.length === 0) return { error: 'Give the template a title.' };
  if (title.length > TEMPLATE_TITLE_MAX) return { error: 'The title is too long.' };
  const description =
    typeof input.description === 'string' ? input.description.replace(/\r\n/g, '\n').trim() : '';
  if (description.length > TEMPLATE_DESCRIPTION_MAX) {
    return { error: 'The description is too long.' };
  }
  return { snapshotId, title, description, showName: input.showName === true };
}

export function canRemoveTemplate(owner: boolean, sourceLevel: AccessLevel | null): boolean {
  return owner || sourceLevel === 'edit';
}
