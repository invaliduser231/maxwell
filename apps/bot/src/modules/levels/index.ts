import definition, { levelFromXp } from '@maxwell/core/modules/levels';
import { EconomyStore } from '@maxwell/core/stores/economy';
import { LevelStore } from '@maxwell/core/stores/levels';
import { defineBotModule } from '../../runtime/module.js';
import { CardPager } from './board.js';
import { levelCommands } from './commands.js';
import { audit } from './copy.js';
import { parseImport, parseMode } from './importer.js';
import { LevelTracker } from './tracker.js';

const DAY = 24 * 60 * 60 * 1000;
const SNAPSHOT_KEEP = 8 * DAY;

function pruneKey(at: Date): string {
  return `levels.prune:${at.toISOString().slice(0, 10)}`;
}

function actorOf(payload: Record<string, unknown>): { id: string | null } {
  return { id: typeof payload.by === 'string' && /^\d+$/.test(payload.by) ? payload.by : null };
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { sql, log } = ctx.services;
    const store = new LevelStore(sql);
    const tracker = new LevelTracker(ctx, store);
    const pager = new CardPager(ctx.services.platform, ctx.services.voice.icons);

    ctx.on('message', (message) => tracker.onMessage(message));
    ctx.on('reaction', (reaction) => pager.onReaction(reaction));
    ctx.on('memberJoin', (join) => tracker.onJoin(join));

    ctx.job('import', async (job) => {
      if (!job.guildId) return;
      const config = await ctx.config(job.guildId);
      const parsed = parseImport(job.payload.entries ?? job.payload.data, config.curve);
      if (!parsed || parsed.entries.length === 0) {
        log.warn({ guild: job.guildId, job: job.id }, 'level import had no usable rows');
        return;
      }
      const result = await store.importEntries(
        job.guildId,
        parsed.entries,
        parseMode(job.payload.mode),
      );
      await ctx.record(job.guildId, actorOf(job.payload), 'xp.import', audit.import(result.count), {
        after: { rows: result.count, skipped: parsed.skipped, mode: parseMode(job.payload.mode) },
        undo: { kind: 'snapshot', payload: { snapshotId: result.snapshotId } },
      });
    });

    ctx.job('reset', async (job) => {
      if (!job.guildId) return;
      const result = await store.resetAll(job.guildId);
      await ctx.record(
        job.guildId,
        actorOf(job.payload),
        'xp.reset_all',
        audit.resetAll(result.count),
        {
          before: { rows: result.count },
          undo: { kind: 'snapshot', payload: { snapshotId: result.snapshotId } },
        },
      );
    });

    ctx.job('prune', async () => {
      const removed = await store.pruneSnapshots(new Date(Date.now() - SNAPSHOT_KEEP));
      if (removed) log.info({ removed }, 'old level snapshots removed');
      const next = new Date(Date.now() + DAY);
      await ctx.schedule('prune', { runAt: next, dedupeKey: pruneKey(next) });
    });

    ctx.undo('xp.set', async (entry, payload) => {
      const userId = String(payload.userId ?? '');
      if (!/^\d+$/.test(userId)) return;
      const xp = Math.max(0, Number(payload.xp) || 0);
      if (xp > 0) await store.set(entry.guildId, userId, xp);
      else await store.remove(entry.guildId, userId);
      await tracker.sync(entry.guildId, userId, xp);
    });

    ctx.undo('snapshot', async (entry, payload) => {
      await store.restore(entry.guildId, String(payload.snapshotId ?? ''));
    });

    ctx.on(
      'ready',
      async () => {
        await ctx.schedule('prune', { dedupeKey: pruneKey(new Date()) });
      },
      { always: true },
    );

    ctx.privacy({
      async export(guildId, userId) {
        const data = await store.memberData(guildId, userId);
        if (!data) return null;
        const config = await ctx.config(guildId);
        return {
          xp: data.xp,
          level: levelFromXp(data.xp, config.curve).level,
          rank: data.rank,
          lastXpAt: data.lastXpAt?.toISOString() ?? null,
          hiddenFromPublicPage: data.hiddenPublic,
        };
      },
      forget: (guildId, userId) => store.forget(guildId, userId),
    });

    return levelCommands(ctx, store, tracker, pager, new EconomyStore(sql));
  },
});
