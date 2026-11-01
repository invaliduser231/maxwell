import { moderationConfig } from '@maxwell/core/modules/moderation';
import type { MemberView } from '@maxwell/core/stores/moderation';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { PageHeader } from '@/components/module-shell';
import { levelOf, requirePage } from '@/lib/access';
import { db } from '@/lib/db';
import { getT, titled } from '@/lib/i18n/server';
import { listMembers, loadFile } from './data';
import { MembersView } from './members-view';

export const generateMetadata = titled('Member files');

const views: MemberView[] = ['flagged', 'new', 'all'];

function pick(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guild } = await params;
  const raw = await searchParams;
  const access = await requirePage(guild, 'members');
  const readOnly = levelOf(access, 'moderation') !== 'edit';
  const config = await db().modules.get(guild, 'moderation', moderationConfig);
  const view = views.includes(pick(raw.view) as MemberView)
    ? (pick(raw.view) as MemberView)
    : 'flagged';
  const q = pick(raw.q).trim().slice(0, 64);
  const [list, t, shield] = await Promise.all([
    listMembers(guild, view, q, config),
    getT(),
    new ShieldStore(db().sql).participates(guild),
  ]);
  const wanted = /^\d{1,21}$/.test(pick(raw.member)) ? pick(raw.member) : null;
  const selectedId = wanted ?? list[0]?.userId ?? null;
  const file = selectedId
    ? await loadFile(
        guild,
        selectedId,
        config,
        list.find((entry) => entry.userId === selectedId),
      )
    : null;

  return (
    <>
      <PageHeader
        title={t('Member files')}
        page="members"
        pole="south"
        badge={readOnly ? t('View only') : undefined}
      />
      <MembersView
        key={`${view}:${q}`}
        view={view}
        q={q}
        list={list}
        selectedId={selectedId}
        file={file}
        memberCount={access.guild.memberCount}
        readOnly={readOnly}
        self={access.user.id}
        requireReason={config.requireReason}
        defaultTimeoutMinutes={config.defaultTimeoutMinutes}
        shield={shield}
        templates={config.reasonTemplates}
        banDeleteMessageDays={config.banDeleteMessageDays}
        now={new Date().toISOString()}
      />
    </>
  );
}
