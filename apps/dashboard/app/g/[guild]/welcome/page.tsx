import { welcomeConfig } from '@maxwell/core/modules/welcome';
import { WelcomeStore } from '@maxwell/core/stores/welcome';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { DAY, snowflakeTime } from '@/lib/time';
import { WelcomeForm } from './welcome-form';

export const metadata: Metadata = { title: 'Welcome' };

function createdLabel(userId: string, now: number): string {
  const created = snowflakeTime(userId);
  if (created === null) return 'a while ago';
  const days = Math.floor((now - created) / DAY);
  if (days < 1) return 'today';
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years <= 1 ? 'a year ago' : `${years} years ago`;
}

export default async function WelcomePage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'welcome', welcomeConfig);
  const store = new WelcomeStore(db().sql);
  const now = Date.now();
  const [rules, recent] = await Promise.all([
    store.rulesMessage(guild),
    store.recent(guild, new Date(now - 7 * DAY)),
  ]);
  const { user, guild: info } = loaded.access;

  return (
    <ModuleShell {...loaded.shell}>
      <WelcomeForm
        rulesPost={rules ? { channelId: rules.channelId, messageId: rules.messageId } : null}
        recent={recent}
        sample={{
          id: user.id,
          name: user.displayName,
          username: user.username,
          avatarUrl: user.avatarUrl,
          server: info.name,
          members: info.memberCount,
          created: createdLabel(user.id, now),
        }}
      />
    </ModuleShell>
  );
}
