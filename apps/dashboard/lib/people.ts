import 'server-only';
import { userProfile } from './fluxer';
import { getT } from './i18n/server';

export const FORMER_MEMBER = 'Former member' as const;

export interface Person {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  bot: boolean;
  known: boolean;
}

export interface PersonView {
  name: string;
  avatar: string | null;
}

export type Names = Record<string, PersonView>;

const BATCH = 20;
const KNOWN_TTL = 5 * 60_000;
const MISSING_TTL = 60_000;
const CACHE_SIZE = 2_000;
const cache = new Map<string, { at: number; person: Person }>();

const MENTION = /<@!?(\d{1,21})>/g;

export function mentionedIds(text: string): string[] {
  return [...text.matchAll(MENTION)].flatMap((match) => (match[1] ? [match[1]] : []));
}

export function formerMember(id: string): Person {
  return { id, name: FORMER_MEMBER, handle: null, avatar: null, bot: false, known: false };
}

export function personOf(known: ReadonlyMap<string, Person>, id: string): Person {
  return known.get(id) ?? formerMember(id);
}

function cached(id: string, now: number): Person | null {
  const hit = cache.get(id);
  if (!hit) return null;
  if (now - hit.at < (hit.person.known ? KNOWN_TTL : MISSING_TTL)) return hit.person;
  cache.delete(id);
  return null;
}

async function lookup(id: string): Promise<Person> {
  const profile = await userProfile(id).catch(() => null);
  const person: Person = profile
    ? {
        id,
        name: profile.displayName,
        handle: profile.username,
        avatar: profile.avatarUrl,
        bot: profile.bot,
        known: true,
      }
    : formerMember(id);
  if (cache.size >= CACHE_SIZE) cache.clear();
  cache.set(id, { at: Date.now(), person });
  return person;
}

export async function people(
  ids: Iterable<string | null | undefined>,
  limit = 80,
): Promise<Map<string, Person>> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => Boolean(id) && id !== '0')),
  ].slice(0, limit);
  const now = Date.now();
  const found = new Map<string, Person>();
  const missing: string[] = [];
  for (const id of unique) {
    const hit = cached(id, now);
    if (hit) found.set(id, hit);
    else missing.push(id);
  }
  for (let start = 0; start < missing.length; start += BATCH) {
    const batch = await Promise.all(missing.slice(start, start + BATCH).map(lookup));
    for (const person of batch) found.set(person.id, person);
  }
  const t = await getT();
  return new Map(
    unique.map((id) => {
      const person = personOf(found, id);
      return [id, person.known ? person : { ...person, name: t(FORMER_MEMBER) }];
    }),
  );
}

export async function namesOf(
  ids: Iterable<string | null | undefined>,
  limit = 80,
): Promise<Names> {
  const known = await people(ids, limit);
  return Object.fromEntries(
    [...known.values()].map((person) => [person.id, { name: person.name, avatar: person.avatar }]),
  );
}
