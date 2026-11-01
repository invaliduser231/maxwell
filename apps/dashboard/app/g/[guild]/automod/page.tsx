import { automodConfig } from '@maxwell/core/modules/automod';
import { ModuleShell } from '@/components/module-shell';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { AutomodForm } from './automod-form';
import { gateView, latestRuns, phishingList, weeklyHits } from './data';

export const generateMetadata = titled('AutoMod');

export default async function AutomodPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'automod', automodConfig);
  const [hits, runs, gate, phishing] = await Promise.all([
    weeklyHits(guild),
    latestRuns(guild),
    gateView(guild),
    phishingList(),
  ]);

  return (
    <ModuleShell resetKey={loaded.config.raid.gateRoleId ?? 'none'} {...loaded.shell}>
      <AutomodForm hits={hits} runs={runs} gate={gate} phishing={phishing} saved={loaded.config} />
    </ModuleShell>
  );
}
