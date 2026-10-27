import { canUndo, catalog, generalConfig } from '@maxwell/core';
import { levelsConfig } from '@maxwell/core/modules/levels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/module-shell';
import { Empty, Grid, Panel } from '@/components/ui';
import { canSee, levelOf, requirePage, voteBlocked } from '@/lib/access';
import { db } from '@/lib/db';
import { botPermissions, inviteUrl, PERMISSION } from '@/lib/fluxer';
import type { Translator } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { pageGroups } from '@/lib/pages';
import { people, personOf } from '@/lib/people';
import { ago, clock, inSentence, since, waited } from '@/lib/time';
import { moduleName } from './audit/data';
import { RecentChanges } from './overview-changes';
import { inviteQuality, moduleStates, waiting, weekNumbers } from './overview-data';
import { ModuleGrid, type ModuleTile } from './overview-modules';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guild: string }>;
}): Promise<Metadata> {
  const { guild } = await params;
  const access = await requirePage(guild, 'overview');
  const t = await getT();
  return { title: { absolute: `${t('Overview')} | ${access.guild.name}` } };
}

interface StatItem {
  label: string;
  value: string;
  raw: number;
  delta: number | null;
  percent?: boolean;
  goodWhenDown?: boolean;
}

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  action: string;
  href: string;
}

function Trend({ item, t }: { item: StatItem; t: Translator }) {
  if (item.delta === null || (item.raw === 0 && item.delta === 0)) return null;
  if (item.delta === 0) return <span className="mx-sub">{t('Same as last week')}</span>;
  const up = item.delta > 0;
  const good = item.goodWhenDown ? !up : up;
  const text = `${up ? '+' : ''}${t.count(item.delta)}${item.percent ? '%' : ''}`;
  return (
    <span className="mx-sub">
      <span className={good ? 'mx-up' : 'mx-down'}>{text}</span> {t('vs last week')}
    </span>
  );
}

function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

const NEEDS: { name: string; bit: bigint; modules: string[] }[] = [
  { name: 'Manage Roles', bit: PERMISSION.ManageRoles, modules: ['roles', 'welcome', 'levels'] },
  { name: 'Ban Members', bit: PERMISSION.BanMembers, modules: ['moderation', 'automod'] },
  { name: 'Kick Members', bit: PERMISSION.KickMembers, modules: ['moderation', 'automod'] },
  { name: 'Moderate Members', bit: PERMISSION.ModerateMembers, modules: ['moderation', 'automod'] },
  {
    name: 'Manage Channels',
    bit: PERMISSION.ManageChannels,
    modules: ['tickets', 'voice', 'moderation'],
  },
  { name: 'Manage Messages', bit: PERMISSION.ManageMessages, modules: ['automod', 'moderation'] },
  { name: 'View Audit Log', bit: PERMISSION.ViewAuditLog, modules: ['logs'] },
];

function quality(stayed: number, eligible: number): { pct: number; color: string } | null {
  if (eligible === 0) return null;
  const pct = Math.round((stayed / eligible) * 100);
  const color =
    pct >= 70 ? 'var(--mx-success)' : pct >= 50 ? 'var(--mx-warning)' : 'var(--mx-danger)';
  return { pct, color };
}

export default async function Overview({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const access = await requirePage(guild, 'overview');
  const t = await getT();
  const sees = (page: string) => canSee(access, page);
  const visibleModules = catalog
    .filter((definition) => access.admin || levelOf(access, definition.key) !== 'none')
    .map((definition) => definition.key);

  const [general, week, wait, states, entries, invites, granted, levels] = await Promise.all([
    db().modules.get(guild, 'general', generalConfig),
    weekNumbers(guild),
    waiting(guild),
    moduleStates(guild),
    db().audit.list(guild, { limit: 5, modules: access.admin ? undefined : visibleModules }),
    sees('invites') ? inviteQuality(guild, 5) : Promise.resolve([]),
    botPermissions(guild),
    db().modules.get(guild, 'levels', levelsConfig),
  ]);
  const timezone = general.timezone;
  const now = new Date();
  const nowIso = now.toISOString();
  const known = await people([
    ...entries.map((entry) => entry.actorId),
    ...invites.map((invite) => invite.inviterId),
  ]);
  const nameOf = (module: string) => t.raw(moduleName(module));

  const stats: StatItem[] = [];
  if (access.guild.memberCount !== null) {
    stats.push({
      label: t('Members'),
      value: t.count(access.guild.memberCount),
      raw: access.guild.memberCount,
      delta: week.joins - week.leaves,
    });
  }
  if (week.messages !== null) {
    stats.push({
      label: t('Messages, 7 days'),
      value: t.count(week.messages),
      raw: week.messages,
      delta: week.messagesBefore
        ? Math.round(((week.messages - week.messagesBefore) / week.messagesBefore) * 100)
        : null,
      percent: true,
    });
  }
  stats.push({
    label: t('Joins, 7 days'),
    value: t.count(week.joins),
    raw: week.joins,
    delta: week.joins - week.joinsBefore,
  });
  if (week.cases !== null && week.casesBefore !== null && sees('moderation')) {
    stats.push({
      label: t('Cases, 7 days'),
      value: t.count(week.cases),
      raw: week.cases,
      delta: week.cases - week.casesBefore,
      goodWhenDown: true,
    });
  }
  if (week.hits !== null && week.hitsBefore !== null && sees('automod')) {
    stats.push({
      label: t('AutoMod hits, 7 days'),
      value: t.count(week.hits),
      raw: week.hits,
      delta: week.hits - week.hitsBefore,
      goodWhenDown: true,
    });
  }

  const href = (page: string) => `/g/${guild}/${page}`;
  const attention: AttentionItem[] = [];
  const needed = (module: string) =>
    (states.get(module) ?? false) &&
    sees(module) &&
    (module !== 'levels' || levels.rewards.length > 0);
  const missing =
    granted === null
      ? []
      : NEEDS.filter((need) => (granted & need.bit) === 0n)
          .map((need) => ({ ...need, modules: need.modules.filter(needed) }))
          .filter((need) => need.modules.length > 0);
  if (missing.length > 0) {
    const modules = [...new Set(missing.flatMap((need) => need.modules))].map(nameOf);
    const names = t.list(missing.map((need) => need.name));
    attention.push({
      key: 'permissions',
      title:
        missing.length <= 2
          ? t('Maxwell is missing {names}', { names })
          : t('Maxwell is missing {count} permissions', { count: missing.length }),
      detail:
        missing.length <= 2
          ? t('Needed for {modules}', { modules: t.list(modules) })
          : t('{names}, needed for {modules}', { names, modules: t.list(modules) }),
      action: t('Fix'),
      href: inviteUrl(guild) ?? href('general'),
    });
  }
  if (wait.flags.count > 0 && sees('moderation')) {
    attention.push({
      key: 'flags',
      title: t.plural(
        wait.flags.count,
        '{n} escalation waiting for review',
        '{n} escalations waiting for review',
      ),
      detail: wait.flags.oldest
        ? t('Oldest flagged {when}', {
            when: since(t, Date.parse(nowIso) - wait.flags.oldest.getTime()),
          })
        : t('Flagged by the escalation ladder'),
      action: t('Review'),
      href: href('moderation'),
    });
  }
  if (sees('automod') && (wait.held.count > 0 || wait.lockdown)) {
    const parts: string[] = [];
    if (wait.lockdown) {
      parts.push(
        wait.lockdown.endsAt
          ? t('Lockdown on until {time}', { time: clock(wait.lockdown.endsAt, timezone) })
          : t('Lockdown on with no end set'),
      );
    }
    if (wait.held.count > 0 && wait.held.oldest) {
      const longest = waited(t, wait.held.oldest.toISOString(), nowIso);
      parts.push(
        parts.length > 0
          ? t('longest wait {span}', { span: longest })
          : t('Longest wait {span}', { span: longest }),
      );
    }
    attention.push({
      key: 'gate',
      title:
        wait.held.count > 0
          ? t.plural(wait.held.count, '{n} person held at the gate', '{n} people held at the gate')
          : t('Lockdown is on'),
      detail: parts.join(', ') || t('Raid shield'),
      action: t('Review'),
      href: href('automod'),
    });
  }
  if (wait.tickets.count > 0 && sees('tickets')) {
    const oldest = wait.tickets.oldest
      ? t('Oldest open for {span}', { span: waited(t, wait.tickets.oldest.toISOString(), nowIso) })
      : t('Waiting for staff');
    attention.push({
      key: 'tickets',
      title: t.plural(wait.tickets.count, '{n} open ticket', '{n} open tickets'),
      detail:
        wait.tickets.unclaimed > 0
          ? t('{oldest}, {count} unclaimed', { oldest, count: wait.tickets.unclaimed })
          : oldest,
      action: t('View'),
      href: href('tickets'),
    });
  }
  if (sees('forms')) {
    for (const form of wait.forms) {
      attention.push({
        key: `form-${form.name}`,
        title: t.plural(form.count, '{n} answer to {form}', '{n} answers to {form}', {
          form: form.name,
        }),
        detail: t('Newest {when}', {
          when: inSentence(t, ago(t, form.newest.toISOString(), nowIso, timezone)),
        }),
        action: t('Review'),
        href: href('forms'),
      });
    }
  }
  for (const job of wait.failing) {
    if (!sees(job.module)) continue;
    attention.push({
      key: `job-${job.module}`,
      title: t.plural(
        job.count,
        'A {module} task keeps failing',
        '{n} {module} tasks keep failing',
        {
          module: nameOf(job.module),
        },
      ),
      detail: clip(job.error),
      action: t('View'),
      href: href(job.module),
    });
  }

  const tiles: ModuleTile[] = pageGroups
    .flatMap((group) => group.pages)
    .filter((page) => {
      const definition = catalog.find((entry) => entry.key === page.key);
      return definition?.toggleable && page.module === page.key && sees(page.key);
    })
    .map((page) => ({
      key: page.key,
      page: page.key,
      name: t(page.name),
      south: page.pole === 'south',
      enabled: states.get(page.key) ?? false,
      editable: levelOf(access, page.key) === 'edit',
      locked: voteBlocked(access, page.key),
    }));

  const changes = entries.map((entry) => {
    const actor = entry.actorId ? personOf(known, entry.actorId) : null;
    return {
      id: String(entry.id),
      actorId: entry.actorId ? String(entry.actorId) : null,
      actorName: actor ? actor.name : 'Maxwell',
      actorAvatar: actor ? actor.avatar : '/mascot/neutral.svg',
      summary: entry.summary,
      createdAt: entry.createdAt.toISOString(),
      undone: entry.undoneAt !== null,
      undoable:
        canUndo(entry, now.getTime()) && (access.admin || levelOf(access, entry.module) === 'edit'),
    };
  });

  const showInvites = sees('invites') && invites.length > 0;
  const showChanges = changes.length > 0;
  const quiet = stats.every((item) => item.raw === 0);
  const hasRight = tiles.length > 0 || showInvites;

  return (
    <>
      <PageHeader title={access.guild.name} page="overview" />

      <section
        className={quiet ? 'mx-panel mx-stat-quiet' : 'mx-panel'}
        aria-label={t('Key numbers')}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      >
        {stats.map((item) => (
          <div key={item.label} className="mx-stat">
            <span className="mx-stat-label">{item.label}</span>
            <span className="mx-stat-value">{item.value}</span>
            <Trend item={item} t={t} />
          </div>
        ))}
      </section>

      <Grid>
        <div className={hasRight ? 'mx-s7 mx-stack' : 'mx-s12 mx-stack'} style={{ gap: 16 }}>
          <Panel
            title={t('Needs attention')}
            span={12}
            id="overview-attention"
            actions={
              attention.length > 0 ? (
                <span className="mx-sub">
                  {t.plural(attention.length, '{n} item', '{n} items')}
                </span>
              ) : null
            }
          >
            {attention.length === 0 ? (
              <Empty mood="happy">{t('Nothing needs you right now.')}</Empty>
            ) : null}
            {attention.map((item) => (
              <div key={item.key} className="mx-row">
                <div className="mx-row-main">
                  <span className="mx-row-title">{item.title}</span>
                  <span className="mx-sub">{item.detail}</span>
                </div>
                <Link className="mx-btn" href={item.href}>
                  {item.action}
                </Link>
              </div>
            ))}
          </Panel>

          {showChanges ? (
            <RecentChanges rows={changes} now={nowIso} auditLink={sees('audit')} span={12} />
          ) : null}
        </div>
        {hasRight ? (
          <div className="mx-s5 mx-stack" style={{ gap: 16 }}>
            {tiles.length > 0 ? <ModuleGrid tiles={tiles} /> : null}
            {showInvites ? (
              <Panel
                title={t('Invites that keep people')}
                span={12}
                id="overview-invites"
                actions={
                  <Link className="mx-btn mx-btn-ghost" href={href('invites')}>
                    {t('All invites')}
                  </Link>
                }
              >
                <div className="mx-scroll">
                  <table className="mx-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('Invite')}</th>
                        <th scope="col">{t('Joined')}</th>
                        <th scope="col">{t('Stayed 7 days')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => {
                        const score = quality(invite.stayed7, invite.eligible7);
                        const owner = invite.vanity
                          ? t('vanity')
                          : invite.inviterId
                            ? personOf(known, invite.inviterId).name
                            : null;
                        return (
                          <tr key={invite.code}>
                            <td>
                              <span className="mx-mono">{invite.code}</span>
                              {owner ? <span className="mx-sub"> {owner}</span> : null}
                            </td>
                            <td>{t.count(invite.joins)}</td>
                            <td>
                              {score ? (
                                <div className="mx-inline" style={{ flexWrap: 'nowrap' }}>
                                  <div className="mx-bar" style={{ flex: 1, minWidth: 60 }}>
                                    <span
                                      style={{ width: `${score.pct}%`, background: score.color }}
                                    />
                                  </div>
                                  <span style={{ width: 36, textAlign: 'right' }}>
                                    {score.pct}%
                                  </span>
                                </div>
                              ) : (
                                <span className="mx-sub">{t('Too new')}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            ) : null}
          </div>
        ) : null}
      </Grid>
    </>
  );
}
