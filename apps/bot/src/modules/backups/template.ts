import { z } from 'zod';
import { ChannelKind, type Permission } from '../../platform/types.js';
import { audit } from './copy.js';
import { droppedPermissions, toPlatformPermissions } from './permissions.js';

const TEMPLATE_URL = 'https://discord.com/api/v10/guilds/templates/';
const FETCH_TIMEOUT = 10_000;
const MAX_BYTES = 2_000_000;

export const ROLE_LIMIT = 250;
export const CHANNEL_LIMIT = 500;

export function parseTemplateCode(input: string): string | null {
  const trimmed = input.trim();
  const link =
    /^(?:https?:\/\/)?(?:www\.|ptb\.|canary\.)?(?:discord(?:app)?\.com\/template|discord\.new)\/([A-Za-z0-9-]{2,64})\/?(?:[?#].*)?$/i.exec(
      trimmed,
    );
  if (link?.[1]) return link[1];
  return /^[A-Za-z0-9-]{2,64}$/.test(trimmed) ? trimmed : null;
}

const id = z.union([z.number(), z.string()]).transform((value) => String(value));
const bits = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value === null || value === undefined ? '0' : String(value)));

const templateSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  serialized_source_guild: z.object({
    name: z.string().nullish(),
    roles: z
      .array(
        z.object({
          id,
          name: z.string(),
          color: z.number().nullish(),
          hoist: z.boolean().nullish(),
          mentionable: z.boolean().nullish(),
          permissions: bits,
        }),
      )
      .default([]),
    channels: z
      .array(
        z.object({
          id,
          type: z.number(),
          name: z.string().nullish(),
          position: z.number().nullish(),
          topic: z.string().nullish(),
          user_limit: z.number().nullish(),
          parent_id: id.nullish(),
          permission_overwrites: z
            .array(
              z.object({ id, type: z.union([z.number(), z.string()]), allow: bits, deny: bits }),
            )
            .nullish(),
        }),
      )
      .default([]),
  }),
});

export type DiscordTemplate = z.infer<typeof templateSchema>;

export class TemplateError extends Error {
  constructor(readonly reason: 'invalid' | 'not_found' | 'unavailable') {
    super(
      reason === 'invalid'
        ? audit.templateInvalid
        : reason === 'not_found'
          ? audit.templateNotFound
          : audit.templateUnavailable,
    );
  }
}

export async function fetchTemplate(
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordTemplate> {
  let response: Response;
  try {
    response = await fetcher(`${TEMPLATE_URL}${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch {
    throw new TemplateError('unavailable');
  }
  if (response.status === 404 || response.status === 400) throw new TemplateError('not_found');
  if (!response.ok) throw new TemplateError('unavailable');
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new TemplateError('invalid');
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new TemplateError('invalid');
  }
  const parsed = templateSchema.safeParse(json);
  if (!parsed.success) throw new TemplateError('invalid');
  return parsed.data;
}

export interface PlanOverwrite {
  target: string;
  allow: Permission[];
  deny: Permission[];
}

export interface PlanRole {
  key: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: Permission[];
}

export interface PlanChannel {
  key: string;
  name: string;
  type: number;
  parentKey: string | null;
  topic: string | null;
  userLimit: number | null;
  overwrites: PlanOverwrite[];
}

export interface PlanSkip {
  kind: 'role' | 'channel';
  name: string;
  reason: string;
}

export interface ImportPlan {
  source: { code: string; name: string; description: string | null };
  everyone: Permission[] | null;
  roles: PlanRole[];
  channels: PlanChannel[];
  droppedPermissions: string[];
  skipped: PlanSkip[];
}

export const EVERYONE = 'everyone';

const channelTypes = new Map<number, number>([
  [0, ChannelKind.Text],
  [2, ChannelKind.Voice],
  [4, ChannelKind.Category],
  [5, ChannelKind.Announcement],
  [13, ChannelKind.Voice],
  [15, ChannelKind.Text],
  [16, ChannelKind.Text],
]);

export function mapTemplate(
  template: DiscordTemplate,
  room: { roles: number; channels: number } = { roles: ROLE_LIMIT, channels: CHANNEL_LIMIT },
): ImportPlan {
  const source = template.serialized_source_guild;
  const dropped = new Set<string>();
  const skipped: PlanSkip[] = [];
  const everyoneRole = source.roles.find((role) => role.id === '0');
  const everyoneKey = everyoneRole?.id ?? '0';

  const collect = (value: string) => {
    for (const name of droppedPermissions(value)) dropped.add(name);
    return toPlatformPermissions(value);
  };

  const ordered = source.roles.filter((role) => role.id !== everyoneKey).reverse();
  const roles: PlanRole[] = [];
  for (const role of ordered) {
    if (roles.length >= room.roles) {
      skipped.push({ kind: 'role', name: role.name, reason: audit.skippedLimit });
      continue;
    }
    roles.push({
      key: role.id,
      name: role.name.slice(0, 100) || 'role',
      color: role.color ?? 0,
      hoist: role.hoist ?? false,
      mentionable: role.mentionable ?? false,
      permissions: collect(role.permissions),
    });
  }
  const roleKeys = new Set(roles.map((role) => role.key));

  const typed = source.channels
    .map((channel) => ({ channel, type: channelTypes.get(channel.type) }))
    .sort(
      (a, b) =>
        (a.channel.position ?? 0) - (b.channel.position ?? 0) ||
        Number(a.channel.id) - Number(b.channel.id),
    );
  const categories: PlanChannel[] = [];
  const others: PlanChannel[] = [];
  for (const { channel, type } of typed) {
    const name = (channel.name ?? '').slice(0, 100) || 'channel';
    if (type === undefined) {
      skipped.push({ kind: 'channel', name, reason: audit.skippedType(channel.type) });
      continue;
    }
    const overwrites: PlanOverwrite[] = [];
    for (const overwrite of channel.permission_overwrites ?? []) {
      if (String(overwrite.type) !== '0' && overwrite.type !== 'role') continue;
      const target = overwrite.id === everyoneKey ? EVERYONE : overwrite.id;
      if (target !== EVERYONE && !roleKeys.has(target)) continue;
      overwrites.push({ target, allow: collect(overwrite.allow), deny: collect(overwrite.deny) });
    }
    const planned: PlanChannel = {
      key: channel.id,
      name,
      type,
      parentKey: type === ChannelKind.Category ? null : (channel.parent_id ?? null),
      topic: channel.topic ? channel.topic.slice(0, 1024) : null,
      userLimit: type === ChannelKind.Voice ? (channel.user_limit ?? null) || null : null,
      overwrites,
    };
    (type === ChannelKind.Category ? categories : others).push(planned);
  }

  const channels: PlanChannel[] = [];
  for (const channel of [...categories, ...others]) {
    if (channels.length >= room.channels) {
      skipped.push({ kind: 'channel', name: channel.name, reason: audit.skippedLimit });
      continue;
    }
    channels.push(channel);
  }
  const kept = new Set(channels.map((channel) => channel.key));
  for (const channel of channels) {
    if (channel.parentKey && !kept.has(channel.parentKey)) channel.parentKey = null;
  }

  return {
    source: {
      code: template.code,
      name: template.name,
      description: template.description ?? null,
    },
    everyone: everyoneRole ? collect(everyoneRole.permissions) : null,
    roles,
    channels,
    droppedPermissions: [...dropped].sort(),
    skipped,
  };
}

export function isImportPlan(value: unknown): value is ImportPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<ImportPlan>;
  return Array.isArray(plan.roles) && Array.isArray(plan.channels) && !!plan.source;
}
