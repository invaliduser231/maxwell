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
import { type Person, people, personOf } from '@/lib/people';
import { age, duration, plural, snowflakeTime } from '@/lib/time';
import { moderatorName } from '../moderation/data';
import { ACTION_NAMES } from '../moderation/labels';

const DAY = 86_400_000;

const ruleLabels: Record<string, string> = {
  spam: 'Spam',
  invites: 'Invite links',
  links: 'Links',
  mentions: 'Mass mentions',
  caps: 'Caps',
  words: 'Word list',
  repeats: 'Repeated messages',
  emoji: 'Emoji spam',
  newAccountLinks: 'Links from new accounts',
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

function flagOf(row: MemberListRow): ListedMember['flag'] {
  if (row.banned) return { text: 'Banned', color: RED };
  if (row.timedOut) return { text: 'Timed out', color: YELLOW };
  if (row.review) return { text: 'Waiting for review', color: '#3A9EEA' };
  if (row.activeWarns > 0) {
    return {
      text: row.activeWarns === 1 ? '1 active warn' : `${row.activeWarns} active warns`,
      color: YELLOW,
    };
  }
  if (row.newAccount) return { text: 'New account', color: RED };
  if (row.nameChanges >= 3) return { text: `Renamed ${row.nameChanges} times`, color: YELLOW };
  return null;
}

export async function listMembers(
  guildId: string,
  view: MemberView,
  search: string,
  config: ModerationConfig,
): Promise<ListedMember[]> {
  const [rows, hits] = await Promise.all([
    new ModerationStore(db().sql).memberList(guildId, {
      view,
      search: search || null,
      expiryDays: config.warnExpiryDays,
      limit: 30,
    }),
    search.length >= 2 && !/^\d+$/.test(search)
      ? memberSearch(guildId, search, 10).catch(() => [])
      : Promise.resolve([]),
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
        flag: flagOf(row),
      };
    }),
    ...found,
  ];
}

function caseTitle(row: CaseRow, names: Map<string, Person>): string {
  const name = ACTION_NAMES[row.action] ?? row.action;
  const length =
    (row.action === 'timeout' || row.action === 'ban') && row.durationSeconds
      ? ` ${duration(row.durationSeconds * 1_000)}`
      : '';
  const voided = row.voidedAt ? ', void' : '';
  return `${name}${length}, case ${row.number}, by ${moderatorName(row, names)}${voided}`;
}

function caseColor(row: CaseRow): string {
  if (row.voidedAt) return '#6E727A';
  if (row.action === 'ban' || row.action === 'kick') return RED;
  if (row.action === 'unban' || row.action === 'untimeout') return '#2EB67D';
  return YELLOW;
}

const nameKinds: Record<string, string> = {
  username: 'Changed username',
  display: 'Changed display name',
  nick: 'Changed nickname',
};

async function moduleOn(guildId: string, key: string): Promise<boolean> {
  return (await db().modules.state(guildId, key)).enabled;
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
  const inviter = latest?.inviterId ? profiles.get(latest.inviterId)?.name : null;
  const invite = latest
    ? latest.joinSource === 2
      ? 'Vanity link'
      : latest.inviteCode
        ? `Invite ${latest.inviteCode}${inviter && latest.inviterId !== userId ? ` from ${inviter}` : ''}`
        : null
    : null;

  const risk: string[] = [];
  if (born !== null && now - born < 7 * DAY) risk.push(`Account is ${age(now - born)} old.`);
  if (latest && !latest.leftAt && now - new Date(latest.joinedAt).getTime() < DAY) {
    risk.push('Joined in the last 24 hours.');
  }
  const recentNames = names.filter((row) => now - new Date(row.changedAt).getTime() < 30 * DAY);
  if (recentNames.length >= 3) risk.push(`Changed names ${recentNames.length} times this month.`);
  if (summary.activeWarns > 0) risk.push(`${plural(summary.activeWarns, 'active warning')}.`);
  const bans = summary.actions.ban ?? 0;
  if (bans > 0) risk.push(bans === 1 ? 'Banned here before.' : `Banned here ${bans} times before.`);

  const timeline: TimelineItem[] = [];
  for (const row of cases) {
    timeline.push({
      id: `case-${row.number}`,
      kind: 'case',
      color: caseColor(row),
      title: caseTitle(row, profiles),
      detail: row.reason ?? 'No reason given',
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
      title: `Note #${note.number} by ${author}`,
      detail: note.body,
      quote: null,
      at: new Date(note.createdAt).toISOString(),
      noteId: note.id,
      caseNumber: null,
    });
  }
  for (const row of names) {
    timeline.push({
      id: `name-${row.id}`,
      kind: 'name',
      color: '#9A9EA6',
      title: nameKinds[row.kind] ?? 'Changed name',
      detail: `${row.previous ?? 'none'} to ${row.value ?? 'none'}`,
      quote: null,
      at: new Date(row.changedAt).toISOString(),
      noteId: null,
      caseNumber: null,
    });
  }
  for (const hit of hits) {
    timeline.push({
      id: `hit-${hit.id}`,
      kind: 'automod',
      color: '#3A9EEA',
      title: `AutoMod: ${ruleLabels[hit.rule] ?? hit.rule}${hit.action ? `, ${hit.action}` : ''}`,
      detail: hit.detail || (hit.mode === 'log' ? 'Logged only' : 'Message removed'),
      quote: hit.content,
      at: new Date(hit.createdAt).toISOString(),
      noteId: null,
      caseNumber: null,
    });
  }
  for (const [index, join] of joins.entries()) {
    const joinedAt = new Date(join.joinedAt);
    const parts: string[] = [];
    const via =
      join.joinSource === 2
        ? 'Vanity link'
        : join.inviteCode
          ? `Invite ${join.inviteCode}${join.inviterId && join.inviterId !== userId ? ` from ${personOf(profiles, join.inviterId).name}` : ''}`
          : null;
    if (via) parts.push(via);
    if (born !== null)
      parts.push(`account was ${age(Math.max(joinedAt.getTime() - born, 60_000))} old`);
    timeline.push({
      id: `join-${index}`,
      kind: 'join',
      color: '#2EB67D',
      title: 'Joined',
      detail: parts.join(', ') || 'No invite known',
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
        title: 'Left',
        detail: `Stayed ${age(Math.max(stay, 60_000))}`,
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
    balance: wallet ? `${wallet[0].toLocaleString('en-US')} ${wallet[1].currency.name}` : null,
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
            ? `${invited.total} stayed`
            : `${invited.stayed} of ${invited.total} stayed`,
    },
    risk,
    timeline: timeline.slice(0, 120),
  };
}
