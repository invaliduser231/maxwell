import { backupsConfig } from '@maxwell/core/modules/backups';
import { ModuleShell } from '@/components/module-shell';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { BackupsForm } from './backups-form';
import { compare, latestImport, snapshotRows, usage } from './data';

export const generateMetadata = titled('Backups');

export default async function BackupsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'backups', backupsConfig);
  const [snapshots, totals, pending] = await Promise.all([
    snapshotRows(guild),
    usage(guild),
    latestImport(guild),
  ]);
  const [newest, older] = snapshots;
  const diff = newest && older ? await compare(guild, older.id, newest.id) : null;

  return (
    <ModuleShell {...loaded.shell}>
      <BackupsForm
        snapshots={snapshots}
        usage={totals}
        diff={diff}
        pending={pending}
        enabled={loaded.enabled}
        guildName={loaded.access.guild.name}
        now={new Date().toISOString()}
      />
    </ModuleShell>
  );
}
