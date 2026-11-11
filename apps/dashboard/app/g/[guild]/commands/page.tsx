import { builtinCommands } from '@maxwell/core';
import { commandsConfig } from '@maxwell/core/modules/commands';
import { CommandStore } from '@maxwell/core/stores/commands';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { CommandsForm, CommandsShell } from './commands-form';

export const generateMetadata = titled('Custom commands');

export default async function CommandsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'commands', commandsConfig);
  const { sql, guilds } = db();
  const [usage, builtins, prefix] = await Promise.all([
    new CommandStore(sql).usage(guild),
    builtinCommands(sql),
    guilds.prefix(guild),
  ]);
  const usageMap = Object.fromEntries(usage.map((row) => [row.commandId, row.uses]));

  return (
    <CommandsShell shell={loaded.shell} usage={usageMap}>
      <CommandsForm
        prefix={prefix}
        me={{ id: loaded.access.user.id, name: loaded.access.user.displayName }}
        usage={usageMap}
        builtins={[...new Set(builtins.map((command) => command.name.toLowerCase()))]}
      />
    </CommandsShell>
  );
}
