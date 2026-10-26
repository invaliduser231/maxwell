import type { RiskWeights } from '@maxwell/core/modules/security';

export type RiskReason =
  | { key: 'age'; hours: number }
  | { key: 'noAvatar' }
  | { key: 'noName' }
  | { key: 'newWithoutAvatar' }
  | { key: 'randomName' }
  | { key: 'digitName' }
  | { key: 'spamName'; word: string }
  | { key: 'wave'; size: number }
  | { key: 'rejoin'; minutes: number }
  | { key: 'priorKick'; count: number }
  | { key: 'priorBan'; count: number }
  | { key: 'newInviter' }
  | { key: 'established' }
  | { key: 'raid' };

const reasonKeys = new Set([
  'age',
  'noAvatar',
  'noName',
  'newWithoutAvatar',
  'randomName',
  'digitName',
  'spamName',
  'wave',
  'rejoin',
  'priorKick',
  'priorBan',
  'newInviter',
  'established',
  'raid',
]);

export function storedReasons(values: readonly unknown[]): RiskReason[] {
  return values.filter(
    (value): value is RiskReason =>
      !!value &&
      typeof value === 'object' &&
      reasonKeys.has(String((value as { key?: unknown }).key)),
  );
}

export interface RiskInput {
  createdAt: Date;
  joinedAt: Date;
  hasAvatar: boolean;
  globalName: string | null;
  nick: string | null;
  username: string;
  displayName: string;
  waveSize: number;
  leftAt: Date | null;
  kicks: number;
  bans: number;
  inviterAgeHours: number | null;
  raid: boolean;
}

export interface RiskResult {
  score: number;
  reasons: RiskReason[];
}

const HOUR = 3_600_000;
const REJOIN_MINUTES = 30;
const ESTABLISHED_DAYS = 365;
const NEW_HOURS = 168;
const NEW_INVITER_HOURS = 72;

const VOWELS = /[aeiouy]/i;
const LETTERS = /^[a-z]+$/i;

export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function looksRandom(name: string): boolean {
  const clean = normalizeName(name);
  if (clean.length < 8) return false;
  const letters = clean.replace(/\d/g, '');
  if (letters.length >= 8 && LETTERS.test(letters)) {
    const vowels = [...letters].filter((char) => VOWELS.test(char)).length;
    if (vowels / letters.length < 0.18) return true;
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(letters)) return true;
  }
  const digits = clean.length - letters.length;
  const switches = [...clean].reduce((total, char, index) => {
    if (index === 0) return total;
    const prev = clean[index - 1] ?? '';
    return total + (/\d/.test(char) !== /\d/.test(prev) ? 1 : 0);
  }, 0);
  return digits >= 3 && letters.length >= 3 && switches >= 4;
}

export function hasDigitRun(name: string): boolean {
  return /\d{4,}/.test(name);
}

export function spamWord(names: readonly string[], words: readonly string[]): string | null {
  const cleaned = names.map(normalizeName);
  for (const word of words) {
    const needle = normalizeName(word);
    if (needle.length < 2) continue;
    if (cleaned.some((name) => name.includes(needle))) return word;
  }
  return null;
}

export function agePoints(
  hours: number,
  tiers: RiskWeights['ageTiers'],
): { points: number; tier: number } | null {
  const sorted = [...tiers].sort((a, b) => a.hours - b.hours);
  const hit = sorted.find((tier) => hours < tier.hours);
  return hit && hit.points > 0 ? { points: hit.points, tier: hit.hours } : null;
}

export function scoreMember(
  input: RiskInput,
  weights: RiskWeights,
  spamWords: readonly string[],
): RiskResult {
  const reasons: RiskReason[] = [];
  let score = 0;
  const add = (points: number, reason: RiskReason) => {
    if (points === 0) return;
    score += points;
    reasons.push(reason);
  };

  const hours = Math.max(0, (input.joinedAt.getTime() - input.createdAt.getTime()) / HOUR);
  const age = agePoints(hours, weights.ageTiers);
  if (age) add(age.points, { key: 'age', hours: age.tier });

  if (!input.hasAvatar) add(weights.noAvatar, { key: 'noAvatar' });
  if (!input.globalName && !input.nick) add(weights.noName, { key: 'noName' });
  if (!input.hasAvatar && hours < NEW_HOURS) {
    add(weights.newWithoutAvatar, { key: 'newWithoutAvatar' });
  }

  const names = [
    input.username,
    input.displayName,
    input.globalName ?? '',
    input.nick ?? '',
  ].filter(Boolean);
  const word = spamWord(names, spamWords);
  if (word) add(weights.spamName, { key: 'spamName', word });
  if (names.some(looksRandom)) add(weights.randomName, { key: 'randomName' });
  else if (names.some(hasDigitRun)) add(weights.digitName, { key: 'digitName' });

  if (input.waveSize > 1) add(weights.wave, { key: 'wave', size: input.waveSize });

  if (input.leftAt) {
    const minutes = (input.joinedAt.getTime() - input.leftAt.getTime()) / 60_000;
    if (minutes >= 0 && minutes <= REJOIN_MINUTES) {
      add(weights.rejoin, { key: 'rejoin', minutes: Math.max(1, Math.round(minutes)) });
    }
  }
  if (input.bans > 0) add(weights.priorBan, { key: 'priorBan', count: input.bans });
  if (input.kicks > 0) add(weights.priorKick, { key: 'priorKick', count: input.kicks });
  if (input.inviterAgeHours !== null && input.inviterAgeHours < NEW_INVITER_HOURS) {
    add(weights.newInviter, { key: 'newInviter' });
  }

  if (input.hasAvatar && hours >= ESTABLISHED_DAYS * 24 && reasons.length === 0) {
    add(weights.established, { key: 'established' });
  }
  if (input.raid) reasons.push({ key: 'raid' });

  return { score: Math.max(0, score), reasons };
}

export interface JoinSample {
  userId: string;
  at: number;
  createdAt: number;
  name: string;
  hasAvatar: boolean;
}

const CREATED_CLOSE = 36 * HOUR;
const SAMPLE_CAP = 500;

export function similarNames(a: string, b: string): boolean {
  const x = normalizeName(a).replace(/\d+/g, '');
  const y = normalizeName(b).replace(/\d+/g, '');
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  const prefix = Math.min(x.length, y.length, 5);
  return prefix >= 4 && x.slice(0, prefix) === y.slice(0, prefix);
}

export function waveAround(samples: readonly JoinSample[], current: JoinSample): JoinSample[] {
  const related = samples.filter(
    (sample) =>
      sample.userId !== current.userId &&
      (Math.abs(sample.createdAt - current.createdAt) <= CREATED_CLOSE ||
        similarNames(sample.name, current.name)) &&
      !sample.hasAvatar === !current.hasAvatar,
  );
  return related.length > 0 ? [...related, current] : [];
}

export class JoinLog {
  readonly #guilds = new Map<string, JoinSample[]>();

  constructor(private readonly guildCap = 10_000) {}

  add(guildId: string, sample: JoinSample, keepMs: number): JoinSample[] {
    const list = this.#guilds.get(guildId) ?? [];
    this.#guilds.delete(guildId);
    while (this.#guilds.size >= this.guildCap) {
      const oldest = this.#guilds.keys().next().value;
      if (oldest === undefined) break;
      this.#guilds.delete(oldest);
    }
    const fresh = list.filter(
      (entry) => entry.at > sample.at - keepMs && entry.userId !== sample.userId,
    );
    fresh.push(sample);
    if (fresh.length > SAMPLE_CAP) fresh.splice(0, fresh.length - SAMPLE_CAP);
    this.#guilds.set(guildId, fresh);
    return fresh;
  }

  recent(guildId: string, since: number): JoinSample[] {
    return (this.#guilds.get(guildId) ?? []).filter((entry) => entry.at > since);
  }

  clear(guildId: string): void {
    this.#guilds.delete(guildId);
  }
}
