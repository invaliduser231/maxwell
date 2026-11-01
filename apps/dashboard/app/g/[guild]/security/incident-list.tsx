'use client';

import Link from 'next/link';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { Empty, Grid, Panel } from '@/components/ui';
import { duration, fullDate } from '@/lib/time';
import { incidentKind, tallyText } from './incident-format';
import type { IncidentRow } from './incidents';

export function IncidentList({ incidents }: { incidents: IncidentRow[] }) {
  const t = useT();
  const { guildId, timezone } = useGuild();

  return (
    <Grid>
      <Panel title={t.raw('Incidents')} span={12} id="sec-incidents">
        {incidents.length === 0 ? (
          <Empty mood="sleeping">{t.raw('No incidents yet.')}</Empty>
        ) : (
          incidents.map((incident) => (
            <div key={incident.id} className="mx-row">
              <div className="mx-row-main">
                <span className="mx-row-title">
                  {incidentKind(t, incident.kind)}, {fullDate(t, incident.startedAt, timezone)}
                </span>
                <span className="mx-sub">
                  {incident.endedAt === null
                    ? t.raw('Still running')
                    : duration(t, incident.endedAt - incident.startedAt)}
                  {', '}
                  {tallyText(t, incident.tally)}
                  {incident.undone ? `, ${t.raw('undo sent')}` : ''}
                </span>
              </div>
              <Link
                className="mx-btn mx-btn-ghost"
                href={`/g/${guildId}/security/incidents/${incident.id}`}
              >
                {t.raw('Replay')}
              </Link>
            </div>
          ))
        )}
      </Panel>
    </Grid>
  );
}
