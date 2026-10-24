import { formsConfig } from '@maxwell/core/modules/forms';
import { ticketsConfig } from '@maxwell/core/modules/tickets';
import { FormStore } from '@maxwell/core/stores/forms';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { FormsView } from './forms-view';
import { loadSubmissions } from './load';

export const metadata: Metadata = { title: 'Forms' };

export default async function FormsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'forms', formsConfig);
  const store = new FormStore(db().sql);
  const [counts, times, waiting, decided, tickets, prefix] = await Promise.all([
    store.counts(guild),
    store.reviewTimes(guild),
    loadSubmissions(guild, { decided: false }),
    loadSubmissions(guild, { decided: true }),
    db().modules.get(guild, 'tickets', ticketsConfig),
    db().guilds.prefix(guild),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <FormsView
        now={Date.now()}
        prefix={prefix}
        counts={counts}
        times={times}
        waiting={waiting}
        decided={decided}
        ticketPanels={tickets.panels.map((panel) => ({ id: panel.id, name: panel.name }))}
      />
    </ModuleShell>
  );
}
