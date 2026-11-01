import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/module-shell';
import { levelOf, requirePage } from '@/lib/access';
import { getT, titled } from '@/lib/i18n/server';
import { incidentDetail } from '../../incidents';
import { IncidentReplay } from './incident-replay';

export const generateMetadata = titled('Incident');

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ guild: string; incident: string }>;
}) {
  const { guild, incident: incidentId } = await params;
  const access = await requirePage(guild, 'security');
  if (!/^\d{1,19}$/.test(incidentId)) notFound();
  const [detail, t] = await Promise.all([incidentDetail(guild, incidentId), getT()]);
  if (!detail) notFound();

  return (
    <>
      <PageHeader
        title={t('Incident #{number}', { number: detail.incident.id })}
        page="security"
        pole="south"
      >
        <Link className="mx-btn mx-btn-ghost" href={`/g/${guild}/security#sec-incidents`}>
          {t('All incidents')}
        </Link>
      </PageHeader>
      <IncidentReplay detail={detail} canEdit={levelOf(access, 'security') === 'edit'} />
    </>
  );
}
