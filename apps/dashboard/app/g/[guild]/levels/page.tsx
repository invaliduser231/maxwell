import { cardsConfig } from '@maxwell/core/modules/cards';
import { levelCurves, levelsConfig } from '@maxwell/core/modules/levels';
import { LevelStore } from '@maxwell/core/stores/levels';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { LevelsForm } from './levels-form';

export const generateMetadata = titled('Levels');

export default async function LevelsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'levels', levelsConfig);
  const { sql, modules, guilds } = db();
  const store = new LevelStore(sql);

  const [leaders, ranked, lastImport, counts, cards, asset, prefix] = await Promise.all([
    store.leaderboard(guild, 10),
    store.ranked(guild),
    store.lastImport(guild),
    Promise.all(levelCurves.map((curve) => store.levelCounts(guild, curve))),
    modules.state(guild, 'cards'),
    sql<{ updatedAt: Date }[]>`
      select updated_at as "updatedAt" from guild_assets
      where guild_id = ${guild} and key = 'card-background'
    `,
    guilds.prefix(guild),
  ]);
  const names = await people(leaders.map((leader) => leader.userId));
  const cardStyle = cardsConfig.safeParse(cards.config);
  const style = cardStyle.success ? cardStyle.data : cardsConfig.parse({});
  const { user } = loaded.access;

  return (
    <ModuleShell {...loaded.shell}>
      <LevelsForm
        leaders={leaders.map((leader) => ({
          rank: leader.rank,
          xp: leader.xp,
          person: personOf(names, leader.userId),
        }))}
        ranked={ranked}
        counts={Object.fromEntries(levelCurves.map((curve, i) => [curve, counts[i] ?? {}]))}
        lastImport={lastImport ? { rows: lastImport.rows, at: lastImport.at.toISOString() } : null}
        prefix={prefix}
        sample={{ name: user.displayName, avatarUrl: user.avatarUrl }}
        look={{
          accent: style.accent ?? '#F26B3A',
          background: style.background,
          dim: style.dim,
          imageUrl:
            style.background === 'image' && asset[0]
              ? `/g/${guild}/cards/background?v=${asset[0].updatedAt.getTime()}`
              : null,
        }}
      />
    </ModuleShell>
  );
}
