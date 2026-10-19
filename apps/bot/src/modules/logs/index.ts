import definition, { logEventNames, logEvents } from '@maxwell/core/modules/logs';
import { z } from 'zod';
import { AuditAction, type AuditLogEvent, type UserRef } from '../../platform/types.js';
import { defineBotModule } from '../../runtime/module.js';
import { palette } from '../../ui/palette.js';
import { AuditTrail } from './audit.js';
import { type CachedMessage, MessageCache } from './cache.js';
import { routeFor } from './config.js';
import { copy } from './copy.js';
import {
  banEmbed,
  bulkEmbed,
  bulkTranscript,
  channelEmbed,
  deletedEmbed,
  editedEmbed,
  inviteEmbed,
  joinEmbed,
  kickEmbed,
  leaveEmbed,
  memberRolesEmbed,
  nicknameEmbed,
  type Person,
  personFromCache,
  personFromUser,
  roleDiff,
  roleEmbed,
  timeoutEmbed,
  voiceEmbed,
  withActor,
} from './embeds.js';
import { LogSender } from './sender.js';

const testPayload = z.object({ event: z.enum(logEvents) });

export const AUDIT_WAIT_MS = 2_500;

const roleActions = {
  create: AuditAction.RoleCreate,
  update: AuditAction.RoleUpdate,
  delete: AuditAction.RoleDelete,
} as const;

const channelActions = {
  create: AuditAction.ChannelCreate,
  update: AuditAction.ChannelUpdate,
  delete: AuditAction.ChannelDelete,
} as const;

const tracked = new Set<number>([
  ...Object.values(roleActions),
  ...Object.values(channelActions),
  AuditAction.MemberBanAdd,
  AuditAction.MemberBanRemove,
]);

function activeTimeout(until: Date | null, now = Date.now()): Date | null {
  return until && until.getTime() > now ? until : null;
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { platform, voice, log } = ctx.services;
    const cache = new MessageCache();
    const sender = new LogSender(ctx);
    const isSelf = (id: string | null | undefined) => !!id && id === platform.selfId;
    const trail = new AuditTrail();
    ctx.onShutdown(() => trail.stop());

    const auditFor = async (
      guildId: string,
      action: number,
      targetId: string,
    ): Promise<AuditLogEvent | null> => {
      const missing = await platform
        .missingBotPermissions(guildId, null, ['ViewAuditLog'])
        .catch(() => ['ViewAuditLog']);
      if (missing.length > 0) return null;
      return trail.wait(guildId, action, targetId, AUDIT_WAIT_MS);
    };

    ctx.privacy({
      forget: async (guildId, userId) => {
        cache.forgetAuthor(guildId, userId);
      },
    });

    ctx.on('auditLog', async (entry) => {
      if (!entry.targetId) return;
      if (entry.action === AuditAction.MemberKick) {
        const userId = entry.targetId;
        await sender.send(entry.guildId, 'kicks', {}, async () => ({
          embeds: [kickEmbed(userId, await platform.user(userId), entry)],
        }));
        return;
      }
      if (tracked.has(entry.action)) trail.add(entry);
    });

    ctx.on('message', (message) => {
      if (!message.guildId || isSelf(message.author.id)) return;
      cache.add(message);
    });

    ctx.on('messageEdit', async (edit) => {
      const { message } = edit;
      if (!message.guildId || isSelf(message.author.id)) return;
      const cached = cache.update(message);
      const before = edit.before ?? cached;
      if (before === null || before === message.content) return;
      await sender.send(
        message.guildId,
        'messageEdit',
        {
          channelId: message.channelId,
          roles: message.memberRoles,
          bot: message.author.bot || message.fromWebhook,
        },
        () => ({ embeds: [editedEmbed(edit, before)] }),
      );
    });

    ctx.on('messageRemove', async (removal) => {
      if (!removal.guildId) return;
      const cached = cache.take(removal.id);
      const authorId = removal.authorId ?? cached?.authorId ?? null;
      if (isSelf(authorId)) return;
      let user: UserRef | null = null;
      if (!cached && authorId) user = await platform.user(authorId);
      await sender.send(
        removal.guildId,
        'messageDelete',
        {
          channelId: removal.channelId,
          roles: cached?.roles,
          bot: cached?.bot ?? user?.bot ?? false,
        },
        () => {
          const person: Person | null = cached
            ? personFromCache(cached)
            : user
              ? personFromUser(user)
              : null;
          return {
            embeds: [
              deletedEmbed({
                messageId: removal.id,
                channelId: removal.channelId,
                authorId,
                person,
                content: removal.content ?? cached?.content ?? null,
                attachments: cached?.attachments ?? [],
              }),
            ],
          };
        },
      );
    });

    ctx.on('messageBulkRemove', async (removal) => {
      if (!removal.guildId) return;
      const known = removal.ids
        .map((id) => cache.take(id))
        .filter((entry): entry is CachedMessage => entry !== null && !isSelf(entry.authorId));
      await sender.send(
        removal.guildId,
        'messageBulkDelete',
        { channelId: removal.channelId },
        () => {
          const text = known.length ? bulkTranscript(known) : '';
          return {
            embeds: [bulkEmbed(removal.channelId, removal.ids.length, known.length)],
            files: text
              ? [{ name: copy.bulkFile, data: new TextEncoder().encode(text) }]
              : undefined,
          };
        },
      );
    });

    ctx.on('memberJoin', async (join) => {
      await sender.send(join.guildId, 'memberJoin', {}, async () => {
        const guild = await platform.guild(join.guildId);
        return {
          embeds: [
            joinEmbed({
              user: join.user,
              memberCount: guild?.memberCount ?? null,
              warnIcon: voice.icon('warn'),
            }),
          ],
        };
      });
    });

    ctx.on('memberLeave', async (leave) => {
      await sender.send(leave.guildId, 'memberLeave', {}, () => ({
        embeds: [leaveEmbed(leave.userId, leave.user)],
      }));
    });

    ctx.on('memberUpdate', async (update) => {
      const { before } = update;
      if (!before) return;
      const scope = { roles: update.roles };
      const { added, removed } = roleDiff(before.roles, update.roles);
      if (added.length || removed.length) {
        await sender.send(update.guildId, 'memberRoles', scope, () => {
          const embed = memberRolesEmbed(update.user, added, removed);
          return embed ? { embeds: [embed] } : null;
        });
      }
      if (before.nick !== update.nick) {
        await sender.send(update.guildId, 'nicknames', scope, () => ({
          embeds: [nicknameEmbed(update.user, before.nick, update.nick)],
        }));
      }
      const was = activeTimeout(before.timeoutUntil);
      const now = activeTimeout(update.timeoutUntil);
      if ((now && now.getTime() !== was?.getTime()) || (!now && was)) {
        await sender.send(update.guildId, 'timeouts', scope, () => ({
          embeds: [timeoutEmbed(update.user, now)],
        }));
      }
    });

    for (const [event, kind] of [
      ['roleCreate', 'create'],
      ['roleUpdate', 'update'],
      ['roleDelete', 'delete'],
    ] as const) {
      ctx.on(event, async (change) => {
        await sender.send(change.guildId, 'roles', {}, async () => {
          const embed = roleEmbed(kind, change);
          if (!embed) return null;
          const entry = await auditFor(change.guildId, roleActions[kind], change.roleId);
          return { embeds: [withActor(embed, entry)] };
        });
      });
    }

    for (const [event, kind] of [
      ['channelCreate', 'create'],
      ['channelUpdate', 'update'],
      ['channelDelete', 'delete'],
    ] as const) {
      ctx.on(event, async (change) => {
        await sender.send(
          change.guildId,
          'channels',
          { channelId: change.channel.id },
          async () => {
            const embed = channelEmbed(kind, change);
            if (!embed) return null;
            const entry = await auditFor(change.guildId, channelActions[kind], change.channel.id);
            return { embeds: [withActor(embed, entry)] };
          },
        );
      });
    }

    ctx.on('voiceUpdate', async (change) => {
      const channelId = change.channelId ?? change.before;
      const target = await sender.target(change.guildId, 'voice', { channelId });
      if (!target) return;
      const member = await platform.member(change.guildId, change.userId);
      const config = await ctx.config(change.guildId);
      if (member?.roles.some((role) => config.ignoredRoleIds.includes(role))) return;
      const embed = voiceEmbed({
        userId: change.userId,
        person: member ? personFromUser(member.user) : null,
        channelId: change.channelId,
        before: change.before,
      });
      if (embed) await sender.deliver(change.guildId, target, { embeds: [embed] });
    });

    for (const [event, kind] of [
      ['inviteCreate', 'create'],
      ['inviteDelete', 'delete'],
    ] as const) {
      ctx.on(event, async (change) => {
        await sender.send(change.guildId, 'invites', { channelId: change.channelId }, () => ({
          embeds: [inviteEmbed(kind, change)],
        }));
      });
    }

    for (const [event, kind, action] of [
      ['banAdd', 'ban', AuditAction.MemberBanAdd],
      ['banRemove', 'unban', AuditAction.MemberBanRemove],
    ] as const) {
      ctx.on(event, async (ban) => {
        await sender.send(ban.guildId, 'bans', {}, async () => {
          const entry = await auditFor(ban.guildId, action, ban.user.id);
          return { embeds: [withActor(banEmbed(kind, ban.user), entry)] };
        });
      });
    }

    ctx.job('test', async (job) => {
      const guildId = job.guildId;
      const parsed = testPayload.safeParse(job.payload);
      if (!guildId || !parsed.success) return;
      const config = await ctx.config(guildId);
      const channelId = routeFor(config, parsed.data.event);
      if (!channelId) {
        log.info({ guild: guildId, event: parsed.data.event }, 'log test without a channel');
        return;
      }
      await sender.deliver(guildId, channelId, {
        embeds: [
          {
            color: palette.south,
            title: logEventNames[parsed.data.event],
            description: copy.testNote,
            timestamp: new Date(),
          },
        ],
      });
    });
  },
});
