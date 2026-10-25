import { builtinCommands, generalConfig } from '@maxwell/core';
import { type CaseAction, caseActions, moderationConfig } from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people } from '@/lib/people';
import { type CaseView, caseDetail, toView, withUndo } from './data';
import { ModerationView } from './moderation-view';
import { type CaseQuery, PAGE_SIZE, type Range } from './query';

export const metadata: Metadata = { title: 'Moderation' };

const DAY = 86_400_000;
const ranges: Record<Range, number | null> = {
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
  all: null,
};

function pick(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export default async function ModerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guild } = await params;
  const raw = await searchParams;
  const loaded = await loadModule(guild, 'moderation', moderationConfig);
  const now = Date.now();

  const actionParam = pick(raw.action);
  const rangeParam = pick(raw.range);
  const query: CaseQuery = {
    action: (caseActions as readonly string[]).includes(actionParam)
      ? (actionParam as CaseAction)
      : null,
    mod: /^\d{1,21}$/.test(pick(raw.mod)) ? pick(raw.mod) : null,
    range: rangeParam in ranges ? (rangeParam as Range) : 'all',
    q: pick(raw.q).trim().slice(0, 100),
    page: Math.min(Math.max(Number.parseInt(pick(raw.page), 10) || 0, 0), 400),
  };
  const span = ranges[query.range];
  const selectedNumber = Number.parseInt(pick(raw.case), 10);

  const store = new ModerationStore(db().sql);
  const [rows, overview, moderators, commands, general, prefix] = await Promise.all([
    store.list(guild, {
      action: query.action ?? undefined,
      moderatorId: query.mod ?? undefined,
      since: span ? new Date(now - span) : undefined,
      search: query.q || undefined,
      limit: PAGE_SIZE + 1,
      offset: query.page * PAGE_SIZE,
    }),
    store.overview(guild, now),
    store.moderators(guild, new Date(now - 365 * DAY)),
    builtinCommands(db().sql).catch(() => []),
    db().modules.get(guild, 'general', generalConfig),
    db().guilds.prefix(guild),
  ]);

  const shown = rows.slice(0, PAGE_SIZE);
  const names = await people([
    ...shown.flatMap((row) => [row.userId, row.moderatorId]),
    ...moderators.slice(0, 20).map((row) => row.moderatorId),
  ]);
  const cases: CaseView[] = shown.map((row) => toView(row, names));

  let selected: CaseView | null = null;
  if (Number.isInteger(selectedNumber) && selectedNumber > 0) {
    const inList = cases.find((entry) => entry.number === selectedNumber);
    selected = inList ? await withUndo(guild, inList) : await caseDetail(guild, selectedNumber);
  } else if (cases[0]) {
    selected = await withUndo(guild, cases[0]);
  }

  const moderationCommands = commands
    .filter((command) => command.module === 'moderation')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((command) => ({
      name: command.name,
      description: command.description,
      on: !general.disabledCommands.includes(command.name),
    }));

  return (
    <ModuleShell {...loaded.shell}>
      <ModerationView
        initialTab={pick(raw.tab) === 'settings' ? 'settings' : 'cases'}
        query={query}
        cases={cases}
        more={rows.length > PAGE_SIZE}
        selected={selected}
        stats={{
          ...overview,
          timeoutEndsAt: overview.timeoutEndsAt
            ? new Date(overview.timeoutEndsAt).toISOString()
            : null,
        }}
        moderators={moderators.slice(0, 20).map((row) => ({
          id: row.moderatorId,
          name: names.get(row.moderatorId)?.name ?? row.moderatorId,
        }))}
        commands={moderationCommands}
        prefix={prefix}
        guildName={loaded.access.guild.name}
        viewerName={loaded.access.user.displayName}
        now={new Date(now).toISOString()}
      />
    </ModuleShell>
  );
}
