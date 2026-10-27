import { giveawaysConfig } from '@maxwell/core/modules/giveaways';
import { GiveawayStore } from '@maxwell/core/stores/giveaways';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { GiveawaysView } from './giveaways-view';

export const generateMetadata = titled('Giveaways');

export default async function GiveawaysPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'giveaways', giveawaysConfig);
  const store = new GiveawayStore(db().sql);
  const [active, history] = await Promise.all([
    store.activeWithEntries(guild),
    store.history(guild, 10),
  ]);
  const winners = await people(history.flatMap((item) => item.winnerIds.slice(0, 3)));

  return (
    <ModuleShell {...loaded.shell}>
      <GiveawaysView
        now={Date.now()}
        host={loaded.access.user.displayName}
        active={active.map((item) => ({
          id: item.id,
          number: item.number,
          prize: item.prize,
          channelId: item.channelId,
          status: item.status,
          startsAt: item.startsAt.toISOString(),
          endsAt: item.endsAt.toISOString(),
          entries: item.entries,
          winners: item.winners,
          requiredRoleId: item.requiredRoleId,
          excludedRoleId: item.excludedRoleId,
          minLevel: item.minLevel,
          minMemberDays: item.minMemberDays,
        }))}
        history={history.map((item) => ({
          id: item.id,
          number: item.number,
          prize: item.prize,
          endedAt: (item.endedAt ?? item.endsAt).toISOString(),
          entries: item.entries,
          winners: item.winnerIds.slice(0, 3).map((id) => personOf(winners, id).name),
          winnerCount: item.winnerIds.length,
          planned: item.winners,
        }))}
      />
    </ModuleShell>
  );
}
