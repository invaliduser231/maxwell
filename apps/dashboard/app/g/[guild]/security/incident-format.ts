import type { Translator } from '@/lib/i18n';
import type { TimelineEvent } from './incidents';

const kindLabels: Record<string, string> = {
  raid: 'Raid',
  manual: 'Raid mode by hand',
  nuke: 'Nuke',
  lockdown: 'Lockdown',
};

export function incidentKind(t: Translator, kind: string): string {
  return t.raw(kindLabels[kind] ?? kind);
}

export interface ReplayCounts {
  joins: number;
  bans: number;
  deleted: number;
  hits: number;
}

export function replayCounts(events: readonly TimelineEvent[]): ReplayCounts {
  const counts: ReplayCounts = { joins: 0, bans: 0, deleted: 0, hits: 0 };
  for (const event of events) {
    if (event.kind === 'join') counts.joins++;
    else if (event.kind === 'ban') counts.bans++;
    else if (event.kind === 'delete') counts.deleted += event.count;
    else if (event.kind === 'hit') counts.hits++;
  }
  return counts;
}

export function tallyText(
  t: Translator,
  tally: {
    joins: number;
    bans: number;
    kicks: number;
    timeouts: number;
    deleted: number;
    hits: number;
    channels: number;
    roles: number;
  },
): string {
  const parts = [
    tally.joins > 0 ? t('{n, plural, one {# join} other {# joins}}', { n: tally.joins }) : null,
    tally.bans > 0 ? t('{n, plural, one {# ban} other {# bans}}', { n: tally.bans }) : null,
    tally.kicks > 0 ? t('{n, plural, one {# kick} other {# kicks}}', { n: tally.kicks }) : null,
    tally.timeouts > 0
      ? t('{n, plural, one {# timeout} other {# timeouts}}', { n: tally.timeouts })
      : null,
    tally.deleted > 0
      ? t('{n, plural, one {# deleted message} other {# deleted messages}}', { n: tally.deleted })
      : null,
    tally.hits > 0
      ? t('{n, plural, one {# AutoMod hit} other {# AutoMod hits}}', { n: tally.hits })
      : null,
    tally.channels > 0
      ? t('{n, plural, one {# channel change} other {# channel changes}}', { n: tally.channels })
      : null,
    tally.roles > 0
      ? t('{n, plural, one {# role change} other {# role changes}}', { n: tally.roles })
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? t.list(parts) : t.raw('Nothing recorded');
}

function member(t: Translator, event: TimelineEvent): string {
  return event.user ?? t.raw('Someone');
}

function byWhom(
  t: Translator,
  event: TimelineEvent,
  texts: { maxwell: string; actor: string; plain: string },
): string {
  const name = member(t, event);
  if (event.byMaxwell) return t.raw(texts.maxwell, { name });
  if (event.actor) return t.raw(texts.actor, { name, actor: event.actor });
  return t.raw(texts.plain, { name });
}

export function timelineText(t: Translator, event: TimelineEvent): string {
  switch (event.kind) {
    case 'join':
      return event.score === null
        ? t.raw('{name} joined', { name: member(t, event) })
        : t.raw('{name} joined with risk score {score}', {
            name: member(t, event),
            score: event.score,
          });
    case 'ban':
      return byWhom(t, event, {
        maxwell: '{name} was banned by Maxwell',
        actor: '{name} was banned by {actor}',
        plain: '{name} was banned',
      });
    case 'kick':
      return byWhom(t, event, {
        maxwell: '{name} was kicked by Maxwell',
        actor: '{name} was kicked by {actor}',
        plain: '{name} was kicked',
      });
    case 'timeout':
      return byWhom(t, event, {
        maxwell: '{name} was timed out by Maxwell',
        actor: '{name} was timed out by {actor}',
        plain: '{name} was timed out',
      });
    case 'delete':
      return t('{n, plural, one {# message deleted} other {# messages deleted}}', {
        n: event.count,
      });
    case 'hit':
      return event.rule
        ? t.raw('AutoMod hit for {name} ({rule})', { name: member(t, event), rule: event.rule })
        : t.raw('AutoMod hit for {name}', { name: member(t, event) });
    case 'channelDelete':
      return t.raw('Channel {channel} deleted', { channel: `#${event.name ?? '?'}` });
    case 'channelCreate':
      return t.raw('Channel {channel} created', { channel: `#${event.name ?? '?'}` });
    case 'roleDelete':
      return t.raw('Role {role} deleted', { role: `@${event.name ?? '?'}` });
    case 'roleCreate':
      return t.raw('Role {role} created', { role: `@${event.name ?? '?'}` });
    case 'nuke':
      return t.raw('{name} was stopped for mass changes', {
        name: event.actor ?? t.raw('Someone'),
      });
    case 'lockdown':
      return event.on === false ? t.raw('Lockdown off') : t.raw('Lockdown on');
    default:
      return event.kind;
  }
}
