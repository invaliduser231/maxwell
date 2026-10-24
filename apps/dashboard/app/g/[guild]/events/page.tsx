import { generalConfig } from '@maxwell/core';
import { eventsConfig } from '@maxwell/core/modules/events';
import { type EventRow, EventStore, nextOccurrence, PollStore } from '@maxwell/core/stores/events';
import { resolveTimezone, toLocal } from '@maxwell/core/stores/scheduler';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { EventsView, type EventView, type Occurrence, type PollView } from './events-view';
import { isoDate, mondayOf, parseIsoDate, weekBounds } from './time';

export const metadata: Metadata = { title: 'Events and polls' };

const GOING_SHOWN = 12;

function occurrences(row: EventRow, from: number, to: number): number[] {
  const start = row.startsAt.getTime();
  if (row.recurrence === 'none' || row.status !== 'scheduled') {
    return start >= from && start < to ? [start] : [];
  }
  const out: number[] = [];
  const anchor = row.anchorAt.getTime();
  let at: number | null =
    start >= from ? start : nextOccurrence(anchor, row.timezone, row.recurrence, from - 1);
  while (at !== null && at < to && out.length < 31) {
    if (at >= start) out.push(at);
    at = nextOccurrence(anchor, row.timezone, row.recurrence, at);
  }
  return out;
}

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<{ week?: string; event?: string }>;
}) {
  const { guild } = await params;
  const query = await searchParams;
  const loaded = await loadModule(guild, 'events', eventsConfig);
  const { sql, modules } = db();
  const general = await modules.get(guild, 'general', generalConfig);
  const timezone = resolveTimezone(loaded.config.timezone, general.timezone);
  const now = Date.now();
  const monday = mondayOf(parseIsoDate(query.week) ?? toLocal(now, timezone));
  const { from, to } = weekBounds(monday, timezone);

  const events = new EventStore(sql);
  const polls = new PollStore(sql);
  const [rows, pollRows] = await Promise.all([
    events.between(guild, new Date(from), new Date(to)),
    polls.list(guild, { limit: 8 }),
  ]);
  const list = [...rows];
  if (query.event && !list.some((row) => row.id === query.event)) {
    const extra = await events.get(guild, query.event);
    if (extra && extra.status !== 'cancelled') list.push(extra);
  }

  const [counts, going, results] = await Promise.all([
    events.rsvpCountsFor(list),
    Promise.all(list.map((row) => events.rsvpUsers(row, 'going', GOING_SHOWN))),
    Promise.all(pollRows.map((poll) => polls.results(poll))),
  ]);
  const names = await people(going.flat());

  const views: EventView[] = list.map((row, index) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    recurrence: row.recurrence,
    location: row.location,
    voiceChannelId: row.voiceChannelId,
    channelId: row.channelId,
    pingRoleId: row.pingRoleId,
    posted: row.messageId !== null,
    status: row.status,
    counts: counts.get(row.id) ?? { going: 0, maybe: 0, no: 0 },
    going: (going[index] ?? []).map((id) => {
      const person = personOf(names, id);
      return { id, name: person.name, avatar: person.avatar };
    }),
  }));

  const slots: Occurrence[] = list
    .flatMap((row) =>
      occurrences(row, from, to).map((at) => ({
        eventId: row.id,
        at: new Date(at).toISOString(),
        current: at === row.startsAt.getTime(),
      })),
    )
    .sort((a, b) => a.at.localeCompare(b.at));

  const pollViews: PollView[] = pollRows.map((poll, index) => ({
    id: poll.id,
    number: poll.number,
    question: poll.question,
    options: poll.options,
    status: poll.status,
    anonymous: poll.anonymous,
    multiple: poll.multiple,
    endsAt: poll.endsAt?.toISOString() ?? null,
    counts: results[index]?.counts ?? poll.options.map(() => 0),
    voters: results[index]?.voters ?? 0,
  }));

  const selected =
    (query.event && views.some((view) => view.id === query.event) ? query.event : null) ??
    slots.find((slot) => Date.parse(slot.at) >= now)?.eventId ??
    slots[0]?.eventId ??
    null;

  return (
    <ModuleShell {...loaded.shell}>
      <EventsView
        key={`${isoDate(monday)}:${selected ?? 'new'}`}
        now={now}
        timezone={timezone}
        week={isoDate(monday)}
        events={views}
        slots={slots}
        selected={selected}
        polls={pollViews}
        enabled={loaded.enabled}
      />
    </ModuleShell>
  );
}
