import { builtinCommands, generalConfig } from '@maxwell/core';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { botProfile } from '@/lib/fluxer';
import { loadModule } from '@/lib/module';
import { GeneralForm } from './general-form';

export const metadata: Metadata = { title: 'General' };

export default async function GeneralPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'general', generalConfig);
  const [prefix, commands, profile] = await Promise.all([
    db().guilds.prefix(guild),
    builtinCommands(db().sql),
    botProfile(guild),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <GeneralForm
        prefix={prefix}
        commands={commands.map((command) => command.name).sort()}
        profile={profile}
        guildName={loaded.access.guild.name}
        admin={loaded.access.admin}
      />
    </ModuleShell>
  );
}
