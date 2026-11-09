import 'server-only';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import {
  createTranslator,
  isLang,
  type Key,
  LANG_COOKIE,
  type Lang,
  pickLang,
  type Table,
  type Translator,
} from '.';
import { areas } from './messages';

export const getLang = cache(async (): Promise<Lang> => {
  const stored = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(stored)) return stored;
  return pickLang((await headers()).get('accept-language'));
});

async function loadArea(lang: Lang, area: string): Promise<Table> {
  try {
    const loaded = (await import(`@/locales/${lang}/${area}.json`)) as { default: Table };
    return loaded.default;
  } catch {
    return {};
  }
}

export const tableFor = cache(async (lang: Lang): Promise<Table | null> => {
  if (lang === 'en') return null;
  const parts = await Promise.all(areas.map((area) => loadArea(lang, area)));
  return Object.assign({}, ...parts) as Table;
});

export const getT = cache(async (): Promise<Translator> => {
  const lang = await getLang();
  return createTranslator(lang, await tableFor(lang));
});

export function titled(key: Key): () => Promise<Metadata> {
  return async () => ({ title: (await getT())(key) });
}
