'use server';

import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { viewer } from '@/lib/guard';
import type { Names } from '@/lib/people';
import { type Detail, loadClosed, loadDetail, type TicketView } from './load';

const id = z.string().regex(/^\d{1,21}$/);

export async function fetchTicket(guildId: string, ticketId: string): Promise<Result<Detail>> {
  const check = await viewer(guildId, 'tickets');
  if ('error' in check) return { ok: false, error: check.error };
  if (!id.safeParse(ticketId).success) return { ok: false, error: 'Unknown ticket.' };
  const detail = await loadDetail(guildId, ticketId);
  if (!detail) return { ok: false, error: 'That ticket is gone.' };
  return { ok: true, data: detail };
}

export async function fetchClosed(
  guildId: string,
  offset: number,
): Promise<Result<{ items: TicketView[]; names: Names; more: boolean }>> {
  const check = await viewer(guildId, 'tickets');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = z.number().int().min(0).max(100_000).safeParse(offset);
  if (!parsed.success) return { ok: false, error: 'Invalid page.' };
  return { ok: true, data: await loadClosed(guildId, parsed.data) };
}

export async function sendReply(
  guildId: string,
  ticketId: string,
  content: string,
): Promise<Result> {
  if (!id.safeParse(ticketId).success) return { ok: false, error: 'Unknown ticket.' };
  const text = content.trim();
  if (!text) return { ok: false, error: 'Write something first.' };
  if (text.length > 2000) return { ok: false, error: 'Keep it under 2,000 characters.' };
  return runAction(guildId, 'tickets', 'reply', { ticketId, content: text });
}

export async function claimTicket(
  guildId: string,
  ticketId: string,
  release: boolean,
): Promise<Result> {
  if (!id.safeParse(ticketId).success) return { ok: false, error: 'Unknown ticket.' };
  return runAction(
    guildId,
    'tickets',
    'claim',
    release ? { ticketId, userId: null } : { ticketId },
  );
}

export async function addTicketMember(
  guildId: string,
  ticketId: string,
  input: string,
): Promise<Result> {
  if (!id.safeParse(ticketId).success) return { ok: false, error: 'Unknown ticket.' };
  const userId = /^<@!?(\d{1,21})>$/.exec(input.trim())?.[1] ?? input.trim();
  if (!id.safeParse(userId).success) return { ok: false, error: 'Paste a user ID or mention.' };
  return runAction(guildId, 'tickets', 'member.add', { ticketId, userId });
}

export async function closeTicket(
  guildId: string,
  ticketId: string,
  reason: string,
): Promise<Result> {
  if (!id.safeParse(ticketId).success) return { ok: false, error: 'Unknown ticket.' };
  const text = reason.trim().slice(0, 500);
  return runAction(guildId, 'tickets', 'close', { ticketId, reason: text || null });
}

export async function reopenTicket(guildId: string, ticketId: string): Promise<Result> {
  if (!id.safeParse(ticketId).success) return { ok: false, error: 'Unknown ticket.' };
  return runAction(guildId, 'tickets', 'reopen', { ticketId });
}
