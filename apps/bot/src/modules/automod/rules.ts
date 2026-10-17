import { formatDuration } from '../../commands/duration.js';
import { snowflakeDate } from '../../ui/format.js';
import { copy } from './copy.js';
import {
  type AutomodConfig,
  type AutomodRule,
  type AutomodRuleKey,
  type AutomodRules,
  automodRuleKeys,
} from './types.js';

export interface Candidate {
  guildId: string;
  id: string;
  channelId: string;
  parentId: string | null;
  authorId: string;
  bot: boolean;
  roles: readonly string[];
  content: string;
  mentionUsers: number;
  mentionRoles: number;
  createdAt: Date;
}

export interface RuleHit {
  rule: AutomodRuleKey;
  detail: string;
}

export type EngineConfig = Pick<
  AutomodConfig,
  'exemptChannelIds' | 'exemptRoleIds' | 'ignoreBots'
> & { rules: Partial<AutomodRules> };

const ZERO_WIDTH = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(ZERO_WIDTH, '');
}

const INVITE =
  /(?:https?:\/\/)?(?:www\.)?(fluxer\.gg|(?:web\.)?fluxer\.app\/invite|discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]{2,64})/gi;

export interface InviteLink {
  host: string;
  code: string;
}

export function findInvites(content: string): InviteLink[] {
  const out: InviteLink[] = [];
  for (const match of normalize(content).matchAll(INVITE)) {
    const host = match[1]?.toLowerCase();
    const code = match[2];
    if (host && code) out.push({ host, code });
  }
  return out;
}

export function inviteCode(entry: string): string {
  const trimmed = entry.trim();
  const [found] = findInvites(trimmed);
  if (found) return found.code;
  return trimmed.split('/').filter(Boolean).at(-1) ?? trimmed;
}

const URL = /\bhttps?:\/\/([^\s/?#<>()[\]|"'`]+)/gi;
const BARE =
  /(?<![@\w./-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}))(?=$|[\s/?#:),.!'"\]>])/gi;
const COMMON_TLDS = new Set([
  'com',
  'net',
  'org',
  'io',
  'gg',
  'xyz',
  'ru',
  'de',
  'co',
  'me',
  'ly',
  'app',
  'link',
  'site',
  'online',
  'info',
  'biz',
  'tk',
  'ml',
  'ga',
  'cf',
  'top',
  'club',
  'shop',
  'live',
  'store',
  'uk',
  'us',
  'eu',
  'tv',
  'cc',
  'to',
  'sh',
  'dev',
  'ai',
  'gift',
  'fun',
]);

function cleanHost(raw: string): string {
  const afterAuth = raw.slice(raw.lastIndexOf('@') + 1);
  const host = afterAuth.split(':')[0] ?? afterAuth;
  return host.replace(/\.+$/, '').toLowerCase();
}

export function findLinks(content: string): string[] {
  const text = normalize(content);
  const hosts = new Set<string>();
  for (const match of text.matchAll(URL)) {
    if (match[1]) hosts.add(cleanHost(match[1]));
  }
  const withoutUrls = text.replace(/\bhttps?:\/\/\S+/gi, ' ');
  for (const match of withoutUrls.matchAll(BARE)) {
    const host = match[1];
    const tld = match[2]?.toLowerCase();
    if (!host || !tld) continue;
    const next = withoutUrls[(match.index ?? 0) + host.length];
    if (next === '/' || COMMON_TLDS.has(tld)) hosts.add(cleanHost(host));
  }
  hosts.delete('');
  return [...hosts];
}

export function normalizeDomain(entry: string): string {
  let value = entry.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, '');
  value = value.split(/[/?#]/)[0] ?? value;
  value = value.split(':')[0] ?? value;
  value = value
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .replace(/\.+$/, '');
  return value;
}

export function domainMatches(host: string, domains: readonly string[]): boolean {
  const bare = host.replace(/^www\./, '');
  return domains.some((entry) => {
    const domain = normalizeDomain(entry);
    return domain.length > 0 && (bare === domain || bare.endsWith(`.${domain}`));
  });
}

const MARKUP = /<a?:[\w~]+:\d+>|<[@#][!&]?\d+>|<t:\d+(?::\w)?>|\bhttps?:\/\/\S+/gi;

export function capsPercent(content: string): { letters: number; percent: number } {
  let letters = 0;
  let upper = 0;
  for (const char of content.replace(MARKUP, ' ')) {
    const lower = char.toLowerCase();
    const high = char.toUpperCase();
    if (lower === high) continue;
    letters++;
    if (char === high) upper++;
  }
  return { letters, percent: letters === 0 ? 0 : Math.round((upper / letters) * 100) };
}

const CUSTOM_EMOJI = /<a?:[\w~]+:\d+>/g;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function countEmojis(content: string): number {
  let total = content.match(CUSTOM_EMOJI)?.length ?? 0;
  for (const { segment } of segmenter.segment(content.replace(CUSTOM_EMOJI, ' '))) {
    if (PICTOGRAPHIC.test(segment)) total++;
  }
  return total;
}

export interface WordMatcher {
  regex: RegExp;
  patterns: string[];
}

const WORD_CHAR = '[\\p{L}\\p{N}_]';
const matcherCache = new Map<string, WordMatcher | null>();

function patternSource(pattern: string): string {
  return normalize(pattern.trim())
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .join(`${WORD_CHAR}*`);
}

export function compileWords(patterns: readonly string[]): WordMatcher | null {
  const usable = patterns.map((p) => p.trim()).filter((p) => p.replaceAll('*', '').length > 0);
  if (usable.length === 0) return null;
  const key = usable.join('\u0000');
  const cached = matcherCache.get(key);
  if (cached !== undefined) return cached;
  const body = usable.map((pattern) => `(${patternSource(pattern)})`).join('|');
  let matcher: WordMatcher | null;
  try {
    matcher = {
      regex: new RegExp(`(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})`, 'iu'),
      patterns: usable,
    };
  } catch {
    matcher = null;
  }
  if (matcherCache.size >= 200) matcherCache.clear();
  matcherCache.set(key, matcher);
  return matcher;
}

export function matchWords(content: string, patterns: readonly string[]): string | null {
  const matcher = compileWords(patterns);
  if (!matcher) return null;
  const match = matcher.regex.exec(normalize(content));
  if (!match) return null;
  const index = match.slice(1).findIndex((group) => group !== undefined);
  return matcher.patterns[index] ?? matcher.patterns[0] ?? null;
}

export function repeatKey(content: string): string | null {
  const key = normalize(content).toLowerCase().replace(/\s+/g, ' ').trim();
  return key.length >= 4 ? key : null;
}

interface Track {
  times: number[];
  texts: { key: string; at: number }[];
}

const TRACK_CAP = 60;
const STATEFUL = new Set<AutomodRuleKey>(['spam', 'repeats']);

export function isExempt(rule: AutomodRule, message: Candidate, isMod: boolean): boolean {
  if (rule.exemptMods && isMod) return true;
  if (rule.exemptChannelIds.includes(message.channelId)) return true;
  if (message.parentId && rule.exemptChannelIds.includes(message.parentId)) return true;
  return message.roles.some((role) => rule.exemptRoleIds.includes(role));
}

export class RuleEngine {
  readonly #tracks = new Map<string, Track>();

  constructor(private readonly maxTracked = 20_000) {}

  get tracked(): number {
    return this.#tracks.size;
  }

  evaluate(
    config: EngineConfig,
    message: Candidate,
    isMod: boolean,
    options: { stateless?: boolean } = {},
  ): RuleHit[] {
    if (message.bot && config.ignoreBots) return [];
    if (config.exemptChannelIds.includes(message.channelId)) return [];
    if (message.parentId && config.exemptChannelIds.includes(message.parentId)) return [];
    if (message.roles.some((role) => config.exemptRoleIds.includes(role))) return [];

    const hits: RuleHit[] = [];
    for (const key of automodRuleKeys) {
      const rule = config.rules[key];
      if (!rule || rule.mode === 'off' || isExempt(rule, message, isMod)) continue;
      if (options.stateless && STATEFUL.has(key)) continue;
      const detail = this.#check(key, rule, message);
      if (detail) hits.push({ rule: key, detail });
    }
    return hits;
  }

  #track(message: Candidate): Track {
    const id = `${message.guildId}:${message.authorId}`;
    let track = this.#tracks.get(id);
    if (track) {
      this.#tracks.delete(id);
    } else {
      track = { times: [], texts: [] };
      while (this.#tracks.size >= this.maxTracked) {
        const oldest = this.#tracks.keys().next().value;
        if (oldest === undefined) break;
        this.#tracks.delete(oldest);
      }
    }
    this.#tracks.set(id, track);
    return track;
  }

  #check(key: AutomodRuleKey, rule: AutomodRule, message: Candidate): string | null {
    const { content } = message;
    switch (key) {
      case 'spam': {
        if (!('maxMessages' in rule)) return null;
        const now = message.createdAt.getTime();
        const track = this.#track(message);
        const since = now - rule.perSeconds * 1000;
        track.times = track.times.filter((at) => at > since && at <= now);
        track.times.push(now);
        if (track.times.length > TRACK_CAP) track.times.splice(0, track.times.length - TRACK_CAP);
        return track.times.length > rule.maxMessages
          ? copy.details.spam(track.times.length, rule.perSeconds)
          : null;
      }
      case 'invites': {
        if (!('allowedCodes' in rule)) return null;
        const allowed = new Set(rule.allowedCodes.map(inviteCode));
        const hit = findInvites(content).find((invite) => !allowed.has(invite.code));
        return hit ? copy.details.invite(`${hit.host}/${hit.code}`) : null;
      }
      case 'links': {
        if (!('listMode' in rule)) return null;
        const hosts = findLinks(content);
        const hit =
          rule.listMode === 'deny'
            ? hosts.find((host) => domainMatches(host, rule.domains))
            : hosts.find((host) => !domainMatches(host, rule.domains));
        return hit ? copy.details.link(hit) : null;
      }
      case 'mentions': {
        if (!('maxMentions' in rule)) return null;
        const total = message.mentionUsers + (rule.countRoles ? message.mentionRoles : 0);
        return total > rule.maxMentions ? copy.details.mentions(total) : null;
      }
      case 'caps': {
        if (!('maxPercent' in rule)) return null;
        const { letters, percent } = capsPercent(content);
        return letters >= rule.minLength && percent > rule.maxPercent
          ? copy.details.caps(percent)
          : null;
      }
      case 'words': {
        if (!('patterns' in rule)) return null;
        const hit = matchWords(content, rule.patterns);
        return hit ? copy.details.word(hit) : null;
      }
      case 'repeats': {
        if (!('maxRepeats' in rule)) return null;
        const text = repeatKey(content);
        if (!text) return null;
        const now = message.createdAt.getTime();
        const track = this.#track(message);
        const since = now - rule.perSeconds * 1000;
        track.texts = track.texts.filter((entry) => entry.at > since && entry.at <= now);
        track.texts.push({ key: text, at: now });
        if (track.texts.length > TRACK_CAP) track.texts.splice(0, track.texts.length - TRACK_CAP);
        const same = track.texts.filter((entry) => entry.key === text).length;
        return same > rule.maxRepeats ? copy.details.repeats(same) : null;
      }
      case 'emoji': {
        if (!('maxEmojis' in rule)) return null;
        const total = countEmojis(content);
        return total > rule.maxEmojis ? copy.details.emoji(total) : null;
      }
      case 'newAccountLinks': {
        if (!('minAccountAgeHours' in rule)) return null;
        let age: number;
        try {
          age = message.createdAt.getTime() - snowflakeDate(message.authorId).getTime();
        } catch {
          return null;
        }
        if (age >= rule.minAccountAgeHours * 3_600_000) return null;
        if (findLinks(content).length === 0 && findInvites(content).length === 0) return null;
        return copy.details.newAccountLink(formatDuration(Math.max(age, 0)));
      }
    }
  }
}

export function onlyRule(key: AutomodRuleKey, rule: AutomodRule): Partial<AutomodRules> {
  return { [key]: rule } as Partial<AutomodRules>;
}
