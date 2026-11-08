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
import { messages } from './messages';
import { messagesEs } from './messages-es';

export const getLang = cache(async (): Promise<Lang> => {
  const stored = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(stored)) return stored;
  return pickLang((await headers()).get('accept-language'));
});

export function tableFor(lang: Lang): Table | null {
  if (lang === 'de') return messages;
  if (lang === 'es') return messagesEs;
  return null;
}

export const getT = cache(async (): Promise<Translator> => {
  const lang = await getLang();
  return createTranslator(lang, tableFor(lang));
});

export function titled(key: Key): () => Promise<Metadata> {
  return async () => ({ title: (await getT())(key) });
}
