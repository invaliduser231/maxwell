import { logsConfig } from '@maxwell/core/modules/logs';
import { ModuleShell } from '@/components/module-shell';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { LogsForm } from './logs-form';

export const generateMetadata = titled('Logs');

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
