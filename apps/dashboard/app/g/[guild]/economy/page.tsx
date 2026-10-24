import { collectionConfig } from '@maxwell/core/modules/collection';
import { economyConfig } from '@maxwell/core/modules/economy';
import { EconomyStore } from '@maxwell/core/stores/economy';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { EconomyForm } from './economy-form';
import { ledgerPage } from './ledger';

export const metadata: Metadata = { title: 'Economy' };

export default async function EconomyPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'economy', economyConfig);
  const store = new EconomyStore(db().sql);
  const config = loaded.config;
  const [collection, overview, history, holders, sold, prefix] = await Promise.all([
    db().modules.get(guild, 'collection', collectionConfig),
    store.overview(guild, config.dailyCap),
    store.supplyHistory(guild, 30),
    store.richest(guild, 8),
    store.soldCounts(guild),
    db().guilds.prefix(guild),
  ]);
  const [ledger, names] = await Promise.all([
    ledgerPage(guild, config, collection),
    people(holders.map((holder) => holder.userId)),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <EconomyForm
        prefix={prefix}
        overview={overview}
        history={history}
        richest={holders.map((holder) => ({
          userId: holder.userId,
          balance: holder.balance,
          name: personOf(names, holder.userId).name,
          avatar: personOf(names, holder.userId).avatar,
        }))}
        sold={Object.fromEntries(sold)}
        packs={collection.packs.map((pack) => ({ id: pack.id, name: pack.name }))}
        ledger={ledger}
      />
    </ModuleShell>
  );
}
