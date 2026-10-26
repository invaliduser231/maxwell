'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { createTranslator, type Lang, type Table, type Translator } from '@/lib/i18n';

const Context = createContext<Translator>(createTranslator('en', null));

export function I18nProvider({
  lang,
  table,
  children,
}: {
  lang: Lang;
  table: Table | null;
  children: ReactNode;
}) {
  const t = useMemo(() => createTranslator(lang, table), [lang, table]);
  return <Context.Provider value={t}>{children}</Context.Provider>;
}

export function useT(): Translator {
  return useContext(Context);
}
