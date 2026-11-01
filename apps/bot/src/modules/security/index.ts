import type { Actor } from '@maxwell/core';
import definition, { shieldSources } from '@maxwell/core/modules/security';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { BackupStore } from '@maxwell/core/stores/backups';
import { IncidentStore } from '@maxwell/core/stores/incidents';
import { SecurityStore } from '@maxwell/core/stores/security';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { defineBotModule } from '../../runtime/module.js';
import { looksLikeAnswer } from './captcha.js';
import { registerCheck } from './check.js';
import { securityCommands } from './commands.js';
import { audit } from './copy.js';
import { registerDisputes } from './disputes.js';
import { Guard } from './guard.js';
import { Honeypot } from './honeypot.js';
import { IncidentRecorder } from './incidents.js';
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
    const backups = new BackupStore(services.sql);
    const incidents = new IncidentStore(services.sql);
    const recorder = new IncidentRecorder(ctx, incidents, store, automod, backups, guard);
    const safe = (work: Promise<unknown>) =>
      work.catch((error) => log.warn({ err: error }, 'security incident record failed'));
    raid.hooks = {
      recheck: (guildId, userIds) => verifier.recheck(guildId, userIds),
      started: (guildId, started, trigger, by) =>
        safe(recorder.raidStarted(guildId, started, trigger, by, raid.joins.recent(guildId, 0))),
      ended: (guildId, by) => safe(recorder.raidEnded(guildId, by)),
    };
    const nuke = new NukeWatch(ctx, store, backups, guard);
    nuke.hooks = { stopped: (guildId, report) => safe(recorder.nukeStopped(guildId, report)) };
    const honeypot = new Honeypot(ctx, store, guard);

    ctx.privacy({
      export: async (guildId, userId) => {
        const [data, report, incidentEvents] = await Promise.all([
          store.memberData(guildId, userId),
          new ShieldStore(services.sql).get(guildId, userId),
          incidents.memberData(guildId, userId),
        ]);
        const base =
          incidentEvents.length > 0 ? { ...(data ?? {}), incidents: incidentEvents } : data;
        if (!report) return base;
        const shield = {
          source: report.source,
          sharedAt: report.createdAt.toISOString(),
          expiresAt: report.expiresAt.toISOString(),
        };
        return { ...(base ?? {}), shield };
      },
      forget: async (guildId, userId) => {
        await store.forgetMember(guildId, userId);
        await incidents.forgetMember(guildId, userId);
      },
    });

    ctx.on('memberJoin', async (join) => {
      await raid.onJoin(join);
      await verifier.onJoin(join);
      await recorder.onJoin(join);
    });
    ctx.on('banAdd', (change) => recorder.onBan(change));
    ctx.on('messageRemove', (removal) => recorder.onRemoved(removal.guildId, 1));
    ctx.on('messageBulkRemove', (removal) =>
      recorder.onRemoved(removal.guildId, removal.ids.length),
    );
    ctx.on('channelCreate', (change) => recorder.onChannel('channelCreate', change));
    ctx.on('channelDelete', (change) => recorder.onChannel('channelDelete', change));
    ctx.on('roleCreate', (change) => recorder.onRole('roleCreate', change));
    ctx.on('roleDelete', (change) => recorder.onRole('roleDelete', change));
    ctx.on('banRemove', async ({ guildId, user }) => {
      await new ShieldStore(services.sql).withdraw(guildId, user.id);
    });
    ctx.on('memberLeave', ({ guildId, userId }) => verifier.onLeave(guildId, userId), {
      always: true,
    });
    ctx.on('memberUpdate', async (update) => {
      await verifier.onMemberUpdate(update);
      await honeypot.onMemberUpdate(update);
      await recorder.onMemberUpdate(update);
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

    ctx.on('auditLog', async (entry) => {
      await nuke.onAuditLog(entry);
      await recorder.onAuditLog(entry);
    });

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

    ctx.job('incident.check', (job) => recorder.check(job));

    ctx.job('incident.undo', (job) => recorder.undo(job));

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
        const shield = new ShieldStore(services.sql);
        const expired = (await shield.purge(now)) + (await shield.dropInactive());
        if (removed + expired > 0) log.info({ removed, expired }, 'security history purged');
      } finally {
        await ctx.schedule('purge', purgeAt(now + DAY));
      }
    });

    ctx.job('shield.remove', async (job) => {
      const userId = text(job.payload.userId);
      if (!job.guildId || !userId) return;
      const shield = new ShieldStore(services.sql);
      const report = await shield.get(job.guildId, userId);
      if (!report || !(await shield.withdraw(job.guildId, userId))) return;
      await ctx.record(job.guildId, actor(job.payload.by), 'shield.remove', audit.shieldRemoved, {
        before: { userId, source: report.source },
        undo: { kind: 'shield.remove', payload: { userId, source: report.source } },
      });
    });

    ctx.undo('shield.remove', async (entry, payload, by) => {
      const userId = text(payload.userId);
      const source = shieldSources.find((entry) => entry === payload.source);
      if (!userId || !source) return;
      await new ShieldStore(services.sql).report(entry.guildId, userId, source, by.id);
    });

    registerDisputes(ctx);

    ctx.undo('raid', async (entry, _payload, by) => {
      await raid.end(entry.guildId, by);
    });

    registerCheck(ctx);

    return securityCommands(ctx, store, verifier, raid, honeypot);
  },
});
