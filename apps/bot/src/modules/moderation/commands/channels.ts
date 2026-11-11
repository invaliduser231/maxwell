import { parseDuration } from '../../../commands/duration.js';
import { mention } from '../../../commands/mentions.js';
import type { Command, GuildCommand, GuildContext } from '../../../commands/types.js';
import type { IncomingMessage } from '../../../platform/types.js';
import { code, lines, timestamp } from '../../../ui/format.js';
import { modRoleAllow } from '../access.js';
import type { ChannelTools } from '../channels.js';
import { MAX_SLOWMODE_SECONDS, PURGE_CONFIRM_ABOVE, PURGE_MAX, PURGE_SCAN_MAX } from '../config.js';
import type { Confirmations } from '../confirm.js';
import { copy, reasons } from '../copy.js';
import { hasFilter, matchesPurge, type PurgeFilter, parsePurgeFilter } from '../purge-filter.js';
import { auditReason, humanDuration } from '../text.js';
import { NOISE_TTL, noise, usage } from './shared.js';

const fallback = { ok: '✅' };
const PROGRESS_EVERY = 3_000;

export function describeFilter(filter: PurgeFilter): string | null {
  const parts: string[] = [];
  if (filter.users.length) parts.push(filter.users.map((id) => mention.user(id)).join(' '));
  if (filter.bots) parts.push(code('bots'));
  if (filter.links) parts.push(code('links'));
  if (filter.contains) parts.push(code(`contains ${filter.contains}`));
  return parts.length ? parts.join(' ') : null;
}

export function parseSlowmode(input: string): number | 'bad' {
  const value = input.trim().toLowerCase();
  if (value === 'off' || value === '0' || value === 'none') return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const ms = parseDuration(value);
  return ms === null ? 'bad' : Math.round(ms / 1_000);
}

export function channelCommands(tools: ChannelTools, confirmations: Confirmations): Command[] {
  const lock: GuildCommand = {
    name: 'lock',
    description: copy.commands.lock,
    guildOnly: true,
    args: [
      { name: 'channel', type: 'channel', optional: true },
      { name: 'duration', type: 'duration', optional: true },
      { name: 'reason', type: 'text', optional: true },
    ],
    examples: ['lock', 'lock #general 30m raid', 'lock #general heated'],
    permissions: ['ManageChannels'],
    allow: modRoleAllow,
    botPermissions: ['ManageChannels', 'ManageRoles'],
    async run(ctx) {
      const channelId = ctx.args.string('channel') ?? ctx.message.channelId;
      const reason = ctx.args.string('reason')?.trim() || null;
      const durationMs = ctx.args.number('duration') ?? null;
      const target = mention.channel(channelId);
      const result = await tools.lock({
        guildId: ctx.guildId,
        channelId,
        moderatorId: ctx.message.author.id,
        reason,
        durationMs,
      });
      const { voice } = ctx.services;
      switch (result.status) {
        case 'missing':
          await noise(ctx, copy.errors.noChannel);
          return;
        case 'already':
          await noise(ctx, copy.lock.already(target), NOISE_TTL);
          return;
        case 'locked':
          await ctx
            .reply(
              `${voice.icon('lock')}${
                result.endsAt
                  ? copy.lock.lockedUntil(target, timestamp(result.endsAt, 'R'))
                  : copy.lock.locked(target)
              }`,
            )
            .catch(() => {});
      }
    },
  };

  const unlock: GuildCommand = {
    name: 'unlock',
    description: copy.commands.unlock,
    guildOnly: true,
    args: [
      { name: 'channel', type: 'channel', optional: true },
      { name: 'reason', type: 'text', optional: true },
    ],
    examples: ['unlock', 'unlock #general'],
    permissions: ['ManageChannels'],
    allow: modRoleAllow,
    botPermissions: ['ManageChannels', 'ManageRoles'],
    async run(ctx) {
      const channelId = ctx.args.string('channel') ?? ctx.message.channelId;
      const target = mention.channel(channelId);
      const result = await tools.unlock({
        guildId: ctx.guildId,
        channelId,
        moderatorId: ctx.message.author.id,
        reason: ctx.args.string('reason')?.trim() || null,
        record: true,
      });
      const { voice } = ctx.services;
      switch (result.status) {
        case 'missing':
          await noise(ctx, copy.errors.noChannel);
          return;
        case 'notLocked':
          await noise(ctx, copy.lock.notLocked(target), NOISE_TTL);
          return;
        case 'unlocked':
          await ctx.reply(voice.done(copy.lock.unlocked(target), ctx.seed));
      }
    },
  };

  const slowmode: GuildCommand = {
    name: 'slowmode',
    aliases: ['slow'],
    description: copy.commands.slowmode,
    guildOnly: true,
    args: [
      { name: 'channel', type: 'channel', optional: true },
      { name: 'delay', type: 'word' },
    ],
    examples: ['slowmode 10s', 'slowmode #general 1m', 'slowmode off'],
    permissions: ['ManageChannels'],
    allow: modRoleAllow,
    botPermissions: ['ManageChannels'],
    async run(ctx) {
      const channelId = ctx.args.string('channel') ?? ctx.message.channelId;
      const seconds = parseSlowmode(ctx.args.string('delay') ?? '');
      if (seconds === 'bad') {
        await usage(ctx, slowmode, copy.slowmode.bad);
        return;
      }
      if (seconds > MAX_SLOWMODE_SECONDS) {
        await noise(ctx, copy.slowmode.range);
        return;
      }
      const result = await tools.slowmode({
        guildId: ctx.guildId,
        channelId,
        seconds,
        moderatorId: ctx.message.author.id,
      });
      if (result.status === 'missing') {
        await noise(ctx, copy.errors.noChannel);
        return;
      }
      const target = mention.channel(channelId);
      await ctx.reply(
        ctx.services.voice.done(
          seconds === 0
            ? copy.slowmode.off(target)
            : copy.slowmode.set(target, humanDuration(seconds * 1_000)),
          ctx.seed,
        ),
      );
    },
  };

  const purge: GuildCommand = {
    name: 'purge',
    aliases: ['clear', 'clean', 'prune'],
    description: copy.commands.purge,
    guildOnly: true,
    args: [
      { name: 'count', type: 'integer', min: 1, max: PURGE_MAX },
      { name: 'filters', type: 'text', optional: true },
    ],
    examples: ['purge 50', 'purge 100 @spammer', 'purge 200 bots', 'purge 30 contains free nitro'],
    permissions: ['ManageMessages'],
    allow: modRoleAllow,
    botPermissions: ['ManageMessages', 'ReadMessageHistory'],
    async run(ctx) {
      const total = ctx.args.number('count') as number;
      const parsed = parsePurgeFilter(ctx.args.string('filters'));
      if (!parsed.ok) {
        await usage(ctx, purge, copy.purge.badFilter(parsed.token));
        return;
      }
      await runPurge(ctx, tools, confirmations, total, parsed.filter);
    },
  };

  return [lock, unlock, slowmode, purge];
}

async function collect(
  ctx: GuildContext,
  total: number,
  filter: PurgeFilter,
  skip: Set<string>,
): Promise<string[]> {
  const ids: string[] = [];
  let before: string | undefined = ctx.message.id;
  let scanned = 0;
  const limit = hasFilter(filter) ? PURGE_SCAN_MAX : total + skip.size;
  while (ids.length < total && scanned < limit) {
    const page: IncomingMessage[] = await ctx.platform.recentMessages(
      ctx.message.channelId,
      100,
      before,
    );
    if (page.length === 0) break;
    scanned += page.length;
    for (const message of page) {
      if (skip.has(message.id)) continue;
      if (matchesPurge(message, filter)) ids.push(message.id);
      if (ids.length >= total) break;
    }
    before = page.reduce(
      (min, message) => (BigInt(message.id) < BigInt(min) ? message.id : min),
      page[0]?.id ?? before ?? '',
    );
    if (page.length < 100) break;
  }
  return ids;
}

async function runPurge(
  ctx: GuildContext,
  tools: ChannelTools,
  confirmations: Confirmations,
  total: number,
  filter: PurgeFilter,
): Promise<void> {
  const { platform, voice, log } = ctx.services;
  const channelId = ctx.message.channelId;
  const skip = new Set<string>();

  if (total > PURGE_CONFIRM_ABOVE) {
    const emoji = voice.icons.reaction('ok') ?? fallback.ok;
    const prompt = await ctx.reply(
      lines(
        copy.purge.confirm(total, mention.channel(channelId)),
        copy.purge.confirmHint(voice.icon('ok') || emoji),
      ),
    );
    skip.add(prompt);
    await platform.react(channelId, prompt, emoji).catch(() => {});
    const ok = await confirmations.wait(prompt, ctx.message.author.id, emoji);
    if (!ok) {
      await platform.edit(channelId, prompt, copy.purge.expired).catch(() => {});
      await platform.unreact(channelId, prompt, emoji).catch(() => {});
      return;
    }
    await platform.delete(channelId, prompt).catch(() => {});
  }

  const started = Date.now();
  const ids = await collect(ctx, total, filter, skip);
  await platform.delete(channelId, ctx.message.id).catch(() => {});
  if (ids.length === 0) {
    await platform.send(channelId, { content: copy.purge.nothing, deleteAfter: NOISE_TTL });
    return;
  }

  let progressId: string | null = null;
  if (ids.length > PURGE_CONFIRM_ABOVE) {
    progressId = await platform.send(channelId, copy.purge.working).catch(() => null);
  }
  const channel = (await platform.channels(ctx.guildId).catch(() => [])).find(
    (entry) => entry.id === channelId,
  );
  const channelName = channel?.name ?? channelId;
  const header = auditReason(
    reasons.audit.purge(ids.length, channelName),
    ctx.message.author.username,
  );
  let deleted = 0;
  let lastEdit = Date.now();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      deleted += await platform.bulkDelete(channelId, batch, header);
    } catch (error) {
      log.warn({ err: error, guild: ctx.guildId, module: 'moderation' }, 'purge batch failed');
      break;
    }
    if (progressId && Date.now() - lastEdit >= PROGRESS_EVERY && i + 100 < ids.length) {
      lastEdit = Date.now();
      await platform
        .edit(channelId, progressId, copy.purge.progress(deleted, ids.length))
        .catch(() => {});
    }
  }

  const seconds = Math.round((Date.now() - started) / 1_000);
  const done = `${voice.icon('ok')}${copy.purge.done(deleted, seconds)}`;
  if (progressId) {
    await platform.edit(channelId, progressId, done).catch(() => {});
    const id = progressId;
    setTimeout(() => void platform.delete(channelId, id).catch(() => {}), NOISE_TTL).unref();
  } else {
    await platform.send(channelId, { content: done, deleteAfter: NOISE_TTL }).catch(() => {});
  }

  const description = describeFilter(filter);
  await tools.moderation.ctx.record(
    ctx.guildId,
    { id: ctx.message.author.id },
    'channel.purge',
    reasons.audit.purge(deleted, channelName),
    { after: { channelId, deleted, filter } },
  );
  await tools.logPurge(ctx.guildId, channelId, ctx.message.author.id, deleted, description);
}
