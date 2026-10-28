import { type InboxKind, inboxKinds, moderationConfig } from '@maxwell/core/modules/moderation';
import { ModuleShell } from '@/components/module-shell';
import { env } from '@/lib/env';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { inboxCounts, inboxDetail, listInbox, type InboxView as Mode } from './data';
import { InboxView } from './inbox-view';

export const generateMetadata = titled('Inbox');

const modes: Mode[] = ['active', 'mine', 'closed'];

function pick(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guild } = await params;
  const raw = await searchParams;
  const loaded = await loadModule(guild, 'inbox', moderationConfig);
  const self = loaded.access.user.id;
  const mode = modes.includes(pick(raw.view) as Mode) ? (pick(raw.view) as Mode) : 'active';
  const kind = (inboxKinds as readonly string[]).includes(pick(raw.kind))
    ? (pick(raw.kind) as InboxKind)
    : null;
  const [list, counts] = await Promise.all([
    listInbox(guild, mode, kind, self),
    inboxCounts(guild, self),
  ]);
  const wanted = Number(pick(raw.item));
  const selected = Number.isSafeInteger(wanted) && wanted > 0 ? wanted : (list[0]?.number ?? null);
  const detail = selected ? await inboxDetail(guild, selected) : null;
  const appealUrl = `${env().DASHBOARD_URL.replace(/\/+$/, '')}/appeal/${guild}`;

  return (
    <ModuleShell {...loaded.shell} toggleable={false}>
      <InboxView
        key={`${mode}:${kind ?? 'all'}`}
        mode={mode}
        kind={kind}
        list={list}
        counts={counts}
        detail={detail}
        self={self}
        appealUrl={appealUrl}
        now={new Date().toISOString()}
      />
    </ModuleShell>
  );
}
