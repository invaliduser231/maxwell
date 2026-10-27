import { welcomeConfig } from '@maxwell/core/modules/welcome';
import { WelcomeStore } from '@maxwell/core/stores/welcome';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import type { Translator } from '@/lib/i18n';
import { getT, titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { DAY, since, snowflakeTime } from '@/lib/time';
import { WelcomeForm } from './welcome-form';

export const generateMetadata = titled('Welcome');

function createdLabel(t: Translator, userId: string, now: number): string {
  const created = snowflakeTime(userId);
  if (created === null) return t('a while ago');
  return since(t, Math.max(now - created, 60_000));
}

export default async function WelcomePage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'welcome', welcomeConfig);
  const store = new WelcomeStore(db().sql);
  const now = Date.now();
  const [rules, recent, t] = await Promise.all([
    store.rulesMessage(guild),
    store.recent(guild, new Date(now - 7 * DAY)),
    getT(),
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
          created: createdLabel(t, user.id, now),
        }}
      />
    </ModuleShell>
  );
}
