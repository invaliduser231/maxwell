import 'server-only';
import { economyConfig } from '@maxwell/core/modules/economy';
import type { ModerationConfig } from '@maxwell/core/modules/moderation';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { EconomyStore } from '@maxwell/core/stores/economy';
import { LevelStore, levelOf } from '@maxwell/core/stores/levels';
import {
  type CaseRow,
  type MemberListRow,
  type MemberView,
  ModerationStore,
} from '@maxwell/core/stores/moderation';
import { db } from '@/lib/db';
import { guildMember, memberSearch } from '@/lib/fluxer';
import type { Key, Translator } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { type Person, people, personOf } from '@/lib/people';
import { age, duration, snowflakeTime } from '@/lib/time';
import { moderatorName } from '../moderation/data';
import { ACTION_NAMES } from '../moderation/labels';

const DAY = 86_400_000;

const ruleLabels: Record<string, Key> = {
  spam: 'Spam',
  invites: 'Invite links',
  links: 'Links',
  mentions: 'Mass mentions',
  caps: 'Caps',
  words: 'Word list',
  repeats: 'Repeated messages',
  emoji: 'Emoji spam',
  newAccountLinks: 'Links from new accounts',
  phishing: 'Phishing links',
};

export interface ListedMember {
  userId: string;
  name: string;
  avatar: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  lastAt: string;
  flag: { text: string; color: string } | null;
}

export type TimelineKind = 'case' | 'automod' | 'note' | 'name' | 'join' | 'leave';

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  color: string;
  title: string;
  detail: string;
  quote: string | null;
  at: string;
  noteId: string | null;
  caseNumber: number | null;
}

export interface MemberFile {
  userId: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  inServer: boolean;
  accountCreated: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  invite: string | null;
  level: number | null;
  balance: string | null;
  banned: boolean;
  timedOut: boolean;
  stats: { cases: number; activeWarns: number; automod: number; notes: number; invited: string };
  risk: string[];
  timeline: TimelineItem[];
}

const RED = '#EC5B78';
const YELLOW = '#F2C14E';

function flagOf(t: Translator, row: MemberListRow): ListedMember['flag'] {
  if (row.banned) return { text: t('Banned'), color: RED };
  if (row.timedOut) return { text: t('Timed out'), color: YELLOW };
  if (row.review) return { text: t('Waiting for review'), color: '#3A9EEA' };
  if (row.activeWarns > 0) {
    return {
      text: t.plural(row.activeWarns, '{n} active warn', '{n} active warns'),
      color: YELLOW,
    };
  }
  if (row.newAccount) return { text: t('New account'), color: RED };
  if (row.nameChanges >= 3) {
    return { text: t('Renamed {count} times', { count: row.nameChanges }), color: YELLOW };
  }
  return null;
}

export async function listMembers(
  guildId: string,
  view: MemberView,
  search: string,
  config: ModerationConfig,
): Promise<ListedMember[]> {
  const [rows, hits, t] = await Promise.all([
    new ModerationStore(db().sql).memberList(guildId, {
      view,
      search: search || null,
      expiryDays: config.warnExpiryDays,
      limit: 30,
    }),
    search.length >= 2 && !/^\d+$/.test(search)
      ? memberSearch(guildId, search, 10).catch(() => [])
      : Promise.resolve([]),
    getT(),
  ]);
  const listed = new Set(rows.map((row) => row.userId));
  const extra = hits.filter((hit) => !listed.has(hit.userId)).slice(0, 30 - rows.length);
  const profiles = await people([
    ...rows.map((row) => row.userId),
    ...extra.map((hit) => hit.userId),
  ]);
  const found: ListedMember[] = extra.flatMap((hit) => {
    const profile = profiles.get(hit.userId);
    if (!profile?.known) return [];
    const joined = hit.joinedAt?.toISOString() ?? null;
    return [
      {
        userId: hit.userId,
        name: profile.name,
        avatar: profile.avatar,
        joinedAt: joined,
        leftAt: null,
        lastAt: joined ?? new Date().toISOString(),
        flag: null,
      },
    ];
  });
  return [
    ...rows.map((row) => {
      const profile = profiles.get(row.userId);
      const known = profile?.known ? profile.name : null;
      return {
        userId: row.userId,
        name: known ?? row.display ?? row.username ?? row.userId,
        avatar: profile?.avatar ?? null,
        joinedAt: row.joinedAt ? new Date(row.joinedAt).toISOString() : null,
        leftAt: row.leftAt ? new Date(row.leftAt).toISOString() : null,
        lastAt: new Date(row.lastAt).toISOString(),
        flag: flagOf(t, row),
      };
    }),
    ...found,
  ];
}

function caseTitle(t: Translator, row: CaseRow, names: Map<string, Person>): string {
  const key = ACTION_NAMES[row.action];
  const name = key ? t(key) : row.action;
  const length =
    (row.action === 'timeout' || row.action === 'ban') && row.durationSeconds
      ? ` ${duration(t, row.durationSeconds * 1_000)}`
      : '';
  const text = t('{action}, case {number}, by {moderator}', {
    action: `${name}${length}`,
    number: String(row.number),
    moderator: t.raw(moderatorName(row, names)),
  });
  return row.voidedAt ? `${text}, ${t('void')}` : text;
}

function caseColor(row: CaseRow): string {
  if (row.voidedAt) return '#6E727A';
  if (row.action === 'ban' || row.action === 'kick') return RED;
  if (row.action === 'unban' || row.action === 'untimeout') return '#2EB67D';
  return YELLOW;
}

const nameKinds: Record<string, Key> = {
  username: 'Changed username',
  display: 'Changed display name',
  nick: 'Changed nickname',
};

async function moduleOn(guildId: string, key: string): Promise<boolean> {
  return (await db().modules.state(guildId, key)).enabled;
}

function inviteText(
  t: Translator,
  code: string | null,
  source: number | null,
  inviter: string | null,
): string | null {
  if (source === 2) return t('Vanity link');
  if (!code) return null;
  return inviter
    ? t('Invite {code} from {name}', { code, name: inviter })
    : t('Invite {code}', { code });
}

export async function loadFile(
  guildId: string,
  userId: string,
  config: ModerationConfig,
  listed: ListedMember | undefined,
): Promise<MemberFile | null> {
  const sql = db().sql;
  const store = new ModerationStore(sql);
  const automod = new AutomodStore(sql);
  const [
    summary,
    cases,
    notes,
    names,
    hits,
    hitCount,
    joins,
    invited,
    member,
    open,
    levelsOn,
    economyOn,
    t,
  ] = await Promise.all([
    store.summary(guildId, userId, config.warnExpiryDays),
    store.list(guildId, { userId, limit: 50 }),
    store.notes(guildId, userId, 50),
    store.nameHistory(guildId, userId, 25),
    automod.hitsForMember(guildId, userId, 25).catch(() => []),
    store.automodHits(guildId, userId).catch(() => 0),
    store.joins(guildId, userId, 20),
    store.invited(guildId, userId),
    guildMember(guildId, userId).catch(() => null),
    Promise.all([
      store.openCase(guildId, userId, 'ban'),
      store.openCase(guildId, userId, 'timeout'),
    ]),
    moduleOn(guildId, 'levels'),
    moduleOn(guildId, 'economy'),
    getT(),
  ]);

  const ids = [
    userId,
    ...cases.map((row) => row.moderatorId),
    ...notes.map((note) => note.authorId),
    ...joins.map((join) => join.inviterId),
  ];
  const profiles = await people(ids, 40);
  const profile = profiles.get(userId);
  const found = profile?.known ? profile : null;
  const anything =
    found !== null || cases.length > 0 || notes.length > 0 || joins.length > 0 || names.length > 0;
  if (!anything) return null;

  const [standing, wallet] = await Promise.all([
    levelsOn ? new LevelStore(sql).standing(guildId, userId).catch(() => null) : null,
    economyOn
      ? Promise.all([
          new EconomyStore(sql).balance(guildId, userId),
          db().modules.get(guildId, 'economy', economyConfig),
        ]).catch(() => null)
      : null,
  ]);
  const level = standing ? await levelOf(sql, guildId, userId).catch(() => null) : null;

  const born = snowflakeTime(userId);
  const latest = joins[0] ?? null;
  const now = Date.now();
  const inviterOf = (id: string | null) =>
    id && id !== userId ? personOf(profiles, id).name : null;
  const invite = latest
    ? inviteText(t, latest.inviteCode, latest.joinSource, inviterOf(latest.inviterId))
    : null;

  const risk: string[] = [];
  if (born !== null && now - born < 7 * DAY) {
    risk.push(t('Account is {age} old.', { age: age(t, now - born) }));
  }
  if (latest && !latest.leftAt && now - new Date(latest.joinedAt).getTime() < DAY) {
    risk.push(t('Joined in the last 24 hours.'));
  }
  const recentNames = names.filter((row) => now - new Date(row.changedAt).getTime() < 30 * DAY);
  if (recentNames.length >= 3) {
    risk.push(t('Changed names {count} times this month.', { count: recentNames.length }));
  }
  if (summary.activeWarns > 0) {
    risk.push(t.plural(summary.activeWarns, '{n} active warning.', '{n} active warnings.'));
  }
  const bans = summary.actions.ban ?? 0;
  if (bans > 0) {
    risk.push(t.plural(bans, 'Banned here before.', 'Banned here {n} times before.'));
  }

  const timeline: TimelineItem[] = [];
  for (const row of cases) {
    timeline.push({
      id: `case-${row.number}`,
      kind: 'case',
      color: caseColor(row),
      title: caseTitle(t, row, profiles),
      detail: row.reason ?? t('No reason given'),
      quote: row.excerpt,
      at: new Date(row.createdAt).toISOString(),
      noteId: null,
      caseNumber: row.number,
    });
  }
  for (const note of notes) {
    const author = note.authorId ? personOf(profiles, note.authorId).name : 'Maxwell';
    timeline.push({
      id: `note-${note.id}`,
      kind: 'note',
      color: '#C9CCD2',
      title: t('Note #{number} by {name}', { number: String(note.number), name: author }),
      detail: note.body,
      quote: null,
      at: new Date(note.createdAt).toISOString(),
      noteId: note.id,
      caseNumber: null,
    });
  }
  for (const row of names) {
    const kind = nameKinds[row.kind];
    timeline.push({
      id: `name-${row.id}`,
      kind: 'name',
      color: '#9A9EA6',
      title: kind ? t(kind) : t('Changed name'),
      detail: t('{before} to {after}', {
        before: row.previous ?? t('none'),
        after: row.value ?? t('none'),
      }),
      quote: null,
      at: new Date(row.changedAt).toISOString(),
      noteId: null,
      caseNumber: null,
    });
  }
  for (const hit of hits) {
    const rule = ruleLabels[hit.rule];
    const action = ACTION_NAMES[hit.action ?? ''];
    timeline.push({
      id: `hit-${hit.id}`,
      kind: 'automod',
      color: '#3A9EEA',
      title: `AutoMod: ${rule ? t(rule) : hit.rule}${hit.action ? `, ${action ? t(action) : hit.action}` : ''}`,
      detail: hit.detail || (hit.mode === 'log' ? t('Logged only') : t('Message removed')),
      quote: hit.content,
      at: new Date(hit.createdAt).toISOString(),
      noteId: null,
      caseNumber: null,
    });
  }
  for (const [index, join] of joins.entries()) {
    const joinedAt = new Date(join.joinedAt);
    const parts: string[] = [];
    const via = inviteText(t, join.inviteCode, join.joinSource, inviterOf(join.inviterId));
    if (via) parts.push(via);
    if (born !== null) {
      parts.push(
        t('account was {age} old', {
          age: age(t, Math.max(joinedAt.getTime() - born, 60_000)),
        }),
      );
    }
    timeline.push({
      id: `join-${index}`,
      kind: 'join',
      color: '#2EB67D',
      title: t('Joined'),
      detail: parts.join(', ') || t('No invite known'),
      quote: null,
      at: joinedAt.toISOString(),
      noteId: null,
      caseNumber: null,
    });
    if (join.leftAt) {
      const stay = new Date(join.leftAt).getTime() - joinedAt.getTime();
      timeline.push({
        id: `leave-${index}`,
        kind: 'leave',
        color: '#8A8F98',
        title: t('Left'),
        detail: t('Stayed {span}', { span: age(t, Math.max(stay, 60_000)) }),
        quote: null,
        at: new Date(join.leftAt).toISOString(),
        noteId: null,
        caseNumber: null,
      });
    }
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  return {
    userId,
    name: found ? found.name : (listed?.name ?? userId),
    handle: profile?.handle ?? null,
    avatar: profile?.avatar ?? null,
    inServer: member !== null,
    accountCreated: born !== null ? new Date(born).toISOString() : null,
    joinedAt: latest ? new Date(latest.joinedAt).toISOString() : null,
    leftAt: latest?.leftAt ? new Date(latest.leftAt).toISOString() : null,
    invite,
    level,
    balance: wallet ? `${t.count(wallet[0])} ${wallet[1].currency.name}` : null,
    banned: open[0] !== null,
    timedOut: open[1] !== null,
    stats: {
      cases: summary.total,
      activeWarns: summary.activeWarns,
      automod: hitCount,
      notes: summary.notes,
      invited:
        invited.total === 0
          ? '0'
          : invited.stayed === invited.total
            ? t('{count} stayed', { count: invited.total })
            : t('{active} of {total} stayed', { active: invited.stayed, total: invited.total }),
    },
    risk,
    timeline: timeline.slice(0, 120),
  };
}
