import { AsyncLocalStorage } from 'node:async_hooks';
import { type Language, languages } from '@maxwell/core/modules/general';

export type { Language };
export { languages };

const locales: Record<Language, string> = { en: 'en-US', de: 'de-DE' };

const store = new AsyncLocalStorage<Language>();

type Source = (guildId: string) => Promise<Language>;

let source: Source | null = null;

export function setLanguageSource(next: Source | null): void {
  source = next;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (languages as readonly string[]).includes(value);
}

export function language(): Language {
  return store.getStore() ?? 'en';
}

export function locale(): string {
  return locales[language()];
}

export function withLanguage<T>(next: Language, run: () => T): T {
  return store.run(next, run);
}

export async function languageOf(guildId: string | null | undefined): Promise<Language> {
  if (!guildId || !source) return 'en';
  try {
    return await source(guildId);
  } catch {
    return 'en';
  }
}

export async function inGuild<T>(
  guildId: string | null | undefined,
  run: () => Promise<T> | T,
): Promise<T> {
  return withLanguage(await languageOf(guildId), run);
}
