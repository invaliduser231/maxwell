'use client';

import type { InvitesConfig } from '@maxwell/core/modules/invites';
import type { InviteSummary } from '@maxwell/core/stores/invites';
import { type ReactNode, useEffect, useState, useTransition } from 'react';
import { ChannelSelect, Seg, TextInput } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { failed, StatusText } from '@/components/status-text';
import { Avatar, Empty, Field, Panel, PanelBody } from '@/components/ui';
import type { Key, Translator } from '@/lib/i18n';
import type { Person } from '@/lib/people';
import { since as timeAgo } from '@/lib/time';
import { loadJoins, type RecentJoin } from './actions';

interface Code {
  code: string;
  owner: string;
  vanity: boolean;
  joins: number;
  joins30: number;
  fake: number;
  eligible7: number;
  stayed7: number;
  eligible30: number;
  stayed30: number;
}

interface Leader {
  person: Person;
  active: number;
  total: number;
  fake: number;
}

type Filter = 'all' | 'campaigns' | 'flagged';

const filters: { value: Filter; label: Key }[] = [
  { value: 'all', label: 'All' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'flagged', label: 'Flagged' },
];

const DAY = 86_400_000;

const column = { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 } as const;

function share(stayed: number, eligible: number): number | null {
  return eligible > 0 ? Math.round((stayed / eligible) * 100) : null;
}

function tone(percent: number): string {
  return percent >= 70 ? '#2EB67D' : percent >= 45 ? '#F2C14E' : '#EC5B78';
}

function Quality({ percent }: { percent: number | null }) {
  const t = useT();
  if (percent === null) return <span className="mx-sub">{t('Too new')}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div className="mx-bar" style={{ flex: 1 }}>
        <span style={{ width: `${percent}%`, background: tone(percent) }} />
      </div>
      <span style={{ width: 38, textAlign: 'right' }}>{percent}%</span>
    </div>
  );
}

function Stats({ summary, campaignJoins }: { summary: InviteSummary; campaignJoins: number }) {
  const t = useT();
  const week = share(summary.stayed7, summary.eligible7);
  const month = share(summary.stayed30, summary.eligible30);
  const quiet = summary.joins30 === 0 && summary.fake30 === 0;
  const items = [
    {
      label: t('Joins through invites, 30 days'),
      value: t.count(summary.joins30),
      sub: campaignJoins > 0 ? t('{count} through campaigns', { count: campaignJoins }) : null,
    },
    {
      label: t('Still here after 7 days'),
      value: `${week ?? 0}%`,
      sub: summary.eligible7 > 0 ? t('Of {count} joins', { count: summary.eligible7 }) : null,
    },
    {
      label: t('Still here after 30 days'),
      value: `${month ?? 0}%`,
      sub: summary.eligible30 > 0 ? t('Of {count} joins', { count: summary.eligible30 }) : null,
    },
    {
      label: t('Fake joins, 30 days'),
      value: t.count(summary.fake30),
      sub: t('Accounts under 1 day old'),
    },
  ];
  return (
    <div
      className={quiet ? 'mx-panel mx-stat-quiet' : 'mx-panel'}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
    >
      {items.map((item) => (
        <div className="mx-stat" key={item.label}>
          <span className="mx-stat-label">{item.label}</span>
          <span className="mx-stat-value">{item.value}</span>
          {item.sub ? <span className="mx-sub">{item.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

function since(t: Translator, from: string, to: number): string {
  const days = Math.floor((to - Date.parse(from)) / DAY);
  if (days < 1) return t('less than a day');
  return t.plural(days, '{n} day', '{n} days');
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mx-stat-label">{label}</span>
      {children}
    </div>
  );
}

function Percent({ value }: { value: number | null }) {
  const t = useT();
  if (value === null) return <span className="mx-sub">{t('Too new')}</span>;
  return (
    <span className="mx-stat-value" style={{ fontSize: 18 }}>
      {value}%
    </span>
  );
}

function Detail({
  code,
  campaign,
  onCampaign,
  now,
}: {
  code: Code;
  campaign: string;
  onCampaign: (name: string) => void;
  now: number;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const [joins, setJoins] = useState<RecentJoin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    setJoins(null);
    setError(null);
    setCopied(false);
    start(async () => {
      const result = await loadJoins(guildId, code.code);
      if (result.ok) setJoins(result.data ?? []);
      else setError(result.error);
    });
  }, [guildId, code.code]);

  return (
    <Panel
      title={<span className="mx-mono">{code.code}</span>}
      actions={
        <button
          type="button"
          className="mx-btn mx-btn-ghost"
          onClick={() => {
            navigator.clipboard
              .writeText(`https://fluxer.gg/${code.code}`)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? t('Copied') : t('Copy link')}
        </button>
      }
    >
      <PanelBody>
        <span className="mx-sub">
          {code.vanity || code.owner === 'Unknown'
            ? t.raw(code.owner)
            : t('Created by {name}', { name: code.owner })}
        </span>
        <Field label={t('Campaign')}>
          <TextInput
            value={campaign}
            maxLength={60}
            placeholder={t('No campaign')}
            label={t('Campaign')}
            onChange={onCampaign}
          />
        </Field>
        <div
          className="mx-inset"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
            padding: '10px 12px',
          }}
        >
          <Figure label={t('Joined')}>
            <span className="mx-stat-value" style={{ fontSize: 18 }}>
              {t.count(code.joins)}
            </span>
          </Figure>
          <Figure label={t('After 7 days')}>
            <Percent value={share(code.stayed7, code.eligible7)} />
          </Figure>
          <Figure label={t('After 30 days')}>
            <Percent value={share(code.stayed30, code.eligible30)} />
          </Figure>
        </div>
        <div className="mx-field">
          <span className="mx-label">{t('Latest joins')}</span>
          <StatusText status={error ? failed(error) : null} />
          {joins === null && !error ? <span className="mx-sub">{t('Loading')}</span> : null}
          {joins?.length === 0 ? <span className="mx-sub">{t('Nobody yet')}</span> : null}
          {joins && joins.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {joins.map((join, i) => {
                const state = join.fake
                  ? { text: t('Fake account'), className: 'mx-down' }
                  : join.leftAt
                    ? {
                        text: t('Left after {span}', {
                          span: since(t, join.joinedAt, Date.parse(join.leftAt)),
                        }),
                        className: 'mx-sub',
                      }
                    : { text: t('Still here'), className: 'mx-up' };
                return (
                  <div
                    key={`${join.person.id}:${join.joinedAt}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 0',
                      borderTop: i === 0 ? undefined : '1px solid var(--mx-line)',
                      fontSize: 13,
                    }}
                  >
                    <Avatar src={join.person.avatar} name={join.person.name} size={22} />
                    <span className="mx-ellipsis" style={{ flex: 1 }}>
                      {join.person.name}
                    </span>
                    <span
                      className={state.className}
                      title={t('Joined {when}', {
                        when: timeAgo(t, now - Date.parse(join.joinedAt)),
                      })}
                    >
                      {state.text}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </PanelBody>
    </Panel>
  );
}

export function InvitesView({
  summary,
  codes,
  leaders,
  now,
}: {
  summary: InviteSummary;
  codes: Code[];
  leaders: Leader[];
  now: number;
}) {
  const t = useT();
  const { value, set } = useDraft<InvitesConfig>();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState(codes[0]?.code ?? null);
  const campaignOf = (code: string) =>
    value.campaigns.find((entry) => entry.code === code)?.name ?? '';
  const visible = codes.filter(
    (code) =>
      filter === 'all' ||
      (filter === 'campaigns' && campaignOf(code.code)) ||
      (filter === 'flagged' && code.fake > 0),
  );
  const current = codes.find((code) => code.code === selected) ?? null;
  const campaignJoins = codes
    .filter((code) => campaignOf(code.code))
    .reduce((sum, code) => sum + code.joins30, 0);
  const hasData = codes.length > 0 || summary.joins30 > 0 || summary.fake30 > 0;

  const rename = (code: string, name: string) => {
    const rest = value.campaigns.filter((entry) => entry.code !== code);
    set({ campaigns: name.trim() ? [...rest, { code, name: name.slice(0, 60) }] : rest });
  };

  return (
    <>
      {hasData ? <Stats summary={summary} campaignJoins={campaignJoins} /> : null}
      <div className="mx-grid">
        <div className="mx-s8" style={column}>
          <Panel
            title={t('Invites')}
            actions={
              codes.length > 0 ? (
                <Seg
                  label={t('Filter invites')}
                  value={filter}
                  options={filters.map((entry) => ({ ...entry, label: t(entry.label) }))}
                  onChange={setFilter}
                  view
                />
              ) : null
            }
          >
            {codes.length === 0 ? (
              <Empty mood="sleeping">{t('No joins through invites in the last 90 days.')}</Empty>
            ) : visible.length === 0 ? (
              <Empty>{t('Nothing matches this filter.')}</Empty>
            ) : (
              <div className="mx-scroll">
                <table className="mx-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('Invite')}</th>
                      <th scope="col">{t('Campaign')}</th>
                      <th scope="col">{t('Joined')}</th>
                      <th scope="col">{t('After 7 days')}</th>
                      <th scope="col">{t('After 30 days')}</th>
                      <th scope="col">{t('Flags')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((code) => (
                      <tr
                        key={code.code}
                        style={{
                          background: code.code === selected ? 'var(--mx-inset)' : 'transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => setSelected(code.code)}
                      >
                        <td>
                          <button
                            type="button"
                            className="mx-mono"
                            aria-pressed={code.code === selected}
                            onClick={() => setSelected(code.code)}
                            style={{
                              background: 'none',
                              border: 0,
                              padding: 0,
                              color: 'inherit',
                              font: 'inherit',
                              cursor: 'pointer',
                            }}
                          >
                            {code.code}
                          </button>
                          <br />
                          <span className="mx-sub">{t.raw(code.owner)}</span>
                        </td>
                        <td>{campaignOf(code.code)}</td>
                        <td>{t.count(code.joins)}</td>
                        <td>
                          <Quality percent={share(code.stayed7, code.eligible7)} />
                        </td>
                        <td>
                          <Quality percent={share(code.stayed30, code.eligible30)} />
                        </td>
                        <td>
                          {code.fake > 0 ? (
                            <span className="mx-chip" style={{ color: '#EC5B78' }}>
                              {t('{count} fake', { count: code.fake })}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {leaders.length > 0 ? (
            <Panel title={t('Top inviters')}>
              {leaders.map((leader, i) => (
                <div className="mx-row" key={leader.person.id}>
                  <span className="mx-mono mx-muted" style={{ width: 22 }}>
                    {i + 1}
                  </span>
                  <Avatar src={leader.person.avatar} name={leader.person.name} size={26} />
                  <div className="mx-row-main">
                    <span className="mx-row-title">{leader.person.name}</span>
                    <span className="mx-sub">
                      {t('{active} of {total} stayed', {
                        active: leader.active,
                        total: leader.total,
                      })}
                      {leader.fake > 0 ? `, ${t('{count} fake', { count: leader.fake })}` : ''}
                    </span>
                  </div>
                  <span className="mx-stat-value" style={{ fontSize: 17 }}>
                    {t.count(leader.active)}
                  </span>
                </div>
              ))}
            </Panel>
          ) : null}
        </div>

        <div className="mx-s4" style={column}>
          {current ? (
            <Detail
              code={current}
              campaign={campaignOf(current.code)}
              onCampaign={(name) => rename(current.code, name)}
              now={now}
            />
          ) : null}
          <Panel title={t('Settings')}>
            <PanelBody>
              <Field label={t('Join log')}>
                <ChannelSelect
                  value={value.logChannelId}
                  none={t('Off')}
                  onChange={(logChannelId) => set({ logChannelId })}
                />
              </Field>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
