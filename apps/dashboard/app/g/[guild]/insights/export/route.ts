import { InsightsStore, utcDay } from '@maxwell/core/stores/insights';
import { voteBlocked } from '@/lib/access';
import { db } from '@/lib/db';
import { viewer } from '@/lib/guard';

const DAY = 86_400_000;

export async function GET(request: Request, context: { params: Promise<{ guild: string }> }) {
  const { guild } = await context.params;
  const check = await viewer(guild, 'insights');
  if ('error' in check || voteBlocked(check.access, 'insights')) {
    return new Response('Not allowed', { status: 403 });
  }
  const param = new URL(request.url).searchParams.get('range');
  const days = param === '7' ? 7 : param === '90' ? 90 : 30;
  const to = new Date((Math.floor(Date.now() / DAY) + 1) * DAY);
  const range = { from: new Date(to.getTime() - days * DAY), to };
  const store = new InsightsStore(db().sql);
  const [messages, flow, active, voice] = await Promise.all([
    store.messages(guild, range, 'day', 'UTC'),
    store.memberFlow(guild, range),
    store.activeMembers(guild, range),
    store.voiceMinutes(guild, range),
  ]);
  const byDay = new Map(messages.map((point) => [point.at, point.messages]));
  const flowByDay = new Map(flow.map((row) => [row.day, row]));
  const activeByDay = new Map(active.map((row) => [row.day, row.count]));
  const voiceByDay = new Map(voice.map((row) => [row.day, row.count]));
  const lines = ['date,messages,active_members,joins,leaves,voice_minutes'];
  for (let index = 0; index < days; index++) {
    const day = utcDay(new Date(range.from.getTime() + index * DAY));
    lines.push(
      [
        day,
        byDay.get(day) ?? 0,
        activeByDay.get(day) ?? 0,
        flowByDay.get(day)?.joins ?? 0,
        flowByDay.get(day)?.leaves ?? 0,
        voiceByDay.get(day) ?? 0,
      ].join(','),
    );
  }
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="insights-${guild}-${days}d.csv"`,
      'cache-control': 'no-store',
    },
  });
}
