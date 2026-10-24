import { canUndo, catalog, generalConfig } from '@maxwell/core';
import { levelsConfig } from '@maxwell/core/modules/levels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/module-shell';
import { Empty, Grid, Panel } from '@/components/ui';
import { canSee, levelOf, requirePage, voteBlocked } from '@/lib/access';
import { db } from '@/lib/db';
import { botPermissions, inviteUrl, PERMISSION } from '@/lib/fluxer';
import { pageGroups } from '@/lib/pages';
import { people, personOf } from '@/lib/people';
import { ago, clock, count, plural, waited } from '@/lib/time';
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
  return { title: { absolute: `Overview | ${access.guild.name}` } };
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

function Trend({ item }: { item: StatItem }) {
  if (item.delta === null || (item.raw === 0 && item.delta === 0)) return null;
  if (item.delta === 0) return <span className="mx-sub">Same as last week</span>;
  const up = item.delta > 0;
  const good = item.goodWhenDown ? !up : up;
  const text = `${up ? '+' : ''}${count(item.delta)}${item.percent ? '%' : ''}`;
  return (
    <span className="mx-sub">
      <span className={good ? 'mx-up' : 'mx-down'}>{text}</span> vs last week
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

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

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

  const stats: StatItem[] = [];
  if (access.guild.memberCount !== null) {
    stats.push({
      label: 'Members',
      value: count(access.guild.memberCount),
      raw: access.guild.memberCount,
      delta: week.joins - week.leaves,
    });
  }
  if (week.messages !== null) {
    stats.push({
      label: 'Messages, 7 days',
      value: count(week.messages),
      raw: week.messages,
      delta: week.messagesBefore
        ? Math.round(((week.messages - week.messagesBefore) / week.messagesBefore) * 100)
        : null,
      percent: true,
    });
  }
  stats.push({
    label: 'Joins, 7 days',
    value: count(week.joins),
    raw: week.joins,
    delta: week.joins - week.joinsBefore,
  });
  if (week.cases !== null && week.casesBefore !== null && sees('moderation')) {
    stats.push({
      label: 'Cases, 7 days',
      value: count(week.cases),
      raw: week.cases,
      delta: week.cases - week.casesBefore,
      goodWhenDown: true,
    });
  }
  if (week.hits !== null && week.hitsBefore !== null && sees('automod')) {
    stats.push({
      label: 'AutoMod hits, 7 days',
      value: count(week.hits),
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
    const modules = [...new Set(missing.flatMap((need) => need.modules))].map(moduleName);
    attention.push({
      key: 'permissions',
      title:
        missing.length <= 2
          ? `Maxwell is missing ${listed(missing.map((need) => need.name))}`
          : `Maxwell is missing ${missing.length} permissions`,
      detail:
        missing.length <= 2
          ? `Needed for ${listed(modules)}`
          : `${listed(missing.map((need) => need.name))}, needed for ${listed(modules)}`,
      action: 'Fix',
      href: inviteUrl(guild) ?? href('general'),
    });
  }
  if (wait.flags.count > 0 && sees('moderation')) {
    attention.push({
      key: 'flags',
      title: `${plural(wait.flags.count, 'escalation')} waiting for review`,
      detail: wait.flags.oldest
        ? `Oldest flagged ${waited(wait.flags.oldest.toISOString(), nowIso)} ago`
        : 'Flagged by the escalation ladder',
      action: 'Review',
      href: href('moderation'),
    });
  }
  if (sees('automod') && (wait.held.count > 0 || wait.lockdown)) {
    const parts: string[] = [];
    if (wait.lockdown) {
      parts.push(
        wait.lockdown.endsAt
          ? `Lockdown on until ${clock(wait.lockdown.endsAt, timezone)}`
          : 'Lockdown on with no end set',
      );
    }
    if (wait.held.count > 0 && wait.held.oldest) {
      const longest = waited(wait.held.oldest.toISOString(), nowIso);
      parts.push(parts.length > 0 ? `longest wait ${longest}` : `Longest wait ${longest}`);
    }
    attention.push({
      key: 'gate',
      title:
        wait.held.count > 0
          ? `${plural(wait.held.count, 'person', 'people')} held at the gate`
          : 'Lockdown is on',
      detail: parts.join(', ') || 'Raid shield',
      action: 'Review',
      href: href('automod'),
    });
  }
  if (wait.tickets.count > 0 && sees('tickets')) {
    const oldest = wait.tickets.oldest
      ? `Oldest open for ${waited(wait.tickets.oldest.toISOString(), nowIso)}`
      : 'Waiting for staff';
    attention.push({
      key: 'tickets',
      title: plural(wait.tickets.count, 'open ticket'),
      detail:
        wait.tickets.unclaimed > 0
          ? `${oldest}, ${count(wait.tickets.unclaimed)} unclaimed`
          : oldest,
      action: 'Open',
      href: href('tickets'),
    });
  }
  if (sees('forms')) {
    for (const form of wait.forms) {
      attention.push({
        key: `form-${form.name}`,
        title: `${plural(form.count, 'answer')} to ${form.name}`,
        detail: `Newest ${ago(form.newest.toISOString(), nowIso, timezone).toLowerCase()}`,
        action: 'Review',
        href: href('forms'),
      });
    }
  }
  for (const job of wait.failing) {
    if (!sees(job.module)) continue;
    attention.push({
      key: `job-${job.module}`,
      title:
        job.count === 1
          ? `A ${moduleName(job.module)} task keeps failing`
          : `${count(job.count)} ${moduleName(job.module)} tasks keep failing`,
      detail: clip(job.error),
      action: 'Open',
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
      name: page.name,
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
        aria-label="Key numbers"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      >
        {stats.map((item) => (
          <div key={item.label} className="mx-stat">
            <span className="mx-stat-label">{item.label}</span>
            <span className="mx-stat-value">{item.value}</span>
            <Trend item={item} />
          </div>
        ))}
      </section>

      <Grid>
        <div className={hasRight ? 'mx-s7 mx-stack' : 'mx-s12 mx-stack'} style={{ gap: 16 }}>
          <Panel
            title="Needs attention"
            span={12}
            id="overview-attention"
            actions={
              attention.length > 0 ? (
                <span className="mx-sub">{plural(attention.length, 'item')}</span>
              ) : null
            }
          >
            {attention.length === 0 ? (
              <Empty mood="happy">Nothing needs you right now.</Empty>
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
                title="Invites that keep people"
                span={12}
                id="overview-invites"
                actions={
                  <Link className="mx-btn mx-btn-ghost" href={href('invites')}>
                    All invites
                  </Link>
                }
              >
                <div className="mx-scroll">
                  <table className="mx-table">
                    <thead>
                      <tr>
                        <th scope="col">Invite</th>
                        <th scope="col">Joined</th>
                        <th scope="col">Stayed 7 days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => {
                        const score = quality(invite.stayed7, invite.eligible7);
                        const owner = invite.vanity
                          ? 'vanity'
                          : invite.inviterId
                            ? personOf(known, invite.inviterId).name
                            : null;
                        return (
                          <tr key={invite.code}>
                            <td>
                              <span className="mx-mono">{invite.code}</span>
                              {owner ? <span className="mx-sub"> {owner}</span> : null}
                            </td>
                            <td>{count(invite.joins)}</td>
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
                                <span className="mx-sub">Too new</span>
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
