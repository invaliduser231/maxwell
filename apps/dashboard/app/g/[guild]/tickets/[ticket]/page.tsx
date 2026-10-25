import { ticketsConfig } from '@maxwell/core/modules/tickets';
import { TicketStore, TRANSCRIPT_LIMIT } from '@maxwell/core/stores/tickets';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/module-shell';
import { levelOf, requirePage } from '@/lib/access';
import { db } from '@/lib/db';
import { namesOf } from '@/lib/people';
import { padNumber } from '../format';
import { messageViews, textIds, ticketView } from '../load';
import { TranscriptView } from './transcript';

export const metadata: Metadata = { title: 'Transcript' };

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ guild: string; ticket: string }>;
}) {
  const { guild, ticket: ticketId } = await params;
  const access = await requirePage(guild, 'tickets');
  if (!/^\d{1,19}$/.test(ticketId)) notFound();
  const store = new TicketStore(db().sql);
  const ticket = await store.getInGuild(guild, ticketId);
  if (!ticket) notFound();
  const [rows, config] = await Promise.all([
    store.messages(ticket.id, { limit: TRANSCRIPT_LIMIT }),
    db().modules.get(guild, 'tickets', ticketsConfig),
  ]);
  const messages = messageViews(ticket, rows, config.modmail.internalMarker);
  const names = await namesOf(
    [ticket.openerId, ticket.claimedBy, ticket.closedBy, ...ticket.members, ...textIds(messages)],
    120,
  );
  const panelName =
    ticket.panelId === 'modmail'
      ? 'Modmail'
      : (config.panels.find((panel) => panel.id === ticket.panelId)?.name ?? ticket.panelId);

  return (
    <>
      <PageHeader title={`Ticket #${padNumber(ticket.number)}`} page="tickets" pole="north" />
      <TranscriptView
        ticket={ticketView(ticket)}
        messages={messages}
        names={names}
        now={Date.now()}
        panelName={panelName}
        canEdit={levelOf(access, 'tickets') === 'edit'}
      />
    </>
  );
}
