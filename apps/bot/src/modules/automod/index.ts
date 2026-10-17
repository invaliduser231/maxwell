import type { Actor } from '@maxwell/core';
import definition from '@maxwell/core/modules/automod';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { defineBotModule } from '../../runtime/module.js';
import { gateCommand } from './commands.js';
import { Confirmations } from './confirm.js';
import { DryRunner, parseRule, replayGuild } from './dryrun.js';
import { Enforcer } from './enforce.js';
import { MessageHistory, toStored } from './history.js';
import { GuildLookup } from './lookup.js';
import { RuleEngine } from './rules.js';
import { RaidShield } from './shield.js';
import { HISTORY_DAYS } from './types.js';

const PURGE_EVERY = 60 * 60_000;
const MAX_MESSAGES_PER_GUILD = 100_000;
const HIT_RETENTION_DAYS = 180;
const DRYRUN_RETENTION_DAYS = 30;
const DAY = 86_400_000;

function purgeAt(at: number): { runAt: Date; dedupeKey: string } {
  return { runAt: new Date(at), dedupeKey: `automod.purge:${Math.floor(at / PURGE_EVERY)}` };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function texts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

function actor(value: unknown): Actor {
  return { id: text(value) ?? null };
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const { platform, log } = services;
    const store = new AutomodStore(services.sql);
    const engine = new RuleEngine();
    const history = new MessageHistory(store, log);
    const lookup = new GuildLookup(platform);
    const enforcer = new Enforcer(ctx, store);
    const shield = new RaidShield(ctx, store);
    const confirmations = new Confirmations(platform, services.voice.icons);
    const running = new Set<string>();

    ctx.privacy({
      export: (guildId, userId) => store.memberData(guildId, userId),
      forget: async (guildId, userId) => {
        await history.forget(guildId, userId);
        await store.forgetMember(guildId, userId);
      },
    });

    const once = async (id: string, work: () => Promise<void>) => {
      if (running.has(id)) return;
      running.add(id);
      try {
        await work();
      } finally {
        running.delete(id);
      }
    };

    ctx.on('message', async (message) => {
      const guildId = message.guildId;
      if (!guildId || message.author.id === platform.selfId) return;
      const config = await ctx.config(guildId);
      if (config.keepHistory) history.add(toStored(message, guildId));
      if (message.fromWebhook && config.ignoreBots) return;
      const [isMod, parentId] = await Promise.all([
        lookup.isMod(guildId, config.modRoleIds, message.memberRoles),
        lookup.parentOf(guildId, message.channelId),
      ]);
      const hits = engine.evaluate(
        config,
        {
          guildId,
          id: message.id,
          channelId: message.channelId,
          parentId,
          authorId: message.author.id,
          bot: message.author.bot || message.fromWebhook,
          roles: message.memberRoles,
          content: message.content,
          mentionUsers: new Set(message.mentionUsers).size,
          mentionRoles: new Set(message.mentionRoles).size,
          createdAt: message.createdAt,
        },
        isMod,
      );
      if (hits.length > 0) await enforcer.apply(message, guildId, config, hits);
    });

    ctx.on('messageEdit', async ({ message, before }) => {
      const guildId = message.guildId;
      if (!guildId || message.author.id === platform.selfId) return;
      if (before !== null && before === message.content) return;
      const config = await ctx.config(guildId);
      if (config.keepHistory) await history.edit(guildId, message.id, message.content);
      if (message.fromWebhook && config.ignoreBots) return;
      const [isMod, parentId] = await Promise.all([
        lookup.isMod(guildId, config.modRoleIds, message.memberRoles),
        lookup.parentOf(guildId, message.channelId),
      ]);
      const hits = engine.evaluate(
        config,
        {
          guildId,
          id: message.id,
          channelId: message.channelId,
          parentId,
          authorId: message.author.id,
          bot: message.author.bot || message.fromWebhook,
          roles: message.memberRoles,
          content: message.content,
          mentionUsers: new Set(message.mentionUsers).size,
          mentionRoles: new Set(message.mentionRoles).size,
          createdAt: message.createdAt,
        },
        isMod,
        { stateless: true },
      );
      if (hits.length > 0) await enforcer.apply(message, guildId, config, hits);
    });

    ctx.on('memberJoin', (join) => shield.onJoin(join));
    ctx.on('memberLeave', ({ guildId, userId }) => shield.onLeave(guildId, userId), {
      always: true,
    });
    ctx.on('memberUpdate', (update) => shield.onMemberUpdate(update));
    ctx.on('channelCreate', async (change) => {
      lookup.forgetChannels(change.guildId);
      await shield.onChannelCreate(change);
    });
    ctx.on('channelUpdate', ({ guildId }) => lookup.forgetChannels(guildId), { always: true });
    ctx.on('channelDelete', ({ guildId }) => lookup.forgetChannels(guildId), { always: true });
    ctx.on('roleCreate', ({ guildId }) => lookup.forgetRoles(guildId), { always: true });
    ctx.on('roleUpdate', ({ guildId }) => lookup.forgetRoles(guildId), { always: true });
    ctx.on('roleDelete', ({ guildId }) => lookup.forgetRoles(guildId), { always: true });
    ctx.on('reaction', (reaction) => confirmations.handle(reaction), { always: true });

    ctx.job('dryrun', async (job) => {
      const guildId = job.guildId;
      if (!guildId) return;
      const payload = job.payload;
      let runId = text(payload.runId);
      let ruleKey = text(payload.ruleKey);
      let ruleInput: unknown = payload.rule;
      if (runId) {
        const existing = await store.getDryRun(guildId, runId);
        if (!existing || existing.status === 'done') return;
        ruleKey = existing.ruleKey;
        ruleInput = existing.rule;
      }
      const config = await ctx.config(guildId);
      if (ruleKey && ruleInput === undefined) {
        ruleInput = (config.rules as Record<string, unknown>)[ruleKey];
      }
      const parsed = parseRule(ruleKey ?? '', ruleInput);
      if (!runId) {
        runId = await store.createDryRun(
          guildId,
          ruleKey ?? 'unknown',
          (parsed?.rule ?? {}) as Record<string, unknown>,
          text(payload.requestedBy) ?? text(payload.by) ?? null,
        );
      }
      const id = runId;
      if (!parsed) {
        await store.failDryRun(guildId, id, 'invalid rule');
        return;
      }
      await once(`dryrun:${id}`, async () => {
        await store.startDryRun(guildId, id);
        try {
          await history.flush();
          const [mods, parents] = await Promise.all([
            lookup.mods(guildId, config.modRoleIds),
            lookup.parents(guildId),
          ]);
          const runner = new DryRunner(parsed.key, parsed.rule, config, mods, parents);
          const result = await replayGuild(store, guildId, runner);
          await store.finishDryRun(guildId, id, result);
        } catch (error) {
          log.warn({ err: error, guild: guildId }, 'automod dry run failed');
          await store.failDryRun(guildId, id, 'replay failed');
        }
      });
    });

    ctx.job('gate.letin', async (job) => {
      const guildId = job.guildId;
      if (!guildId) return;
      await once(job.id, async () => {
        await shield.letIn(guildId, texts(job.payload.userIds), actor(job.payload.by));
      });
    });

    ctx.job('gate.banall', async (job) => {
      const guildId = job.guildId;
      if (!guildId) return;
      await once(job.id, async () => {
        await shield.banAll(guildId, texts(job.payload.userIds), actor(job.payload.by));
      });
    });

    ctx.job('gate.setup', async (job) => {
      const guildId = job.guildId;
      if (!guildId) return;
      await once(job.id, async () => {
        await shield.setupGate(guildId, actor(job.payload.by));
      });
    });

    ctx.job('lockdown.start', async (job) => {
      const guildId = job.guildId;
      if (!guildId) return;
      const config = await ctx.config(guildId);
      const minutes =
        typeof job.payload.minutes === 'number' && job.payload.minutes > 0
          ? Math.min(Math.round(job.payload.minutes), 1440)
          : config.raid.lockdownMinutes;
      await shield.startLockdown(guildId, 'manual', actor(job.payload.by), minutes);
    });

    ctx.job('lockdown.end', async (job) => {
      const guildId = job.guildId;
      if (!guildId) return;
      await shield.endLockdown(
        guildId,
        text(job.payload.incidentId) ?? null,
        actor(job.payload.by),
      );
    });

    ctx.job('purge', async () => {
      const now = Date.now();
      try {
        await history.flush();
        const removed = await store.purgeMessages(
          new Date(now - HISTORY_DAYS * DAY),
          MAX_MESSAGES_PER_GUILD,
        );
        await store.purgeHits(new Date(now - HIT_RETENTION_DAYS * DAY));
        await store.purgeDryRuns(new Date(now - DRYRUN_RETENTION_DAYS * DAY));
        let dropped = 0;
        for (const guildId of await store.messageGuilds()) {
          const keep = (await ctx.enabled(guildId)) && (await ctx.config(guildId)).keepHistory;
          if (!keep) dropped += await store.dropMessages(guildId);
        }
        if (removed + dropped > 0) log.info({ removed, dropped }, 'automod history purged');
      } finally {
        await ctx.schedule('purge', purgeAt(now + PURGE_EVERY));
      }
    });

    ctx.on(
      'ready',
      async () => {
        await ctx.schedule('purge', purgeAt(Date.now()));
      },
      { always: true },
    );

    ctx.undo('timeout', async (entry, payload) => {
      const userId = text(payload.userId);
      if (userId) await platform.timeout(entry.guildId, userId, null);
    });

    ctx.undo('ban', async (entry, payload) => {
      const userId = text(payload.userId);
      if (userId) await platform.unban(entry.guildId, userId);
    });

    ctx.undo('gate.unban', async (entry, payload) => {
      for (const userId of texts(payload.userIds) ?? []) {
        await platform
          .unban(entry.guildId, userId)
          .catch((error) => log.warn({ err: error, guild: entry.guildId }, 'unban failed'));
      }
    });

    ctx.undo('gate.rehold', async (entry, payload) => {
      const roleId = text(payload.roleId);
      if (roleId) await shield.rehold(entry.guildId, texts(payload.userIds) ?? [], roleId);
    });

    ctx.undo('gate.role', async (entry, payload) => {
      const roleId = text(payload.roleId);
      if (roleId) await platform.deleteRole(entry.guildId, roleId);
    });

    ctx.undo('lockdown', async (entry, payload, by) => {
      await shield.endLockdown(entry.guildId, text(payload.incidentId) ?? null, by);
    });

    history.start();
    ctx.onShutdown(async () => {
      confirmations.stop();
      await history.stop();
    });

    return [gateCommand(ctx, store, shield, confirmations)];
  },
});
