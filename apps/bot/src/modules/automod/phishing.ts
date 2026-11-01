import { domainToASCII, domainToUnicode } from 'node:url';
import { isPrivateAddress, isPublicHttps } from '../../net.js';

export const PHISHING_SOURCE = 'https://api.fishfish.gg/v1/domains?category=phishing';
export const PHISHING_EVERY = 6 * 60 * 60_000;
export const MIN_LIST_SIZE = 1_000;
const MAX_LIST_SIZE = 500_000;
const MAX_BYTES = 16 * 1024 * 1024;
const TIMEOUT = 30_000;
const USER_AGENT = 'MaxwellBot/1.0 (+https://fluxer.app; phishing list)';

export type Brand = 'fluxer' | 'discord' | 'steam' | 'nitro';

const OFFICIAL: Record<Exclude<Brand, 'nitro'>, string[]> = {
  fluxer: ['fluxer.app', 'fluxer.gg', 'fluxer.media', 'fluxerusercontent.com', 'fluxerstatic.com'],
  discord: [
    'discord.com',
    'discord.gg',
    'discord.gift',
    'discord.new',
    'discord.dev',
    'discord.co',
    'discord.media',
    'discord.design',
    'discord.store',
    'discordapp.com',
    'discordapp.net',
    'discordcdn.com',
    'discordstatus.com',
    'discordmerch.com',
    'discordpartygames.com',
    'dis.gd',
  ],
  steam: [
    'steampowered.com',
    'steamcommunity.com',
    'steamstatic.com',
    'steamcontent.com',
    'steamusercontent.com',
    'steamgames.com',
    'steamdeck.com',
    'steamchina.com',
    'steamserver.net',
    's.team',
    'valvesoftware.com',
    'steamgifts.com',
    'steamtrades.com',
  ],
};

const SHARED_HOSTS = [
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'r2.dev',
  'github.io',
  'gitlab.io',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'glitch.me',
  'repl.co',
  'replit.app',
  'onrender.com',
  'blogspot.com',
  'wixsite.com',
  'weebly.com',
  'webflow.io',
  'framer.website',
  'google.com',
  'googleusercontent.com',
  'amazonaws.com',
  'azurewebsites.net',
  'cloudfront.net',
  'youtube.com',
  'twitter.com',
  'x.com',
  'github.com',
];

const LOOKALIKE_TARGETS: { brand: Exclude<Brand, 'nitro'>; token: string }[] = [
  { brand: 'fluxer', token: 'fluxer' },
  { brand: 'discord', token: 'discord' },
  { brand: 'discord', token: 'discordapp' },
  { brand: 'steam', token: 'steamcommunity' },
  { brand: 'steam', token: 'steampowered' },
];

const LURE_BRANDS: Brand[] = ['fluxer', 'discord', 'steam', 'nitro'];

const LURES = [
  'nitro',
  'gift',
  'free',
  'claim',
  'promo',
  'airdrop',
  'giveaway',
  'reward',
  'bonus',
  'prize',
  'verify',
  'login',
  'signin',
  'auth',
  'trade',
  'appeal',
];

const LONG_TOKEN = 12;

const CONFUSABLES: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  з: '3',
  і: 'i',
  ї: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ı: 'i',
  ł: 'l',
  ø: 'o',
  đ: 'd',
  '@': 'a',
};

const DIGITS: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function unicodeHost(host: string): string {
  const lower = host.trim().toLowerCase().replace(/\.+$/, '');
  if (!lower.includes('xn--')) return lower;
  return domainToUnicode(lower) || lower;
}

export function asciiHost(host: string): string {
  const lower = host.trim().toLowerCase().replace(/\.+$/, '');
  if (/^[\x21-\x7e]*$/.test(lower)) return lower;
  return domainToASCII(lower) || lower;
}

export function cleanDomain(entry: string): string | null {
  let value = entry.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0] ?? value;
  value = value.slice(value.lastIndexOf('@') + 1);
  value = value.split(':')[0] ?? value;
  value = value
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .replace(/\.+$/, '');
  value = asciiHost(value);
  if (IPV4.test(value)) return isPrivateAddress(value) ? null : value;
  return HOSTNAME.test(value) ? value : null;
}

function under(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isOfficial(host: string): boolean {
  return Object.values(OFFICIAL).some((domains) => domains.some((domain) => under(host, domain)));
}

function wrapsOfficial(host: string): Exclude<Brand, 'nitro'> | null {
  for (const [brand, domains] of Object.entries(OFFICIAL)) {
    const wrapped = domains.some(
      (domain) => host.startsWith(`${domain}.`) || host.includes(`.${domain}.`),
    );
    if (wrapped) return brand as Exclude<Brand, 'nitro'>;
  }
  return null;
}

function protectedEntry(domain: string): boolean {
  return isOfficial(domain) || SHARED_HOSTS.some((shared) => under(shared, domain));
}

function rawEntries(body: string): unknown[] {
  const trimmed = body.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && 'domains' in parsed) {
      const domains = (parsed as { domains: unknown }).domains;
      return Array.isArray(domains) ? domains : [];
    }
    return [];
  }
  return trimmed.split(/\r?\n/).map((line) => {
    const content = line.replace(/\s[#!].*$/, '').trim();
    if (content.startsWith('#') || content.startsWith('!')) return '';
    const parts = content.split(/\s+/);
    return parts.length > 1 && /^[\d.:]+$/.test(parts[0] ?? '') ? parts[1] : parts[0];
  });
}

export function parseDomainList(body: string): string[] {
  const out = new Set<string>();
  for (const entry of rawEntries(body)) {
    if (typeof entry !== 'string') continue;
    const domain = cleanDomain(entry);
    if (!domain || protectedEntry(domain)) continue;
    out.add(domain);
    if (out.size >= MAX_LIST_SIZE) break;
  }
  return [...out];
}

export function acceptList(next: number, previous: number | null): boolean {
  if (next < MIN_LIST_SIZE) return false;
  return previous === null || next >= previous / 2;
}

function letters(text: string): string {
  let out = '';
  for (const char of text.toLowerCase()) out += CONFUSABLES[char] ?? char;
  return out.replace(/[^a-z0-9]/g, '');
}

function light(text: string): string {
  return letters(text).replace(/[0-9]/g, (digit) => DIGITS[digit] ?? digit);
}

export function skeleton(text: string): string {
  return light(text)
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[ij]/g, 'l')
    .replace(/(.)\1+/g, '$1');
}

function swapped(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff.push(i);
    if (diff.length > 2) return false;
  }
  const [first, second] = diff;
  return (
    first !== undefined && second === first + 1 && a[first] === b[second] && a[second] === b[first]
  );
}

export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const width = b.length + 1;
  const cells = new Array<number>((a.length + 1) * width).fill(0);
  const at = (i: number, j: number) => cells[i * width + j] ?? 0;
  for (let i = 0; i <= a.length; i++) cells[i * width] = i;
  for (let j = 0; j <= b.length; j++) cells[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      cells[i * width + j] = best;
    }
  }
  return at(a.length, b.length);
}

function imitates(label: string, token: string): boolean {
  const plain = label.replace(/-/g, '');
  if (plain.length < 4) return false;
  if (plain === token) return token.length >= LONG_TOKEN;
  const shape = skeleton(plain);
  const target = skeleton(token);
  if (shape === target) return true;
  if (swapped(light(plain), token)) return true;
  return token.length >= LONG_TOKEN && editDistance(shape, target, 2) <= 2;
}

export function lookalike(host: string): Brand | null {
  const name = unicodeHost(host).replace(/^www\./, '');
  const labels = name.split('.').filter(Boolean);
  if (labels.length < 2 || isOfficial(asciiHost(name))) return null;
  const wrapped = wrapsOfficial(asciiHost(name));
  if (wrapped) return wrapped;
  for (const label of labels.slice(0, -1)) {
    for (const parts of [[label], label.split('-')]) {
      for (const part of parts) {
        const hit = LOOKALIKE_TARGETS.find((target) => imitates(part, target.token));
        if (hit) return hit.brand;
      }
    }
  }
  const whole = light(labels.join(''));
  const shape = skeleton(labels.join(''));
  for (const brand of LURE_BRANDS) {
    if (!shape.includes(skeleton(brand))) continue;
    if (LURES.some((lure) => lure !== brand && whole.includes(lure))) return brand;
  }
  return null;
}

export interface PhishingHit {
  host: string;
  brand: Brand | null;
}

export class PhishingIndex {
  #domains: Set<string>;

  constructor(domains: Iterable<string> = []) {
    this.#domains = new Set(domains);
  }

  replace(domains: Iterable<string>): void {
    this.#domains = new Set(domains);
  }

  get size(): number {
    return this.#domains.size;
  }

  listed(host: string): string | null {
    const labels = asciiHost(host)
      .replace(/^www\./, '')
      .split('.')
      .filter(Boolean);
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      if (this.#domains.has(candidate)) return candidate;
    }
    return null;
  }

  check(
    hosts: readonly string[],
    options: { lookalikes: boolean; allowed: readonly string[] },
  ): PhishingHit | null {
    const allowed = options.allowed
      .map(cleanDomain)
      .filter((domain): domain is string => domain !== null);
    for (const host of hosts) {
      const ascii = asciiHost(host).replace(/^www\./, '');
      if (allowed.some((domain) => under(ascii, domain))) continue;
      if (this.listed(ascii)) return { host, brand: null };
      if (options.lookalikes) {
        const brand = lookalike(host);
        if (brand) return { host, brand };
      }
    }
    return null;
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) throw new Error('phishing list too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('phishing list too large');
    }
    parts.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(parts));
}

export async function downloadList(
  url: string = PHISHING_SOURCE,
  fetcher: Fetcher = fetch,
  checkUrl: (url: string) => Promise<boolean> = isPublicHttps,
): Promise<string[]> {
  if (!(await checkUrl(url))) throw new Error('phishing list url blocked');
  const response = await fetcher(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/plain;q=0.9' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`phishing list http ${response.status}`);
  }
  return parseDomainList(await readCapped(response));
}
