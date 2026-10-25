import { ticketsConfig } from '@maxwell/core/modules/tickets';
import { TicketStore } from '@maxwell/core/stores/tickets';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { namesOf } from '@/lib/people';
import { CLOSED_PAGE, loadDetail, ticketView } from './load';
import { TicketsView } from './tickets-view';

export const metadata: Metadata = { title: 'Tickets' };

export default async function TicketsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'tickets', ticketsConfig);
  const store = new TicketStore(db().sql);
  const [overview, open, closed, published] = await Promise.all([
    store.overview(guild),
    store.list(guild, { status: 'open', limit: 100 }),
    store.recentlyClosed(guild, { limit: CLOSED_PAGE + 1 }),
    store.panels(guild),
  ]);
  const openItems = open
    .map(ticketView)
    .sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));
  const closedItems = closed.slice(0, CLOSED_PAGE).map(ticketView);
  const first = openItems[0] ? await loadDetail(guild, openItems[0].id) : null;
  const names = await namesOf([
    ...openItems.flatMap((item) => [item.openerId, item.claimedBy]),
    ...closedItems.flatMap((item) => [item.openerId, item.closedBy]),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <TicketsView
        now={Date.now()}
        overview={overview}
        open={openItems}
        closed={closedItems}
        moreClosed={closed.length > CLOSED_PAGE}
        names={{ ...names, ...(first?.names ?? {}) }}
        first={first}
        saved={loaded.config}
        published={published.map((entry) => ({
          panelId: entry.panelId,
          channelId: entry.channelId,
        }))}
      />
    </ModuleShell>
  );
}
