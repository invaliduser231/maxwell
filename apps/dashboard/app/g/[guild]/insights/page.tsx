import { generalConfig } from '@maxwell/core';
import { insightsConfig } from '@maxwell/core/modules/insights';
import { InsightsStore, utcDay } from '@maxwell/core/stores/insights';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { InsightsView, type RangeDays } from './insights-view';

export const metadata: Metadata = { title: 'Insights' };

const DAY = 86_400_000;
const WEEKS = 8;
const RETENTION_DAYS = 90;

function rangeOf(value: string | undefined): RangeDays {
  return value === '7' ? 7 : value === '90' ? 90 : 30;
}

function moderationAction(action: string): boolean {
  return !action.startsWith('config.') && !action.startsWith('module.');
}

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { guild } = await params;
  const days = rangeOf((await searchParams).range);
  const loaded = await loadModule(guild, 'insights', insightsConfig);
  const { sql, modules } = db();
  const store = new InsightsStore(sql);
  const general = await modules.get(guild, 'general', generalConfig);
  const timezone = general.timezone;

  const now = Date.now();
  const to = new Date((Math.floor(now / DAY) + 1) * DAY);
  const current = { from: new Date(to.getTime() - days * DAY), to };
  const previous = { from: new Date(current.from.getTime() - days * DAY), to: current.from };
  const weeks = { from: new Date(to.getTime() - WEEKS * 7 * DAY), to };
  const retentionRange = { from: new Date(to.getTime() - RETENTION_DAYS * DAY), to };

  const [summary, before, messages, flow, active, channels, heat, load, retention] =
    await Promise.all([
      store.summary(guild, current),
      store.summary(guild, previous),
      store.messages(guild, current, 'day', 'UTC'),
      store.memberFlow(guild, current),
      store.activeMembers(guild, current),
      store.topChannels(guild, current, 6),
      store.heatmap(guild, current, timezone),
      store.moderationLoad(guild, weeks),
      store.inviteRetention(guild, retentionRange, 25),
    ]);
  const names = await people(retention.map((row) => row.inviterId));

  const byDay = new Map(messages.map((point) => [point.at, point.messages]));
  const flowByDay = new Map(flow.map((row) => [row.day, row]));
  const activeByDay = new Map(active.map((row) => [row.day, row.count]));
  const series = Array.from({ length: days }, (_, index) => {
    const day = utcDay(new Date(current.from.getTime() + index * DAY));
    return {
      day,
      messages: byDay.get(day) ?? 0,
      joins: flowByDay.get(day)?.joins ?? 0,
      leaves: flowByDay.get(day)?.leaves ?? 0,
      active: activeByDay.get(day) ?? 0,
    };
  });

  const weekly = Array.from({ length: WEEKS }, (_, index) => ({
    start: utcDay(new Date(weeks.from.getTime() + index * 7 * DAY)),
    total: 0,
    automod: 0,
  }));
  for (const row of load) {
    if (!moderationAction(row.action)) continue;
    const at = Date.parse(`${row.day}T00:00:00Z`);
    const index = Math.floor((at - weeks.from.getTime()) / (7 * DAY));
    const bucket = weekly[index];
    if (!bucket) continue;
    bucket.total += row.count;
    if (row.module === 'automod') bucket.automod += row.count;
  }

  return (
    <ModuleShell {...loaded.shell}>
      <InsightsView
        days={days}
        timezone={timezone}
        stats={{
          active: [summary.activeMembers, before.activeMembers],
          messages: [summary.messages, before.messages],
          joins: [summary.joins, before.joins],
          leaves: [summary.leaves, before.leaves],
        }}
        series={series}
        channels={channels.map((row) => ({ channelId: row.channelId, count: row.count }))}
        heat={heat.map((cell) => ({
          weekday: cell.weekday,
          hour: cell.hour,
          messages: cell.messages,
        }))}
        weeks={weekly}
        retention={retention.map((row) => ({
          code: row.inviteCode,
          inviter: row.inviterId ? personOf(names, row.inviterId).name : null,
          joins: row.joins,
          eligible7: row.eligible7,
          stayed7: row.stayed7,
          eligible30: row.eligible30,
          stayed30: row.stayed30,
          active30: row.active30,
        }))}
      />
    </ModuleShell>
  );
}
