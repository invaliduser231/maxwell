import { generalConfig } from '@maxwell/core';
import { InviteStatsStore } from '@maxwell/core/stores/invites';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { PublicForm } from './public-form';

export const generateMetadata = titled('Public page');

export default async function PublicSettingsPage({
  params,
}: {
  params: Promise<{ guild: string }>;
}) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'public', generalConfig);
  const { modules, guilds, sql } = db();
  const [codes, levels, events, prefix] = await Promise.all([
    new InviteStatsStore(sql).codes(guild, 20).catch(() => []),
    modules.isEnabled(guild, 'levels'),
    modules.isEnabled(guild, 'events'),
    guilds.prefix(guild),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <PublicForm
        url={`${env().DASHBOARD_URL.replace(/\/+$/, '')}/c/${guild}`}
        codes={codes.map((code) => ({ code: code.code, joins: code.joins }))}
        levels={levels}
        events={events}
        prefix={prefix}
      />
    </ModuleShell>
  );
}
