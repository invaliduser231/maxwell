import type { Actor } from '@maxwell/core';
import definition from '@maxwell/core/modules/security';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { BackupStore } from '@maxwell/core/stores/backups';
import { SecurityStore } from '@maxwell/core/stores/security';
import { defineBotModule } from '../../runtime/module.js';
import { looksLikeAnswer } from './captcha.js';
import { securityCommands } from './commands.js';
import { Guard } from './guard.js';
import { Honeypot } from './honeypot.js';
import { NukeWatch } from './nuke.js';
import { RaidWatch } from './raid.js';
import { Verifier, verifyInboxFor } from './verification.js';

const DAY = 86_400_000;
const RETENTION_DAYS = 90;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function actor(value: unknown): Actor {
  return { id: text(value) };
}

function purgeAt(at: number): { runAt: Date; dedupeKey: string } {
  return { runAt: new Date(at), dedupeKey: `security.purge:${Math.floor(at / DAY)}` };
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const { platform, log } = services;
    const store = new SecurityStore(services.sql);
    const automod = new AutomodStore(services.sql);
    const guard = new Guard(ctx, automod);
    const raid = new RaidWatch(ctx, store, automod, guard);
    const inbox = verifyInboxFor(services);
    const verifier = new Verifier(ctx, store, guard, raid, inbox);
    raid.hooks = { recheck: (guildId, userIds) => verifier.recheck(guildId, userIds) };
    const nuke = new NukeWatch(ctx, store, new BackupStore(services.sql), guard);
    const honeypot = new Honeypot(ctx, store, guard);

    ctx.privacy({
      export: (guildId, userId) => store.memberData(guildId, userId),
      forget: (guildId, userId) => store.forgetMember(guildId, userId),
    });

    ctx.on('memberJoin', async (join) => {
      await raid.onJoin(join);
      await verifier.onJoin(join);
    });
    ctx.on('memberLeave', ({ guildId, userId }) => verifier.onLeave(guildId, userId), {
      always: true,
    });
    ctx.on('memberUpdate', async (update) => {
      await verifier.onMemberUpdate(update);
      await honeypot.onMemberUpdate(update);
    });

    ctx.on(
      'message',
      async (message) => {
        if (message.author.bot || message.fromWebhook) return;
        if (message.guildId) return;
        if (!inbox.has(message.author.id)) return;
        const prefix = await services.guilds.prefix(null);
        if (message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;
        await verifier.answer(message.author.id, message.content, null, (content) =>
          platform.reply(message, content),
        );
      },
      { always: true },
    );

    ctx.on('message', async (message) => {
      const guildId = message.guildId;
      if (!guildId || message.author.bot || message.fromWebhook) return;
      if (await honeypot.onMessage(message)) return;
      if (inbox.has(message.author.id) && looksLikeAnswer(message.content)) {
        const handled = await verifier.answer(
          message.author.id,
          message.content,
          guildId,
          (content) => platform.send(message.channelId, { content, deleteAfter: 15_000 }),
        );
        if (handled) {
          await platform.delete(message.channelId, message.id).catch(() => {});
          return;
        }
      }
      await raid.onMessage(message);
    });

    ctx.on('auditLog', (entry) => nuke.onAuditLog(entry));

    ctx.on(
      'ready',
      async () => {
        await verifier
          .load(platform.guildIds())
          .catch((error) => log.warn({ err: error }, 'security inbox load failed'));
        await ctx.schedule('purge', purgeAt(Date.now() + 60_000));
      },
      { always: true },
    );

    ctx.job('verify.expire', (job) => verifier.expire(job));

    ctx.job('raid.end', async (job) => {
      if (!job.guildId) return;
      await raid.end(job.guildId, actor(job.payload.by), text(job.payload.raidId));
    });

    ctx.job('raid.start', async (job) => {
      if (!job.guildId) return;
      const by = actor(job.payload.by);
      await raid.start(job.guildId, { kind: 'manual', userId: by.id }, by);
    });

    ctx.job('raid.stop', async (job) => {
      if (!job.guildId) return;
      await raid.end(job.guildId, actor(job.payload.by));
    });

    ctx.job('pass', async (job) => {
      const userId = text(job.payload.userId);
      if (!job.guildId || !userId) return;
      await verifier.pass(job.guildId, userId, text(job.payload.by));
    });

    ctx.job('honeypot.setup', async (job) => {
      if (!job.guildId) return;
      await honeypot.setup(job.guildId, actor(job.payload.by));
    });

    ctx.job('gate.setup', async (job) => {
      if (!job.guildId) return;
      await services.jobs.enqueue({
        kind: 'automod.gate.setup',
        guildId: job.guildId,
        payload: { by: text(job.payload.by) },
      });
    });

    ctx.job('purge', async () => {
      const now = Date.now();
      try {
        const removed = await store.purge(new Date(now - RETENTION_DAYS * DAY));
        if (removed > 0) log.info({ removed }, 'security history purged');
      } finally {
        await ctx.schedule('purge', purgeAt(now + DAY));
      }
    });

    ctx.undo('raid', async (entry, _payload, by) => {
      await raid.end(entry.guildId, by);
    });

    return securityCommands(ctx, store, verifier, raid, honeypot);
  },
});
