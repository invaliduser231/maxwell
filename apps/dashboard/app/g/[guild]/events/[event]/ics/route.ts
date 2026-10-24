import { eventsConfig } from '@maxwell/core/modules/events';
import { EventStore, toIcs } from '@maxwell/core/stores/events';
import { db } from '@/lib/db';
import { viewer } from '@/lib/guard';

function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'event'}.ics`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ guild: string; event: string }> },
) {
  const { guild, event } = await context.params;
  if (!/^\d{1,20}$/.test(event)) return new Response(null, { status: 404 });
  const check = await viewer(guild, 'events');
  if ('error' in check) return new Response(null, { status: 403 });
  const { sql, modules } = db();
  const [row, config] = await Promise.all([
    new EventStore(sql).get(guild, event),
    modules.get(guild, 'events', eventsConfig),
  ]);
  if (!row) return new Response(null, { status: 404 });
  const body = toIcs(
    {
      id: row.id,
      title: row.title,
      description: row.description,
      startsAt: row.startsAt,
      durationMinutes: row.durationMinutes,
      timezone: row.timezone,
      recurrence: row.recurrence,
      location: row.location,
      status: row.status,
      sequence: row.sequence,
      updatedAt: row.updatedAt,
    },
    {
      domain: new URL(request.url).hostname,
      name: check.access.guild.name,
      defaultDurationMinutes: config.defaultDurationMinutes,
    },
  );
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName(row.title)}"`,
      'cache-control': 'private, no-store',
    },
  });
}
