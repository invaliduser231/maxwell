import { schedulerConfig } from '@maxwell/core/modules/scheduler';
import { MessageStateStore, ReminderStore } from '@maxwell/core/stores/scheduler';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { SchedulerForm } from './scheduler-form';

export const metadata: Metadata = { title: 'Scheduler' };

const REMINDERS_SHOWN = 50;

export default async function SchedulerPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'scheduler', schedulerConfig);
  const { sql, guilds } = db();
  const reminders = new ReminderStore(sql);
  const [states, rows, total, prefix] = await Promise.all([
    new MessageStateStore(sql).list(guild),
    reminders.forGuild(guild, { limit: REMINDERS_SHOWN }),
    reminders.countForGuild(guild),
    guilds.prefix(guild),
  ]);
  const names = await people(rows.map((row) => row.userId));

  return (
    <ModuleShell {...loaded.shell}>
      <SchedulerForm
        now={Date.now()}
        prefix={prefix}
        savedIds={loaded.config.messages.map((message) => message.id)}
        states={Object.fromEntries(
          states.map((state) => [
            state.messageId,
            {
              lastSentAt: state.lastSentAt?.toISOString() ?? null,
              lastError: state.lastError,
            },
          ]),
        )}
        total={total}
        reminders={rows.map((row) => ({
          id: row.id,
          number: row.number,
          userId: row.userId,
          name: personOf(names, row.userId).name,
          avatar: personOf(names, row.userId).avatar,
          channelId: row.channelId,
          content: row.content,
          dueAt: row.dueAt.toISOString(),
        }))}
      />
    </ModuleShell>
  );
}
