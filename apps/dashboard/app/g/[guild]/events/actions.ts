'use server';

import { generalConfig } from '@maxwell/core';
import { eventsConfig, recurrences } from '@maxwell/core/modules/events';
import {
  EventStore,
  POLL_OPTION_LIMIT,
  type PollStatus,
  PollStore,
} from '@maxwell/core/stores/events';
import { fromLocal, parseLocalDateTime, resolveTimezone } from '@maxwell/core/stores/scheduler';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor, viewer } from '@/lib/guard';

const snowflake = z.string().regex(/^\d{1,21}$/);
const recordId = z.string().regex(/^\d{1,20}$/);

const eventSchema = z.object({
  id: recordId.nullable(),
  title: z.string().trim().min(1, 'Give the event a title.').max(200, 'The title is too long.'),
  description: z.string().trim().max(2_000, 'The description is too long.'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a start time.'),
  durationMinutes: z.number().int().min(5).max(10_080).nullable(),
  recurrence: z.enum(recurrences),
  location: z.string().trim().max(200, 'The location is too long.').nullable(),
  voiceChannelId: snowflake.nullable(),
  channelId: snowflake.nullable(),
  pingRoleId: snowflake.nullable(),
});

export type EventDraft = z.input<typeof eventSchema>;

const pollSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(250, 'The question is too long.'),
  options: z
    .array(z.string().trim().min(1, 'Fill in every option.').max(100, 'An option is too long.'))
    .min(2, 'Add at least two options.')
    .max(POLL_OPTION_LIMIT, `At most ${POLL_OPTION_LIMIT} options.`),
  anonymous: z.boolean(),
  multiple: z.boolean(),
  channelId: snowflake.nullable(),
  durationMinutes: z.number().int().min(0).max(43_200),
});

export type PollDraft = z.input<typeof pollSchema>;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the fields.';
}

async function timezoneOf(guildId: string): Promise<string> {
  const { modules } = db();
  const [config, general] = await Promise.all([
    modules.get(guildId, 'events', eventsConfig),
    modules.get(guildId, 'general', generalConfig),
  ]);
  return resolveTimezone(config.timezone, general.timezone);
}

export async function saveEvent(
  guildId: string,
  draft: EventDraft,
): Promise<Result<{ id: string; startsAt: string }>> {
  const check = await editor(guildId, 'events');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = eventSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const local = parseLocalDateTime(input.start);
  if (!local) return { ok: false, error: 'Pick a start time.' };
  const timezone = await timezoneOf(guildId);
  const startsAt = new Date(fromLocal(local, timezone));
  const fields = {
    title: input.title,
    description: input.description,
    durationMinutes: input.durationMinutes,
    recurrence: input.recurrence,
    voiceChannelId: input.voiceChannelId,
    location: input.voiceChannelId ? null : input.location || null,
    channelId: input.channelId,
    pingRoleId: input.pingRoleId,
  };
  const { sql, audit } = db();
  const store = new EventStore(sql);
  const actor = { id: check.access.user.id };

  if (input.id === null) {
    if (startsAt.getTime() < Date.now() - 60_000) {
      return { ok: false, error: 'Pick a time in the future.' };
    }
    const row = await store.create({
      guildId,
      ...fields,
      startsAt,
      timezone,
      createdBy: check.access.user.id,
    });
    await audit.record({
      guildId,
      actor,
      module: 'events',
      action: 'event.create',
      summary: `Created the event ${row.title}`,
      after: { id: row.id, title: row.title, startsAt: row.startsAt, recurrence: row.recurrence },
      undo: { kind: 'events.event.cancel', payload: { eventId: row.id } },
    });
    await runAction(guildId, 'events', 'publish', { eventId: row.id });
    revalidatePath(`/g/${guildId}/events`);
    return { ok: true, data: { id: row.id, startsAt: row.startsAt.toISOString() } };
  }

  const current = await store.get(guildId, input.id);
  if (!current || current.status === 'cancelled') {
    return { ok: false, error: 'That event is gone.' };
  }
  const moved = startsAt.getTime() !== current.startsAt.getTime();
  if (moved && startsAt.getTime() < Date.now() - 60_000) {
    return { ok: false, error: 'Pick a time in the future.' };
  }
  const row = await store.update(guildId, input.id, {
    ...fields,
    ...(moved ? { startsAt, timezone } : {}),
  });
  if (!row) return { ok: false, error: 'That event is gone.' };
  await audit.record({
    guildId,
    actor,
    module: 'events',
    action: 'event.update',
    summary: `Changed the event ${row.title}`,
    before: {
      title: current.title,
      startsAt: current.startsAt,
      durationMinutes: current.durationMinutes,
      recurrence: current.recurrence,
      location: current.location,
      voiceChannelId: current.voiceChannelId,
      channelId: current.channelId,
      pingRoleId: current.pingRoleId,
    },
    after: {
      title: row.title,
      startsAt: row.startsAt,
      durationMinutes: row.durationMinutes,
      recurrence: row.recurrence,
      location: row.location,
      voiceChannelId: row.voiceChannelId,
      channelId: row.channelId,
      pingRoleId: row.pingRoleId,
    },
    undo: null,
  });
  await runAction(guildId, 'events', 'publish', { eventId: row.id });
  revalidatePath(`/g/${guildId}/events`);
  return { ok: true, data: { id: row.id, startsAt: row.startsAt.toISOString() } };
}

export async function cancelEvent(guildId: string, eventId: string): Promise<Result> {
  const check = await editor(guildId, 'events');
  if ('error' in check) return { ok: false, error: check.error };
  if (!recordId.safeParse(eventId).success) return { ok: false, error: 'That event is gone.' };
  const { sql, audit } = db();
  const store = new EventStore(sql);
  const current = await store.get(guildId, eventId);
  if (current?.status !== 'scheduled') return { ok: false, error: 'That event is not running.' };
  const row = await store.setStatus(guildId, eventId, 'cancelled');
  if (!row) return { ok: false, error: 'That event is gone.' };
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'events',
    action: 'event.cancel',
    summary: `Cancelled the event ${row.title}`,
    before: { status: 'scheduled' },
    after: { status: 'cancelled' },
    undo: { kind: 'events.event.restore', payload: { eventId: row.id } },
  });
  await runAction(guildId, 'events', 'publish', { eventId: row.id });
  revalidatePath(`/g/${guildId}/events`);
  return { ok: true };
}

export async function createPoll(
  guildId: string,
  draft: PollDraft,
): Promise<Result<{ id: string }>> {
  const check = await editor(guildId, 'events');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = pollSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const lowered = input.options.map((option) => option.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    return { ok: false, error: 'Two options are the same.' };
  }
  const { sql, audit } = db();
  const poll = await new PollStore(sql).create({
    guildId,
    question: input.question,
    options: input.options,
    anonymous: input.anonymous,
    multiple: input.multiple,
    endsAt:
      input.durationMinutes > 0 ? new Date(Date.now() + input.durationMinutes * 60_000) : null,
    channelId: input.channelId,
    createdBy: check.access.user.id,
  });
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'events',
    action: 'poll.create',
    summary: `Started the poll ${poll.question}`,
    after: { id: poll.id, question: poll.question, options: poll.options },
    undo: { kind: 'events.poll.cancel', payload: { pollId: poll.id } },
  });
  const queued = await runAction(guildId, 'events', 'poll.publish', { pollId: poll.id });
  if (!queued.ok) return queued;
  return { ok: true, data: { id: poll.id } };
}

export async function pollStatus(guildId: string, pollId: string): Promise<Result<PollStatus>> {
  const check = await viewer(guildId, 'events');
  if ('error' in check) return { ok: false, error: check.error };
  if (!recordId.safeParse(pollId).success) return { ok: false, error: 'That poll is gone.' };
  const poll = await new PollStore(db().sql).get(guildId, pollId);
  if (!poll) return { ok: false, error: 'That poll is gone.' };
  return { ok: true, data: poll.status };
}

export async function deleteDraftPoll(guildId: string, pollId: string): Promise<Result> {
  const check = await editor(guildId, 'events');
  if ('error' in check) return { ok: false, error: check.error };
  if (!recordId.safeParse(pollId).success) return { ok: false, error: 'That poll is gone.' };
  const { sql, audit } = db();
  const store = new PollStore(sql);
  const poll = await store.get(guildId, pollId);
  if (poll?.status !== 'draft') return { ok: false, error: 'Only unposted polls can be deleted.' };
  await store.remove(guildId, pollId);
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'events',
    action: 'poll.delete',
    summary: `Deleted the unposted poll ${poll.question}`,
    before: { id: poll.id, question: poll.question, options: poll.options },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/events`);
  return { ok: true };
}
