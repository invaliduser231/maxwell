import { PageHeader } from '@/components/module-shell';
import { requirePage } from '@/lib/access';
import { db } from '@/lib/db';
import { getT, titled } from '@/lib/i18n/server';
import { FORMER_MEMBER, people, personOf } from '@/lib/people';
import { AuditView } from './audit-view';
import { loadEntries, moduleName } from './data';
import { type AuditQuery, MAXWELL } from './format';

export const generateMetadata = titled('Audit trail');

function one(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first.slice(0, 32) : null;
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guild } = await params;
  await requirePage(guild, 'audit');
  const search = await searchParams;
  const { audit } = db();
  const [actorRows, moduleKeys] = await Promise.all([audit.actors(guild), audit.modules(guild)]);

  const moduleParam = one(search.module);
  const actorParam = one(search.actor);
  const query: AuditQuery = {
    module: moduleParam && moduleKeys.includes(moduleParam) ? moduleParam : null,
    actor:
      actorParam === MAXWELL || (actorParam && /^\d{1,21}$/.test(actorParam)) ? actorParam : null,
    range: 'any',
    kind: 'all',
    search: '',
  };

  const [first, known, t] = await Promise.all([
    loadEntries(guild, query),
    people(actorRows.map((row) => row.actorId)),
    getT(),
  ]);

  const actors = actorRows.map((row) => ({
    value: row.actorId ?? MAXWELL,
    label: row.actorId ? personOf(known, row.actorId).name : 'Maxwell',
  }));
  if (query.actor && !actors.some((actor) => actor.value === query.actor)) {
    actors.push({ value: query.actor, label: t.raw(FORMER_MEMBER) });
  }
  const modules = moduleKeys
    .map((key) => ({ value: key, label: t.raw(moduleName(key)) }))
    .sort((a, b) => a.label.localeCompare(b.label, t.locale));

  return (
    <>
      <PageHeader title={t('Audit trail')} page="audit" />
      <AuditView
        initial={first.rows}
        more={first.more}
        now={new Date().toISOString()}
        query={query}
        actors={actors}
        modules={modules}
      />
    </>
  );
}
