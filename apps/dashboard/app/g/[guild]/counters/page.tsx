import { countersConfig } from '@maxwell/core/modules/counters';
import { ModuleShell } from '@/components/module-shell';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { CountersForm } from './counters-form';

export const generateMetadata = titled('Counters');

export default async function CountersPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'counters', countersConfig);
  return (
    <ModuleShell {...loaded.shell}>
      <CountersForm />
    </ModuleShell>
  );
}
