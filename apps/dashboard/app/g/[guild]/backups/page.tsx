import { backupsConfig } from '@maxwell/core/modules/backups';
import { ModuleShell } from '@/components/module-shell';
import { env } from '@/lib/env';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { guildTemplateCards } from '@/lib/templates';
import { BackupsForm } from './backups-form';
import { compare, latestImport, snapshotRows, usage } from './data';

export const generateMetadata = titled('Backups');

export default async function BackupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const [{ guild }, { template }] = await Promise.all([params, searchParams]);
  const loaded = await loadModule(guild, 'backups', backupsConfig);
  const [snapshots, totals, pending, published] = await Promise.all([
    snapshotRows(guild),
    usage(guild),
    latestImport(guild),
    guildTemplateCards(guild),
  ]);
  const [newest, older] = snapshots;
  const diff = newest && older ? await compare(guild, older.id, newest.id) : null;
  const templateLink =
    typeof template === 'string' && /^\d{1,18}$/.test(template)
      ? new URL(`/templates/${template}`, env().DASHBOARD_URL).toString()
      : null;

  return (
    <ModuleShell {...loaded.shell}>
      <BackupsForm
        snapshots={snapshots}
        usage={totals}
        diff={diff}
        pending={templateLink ? null : pending}
        templateLink={templateLink}
        published={published}
        enabled={loaded.enabled}
        guildName={loaded.access.guild.name}
        now={new Date().toISOString()}
      />
    </ModuleShell>
  );
}
