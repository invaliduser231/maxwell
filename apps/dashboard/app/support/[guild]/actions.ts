'use server';

import { enqueue } from '@maxwell/core';
import { TicketStore } from '@maxwell/core/stores/tickets';
import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { getSession, sessionGuilds } from '@/lib/session';
import { supportPanels } from './data';

const input = z.object({
  panelId: z.string().min(1).max(64),
  subject: z.string().trim().max(200),
  body: z.string().trim().min(10).max(2_000),
});

export async function sendTicket(guildId: string, values: z.input<typeof input>): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Sign in again.' };
  const parsed = input.safeParse(values);
  if (!parsed.success) return { ok: false, error: 'Write between 10 and 2,000 characters.' };
  if (!/^\d{1,21}$/.test(guildId)) return { ok: false, error: 'Unknown community.' };
  const panels = await supportPanels(guildId);
  const panel = panels?.find((entry) => entry.id === parsed.data.panelId);
  if (!panel) return { ok: false, error: 'This community does not take tickets on the web.' };
  const guilds = await sessionGuilds();
  if (!guilds?.some((entry) => entry.id === guildId)) {
    return { ok: false, error: 'Only members can open tickets here.' };
  }
  const userId = session.user.id;
  const open = await new TicketStore(db().sql).openFor(guildId, userId, panel.id);
  if (open.length >= panel.maxOpenPerMember) {
    return { ok: false, error: 'You already have an open ticket for this.' };
  }
  await enqueue(db().sql, {
    kind: 'tickets.web.open',
    guildId,
    payload: {
      userId,
      panelId: panel.id,
      subject: parsed.data.subject || null,
      body: parsed.data.body,
    },
    dedupeKey: `tickets.web.open:${guildId}:${userId}:${panel.id}`,
  });
  return { ok: true };
}
