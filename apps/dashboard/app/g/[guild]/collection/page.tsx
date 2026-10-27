import { collectionConfig } from '@maxwell/core/modules/collection';
import { economyConfig } from '@maxwell/core/modules/economy';
import { CollectionStore } from '@maxwell/core/stores/collection';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { botGuild } from '@/lib/fluxer';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { cardView } from './cards';
import { CollectionForm } from './collection-form';

export const generateMetadata = titled('Collection');

export default async function CollectionPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'collection', collectionConfig);
  const store = new CollectionStore(db().sql);
  const [overview, cards, economy, prefix, info] = await Promise.all([
    store.overview(guild),
    store.customCards(guild),
    db().modules.get(guild, 'economy', economyConfig),
    db().guilds.prefix(guild),
    botGuild(guild).catch(() => null),
  ]);
  const user = loaded.access.user;

  return (
    <ModuleShell {...loaded.shell}>
      <CollectionForm
        prefix={prefix}
        overview={overview}
        cards={cards.map(cardView)}
        savedDecks={loaded.config.decks.map((deck) => deck.id)}
        memberCount={info?.memberCount ?? null}
        currency={{ name: economy.currency.name, symbol: economy.currency.symbol }}
        sample={{ id: user.id, name: user.displayName, avatar: user.avatarUrl }}
      />
    </ModuleShell>
  );
}
