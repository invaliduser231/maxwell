import { logsConfig } from '@maxwell/core/modules/logs';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { loadModule } from '@/lib/module';
import { LogsForm } from './logs-form';

export const metadata: Metadata = { title: 'Logs' };

export default async function LogsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'logs', logsConfig);
  const { user } = loaded.access;
  return (
    <ModuleShell {...loaded.shell}>
      <LogsForm
        saved={loaded.config}
        viewer={{ id: user.id, name: user.displayName, handle: user.username }}
        now={new Date().toISOString()}
      />
    </ModuleShell>
  );
}
