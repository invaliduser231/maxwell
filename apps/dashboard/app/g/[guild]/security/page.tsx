import { securityConfig } from '@maxwell/core/modules/security';
import { ModuleShell } from '@/components/module-shell';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { securityView } from './data';
import { SecurityForm } from './security-form';

export const generateMetadata = titled('Security');

export default async function SecurityPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'security', securityConfig);
  const view = await securityView(guild);

  return (
    <ModuleShell {...loaded.shell}>
      <SecurityForm view={view} />
    </ModuleShell>
  );
}
