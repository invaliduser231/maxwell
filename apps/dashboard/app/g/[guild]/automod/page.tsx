import { automodConfig } from '@maxwell/core/modules/automod';
import { ModuleShell } from '@/components/module-shell';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { AutomodForm } from './automod-form';
import { gateView, latestRuns, weeklyHits } from './data';

export const generateMetadata = titled('AutoMod');

export default async function AutomodPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'automod', automodConfig);
  const [hits, runs, gate] = await Promise.all([
    weeklyHits(guild),
    latestRuns(guild),
    gateView(guild),
  ]);

  return (
    <ModuleShell resetKey={loaded.config.raid.gateRoleId ?? 'none'} {...loaded.shell}>
      <AutomodForm hits={hits} runs={runs} gate={gate} saved={loaded.config} />
    </ModuleShell>
  );
}
