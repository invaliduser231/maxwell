import { cardsConfig } from '@maxwell/core/modules/cards';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { CardsForm } from './cards-form';

export const generateMetadata = titled('Cards');

export default async function CardsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'cards', cardsConfig);
  const [asset] = await db().sql<{ updatedAt: Date }[]>`
    select updated_at as "updatedAt" from guild_assets
    where guild_id = ${guild} and key = 'card-background'
  `;
  const { user, guild: info } = loaded.access;

  return (
    <ModuleShell {...loaded.shell}>
      <CardsForm
        imageVersion={asset ? asset.updatedAt.getTime() : null}
        sample={{
          name: user.displayName,
          username: user.username,
          avatarUrl: user.avatarUrl,
          memberCount: info.memberCount,
          guildName: info.name,
        }}
      />
    </ModuleShell>
  );
}
