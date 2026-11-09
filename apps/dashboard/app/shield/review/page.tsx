import { TopBar } from '@/components/top-bar';
import { Empty, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { getT, titled } from '@/lib/i18n/server';
import { date, fullDate } from '@/lib/time';
import { sourceLabels } from '../labels';
import { type PersonView, requireOperator, reviewData } from './data';
import { ReviewActions } from './review-item';

export const generateMetadata = titled('Shield disputes');

function who(person: PersonView): string {
  return person.name ? `${person.name} (${person.id})` : person.id;
}

export default async function ShieldReviewPage() {
  const user = await requireOperator();
  const [{ open, decisions }, t] = await Promise.all([reviewData(), getT()]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar user={{ name: user.displayName, avatarUrl: user.avatarUrl }} />
      <main
        className="mx-stack"
        style={{ width: '100%', maxWidth: 900, margin: '0 auto', padding: '32px 16px', gap: 16 }}
      >
        <h1 className="mx-h1">{t('Shield disputes')}</h1>
        <Grid>
          {open.length === 0 ? (
            <Panel>
              <Empty mood="sleeping">{t('No open disputes.')}</Empty>
            </Panel>
          ) : (
            open.map((dispute) => (
              <Panel
                key={dispute.id}
                title={who(dispute.user)}
                actions={<span className="mx-sub">{fullDate(t, dispute.createdAt, 'UTC')}</span>}
              >
                <PanelBody>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {dispute.body}
                  </p>
                  <div>
                    {dispute.records.length === 0 ? (
                      <span className="mx-sub">{t('No active entries.')}</span>
                    ) : (
                      dispute.records.map((record) => (
                        <Row
                          key={record.guildId}
                          title={`${record.guildName ?? record.guildId}: ${t(sourceLabels[record.source])}`}
                          sub={[
                            record.reportedBy
                              ? t('Shared by {name}', { name: who(record.reportedBy) })
                              : null,
                            t('Since {date}, expires {expires}', {
                              date: date(t, record.createdAt, 'UTC'),
                              expires: date(t, record.expiresAt, 'UTC'),
                            }),
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        />
                      ))
                    )}
                  </div>
                  <ReviewActions id={dispute.id} />
                </PanelBody>
              </Panel>
            ))
          )}
          <Panel title={t('Decisions')}>
            {decisions.length === 0 ? (
              <Empty>{t('No decisions yet.')}</Empty>
            ) : (
              <div>
                {decisions.map((decision) => (
                  <Row
                    key={decision.id}
                    title={`${who(decision.user)}: ${
                      decision.action === 'removed' ? t('Listing removed') : t('Listing kept')
                    }`}
                    sub={[
                      t('By {name} on {date}', {
                        name: who(decision.operator),
                        date: fullDate(t, decision.createdAt, 'UTC'),
                      }),
                      t('{n, plural, one {# record} other {# records}}', { n: decision.records }),
                      decision.note,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  />
                ))}
              </div>
            )}
          </Panel>
        </Grid>
      </main>
    </div>
  );
}
