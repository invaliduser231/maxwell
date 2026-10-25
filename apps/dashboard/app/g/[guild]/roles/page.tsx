import { rolesConfig } from '@maxwell/core/modules/roles';
import { RolesStore } from '@maxwell/core/stores/roles';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { ago } from '@/lib/time';
import { type Kept, type Posted, RolesForm } from './roles-form';

export const metadata: Metadata = { title: 'Roles' };

export default async function RolesPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'roles', rolesConfig);
  const store = new RolesStore(db().sql);
  const timeRoleIds = [...new Set(loaded.config.timeRoles.map((step) => step.roleId))];

  const [messages, counts, sticky] = await Promise.all([
    store.menuMessages(guild),
    Promise.all(timeRoleIds.map((roleId) => store.timeGrantedCount(guild, roleId))),
    store.stickyMembers(guild, 8),
  ]);

  const profiles = await people(sticky.map((member) => member.userId));
  const now = Date.now();

  const posted: Posted[] = messages.map((message) => ({
    menuId: message.menuId,
    channelId: message.channelId,
  }));
  const holders = Object.fromEntries(timeRoleIds.map((id, index) => [id, counts[index] ?? 0]));
  const kept: Kept[] = sticky.map((member) => ({
    userId: member.userId,
    name: personOf(profiles, member.userId).name,
    avatarUrl: personOf(profiles, member.userId).avatar,
    roleIds: member.stickyRoleIds.map(String),
    left: member.leftAt ? ago(member.leftAt, now) : '',
  }));

  return (
    <ModuleShell {...loaded.shell}>
      <RolesForm saved={loaded.config} posted={posted} holders={holders} kept={kept} />
    </ModuleShell>
  );
}
