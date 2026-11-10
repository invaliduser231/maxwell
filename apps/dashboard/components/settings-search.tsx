'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Translator } from '@/lib/i18n';
import type { PageInfo } from '@/lib/pages';
import { POLE_COLOR } from '@/lib/pages';
import settings from '@/lib/settings-index.json';
import { useT } from './i18n';
import { ModuleIcon } from './ui';

interface Hit {
  page: PageInfo;
  label: string | null;
  text: string;
  score: number;
}

const LIMIT = 12;
const FIND_TIMEOUT = 5_000;

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function score(query: string, candidates: string[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const folded = fold(candidate);
    if (folded === query) return 4;
    if (folded.startsWith(query)) best = Math.max(best, 3);
    else if (folded.includes(` ${query}`)) best = Math.max(best, 2);
    else if (folded.includes(query)) best = Math.max(best, 1);
  }
  return best;
}

function search(t: Translator, pages: PageInfo[], input: string): Hit[] {
  const query = fold(input.trim());
  if (query.length < 2) return [];
  const byKey = new Map(pages.map((page) => [page.key, page]));
  const hits: Hit[] = [];
  for (const page of pages) {
    const name = t(page.name);
    const value = score(query, [name, page.name]);
    if (value > 0) hits.push({ page, label: null, text: name, score: value + 1 });
  }
  for (const entry of settings) {
    const page = byKey.get(entry.page);
    if (!page) continue;
    const text = t.raw(entry.label);
    const value = score(query, t.lang === 'en' ? [text] : [text, entry.label]);
    if (value > 0) hits.push({ page, label: entry.label, text, score: value });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, LIMIT);
}

function locate(root: Element, text: string): HTMLElement | null {
  const wanted = text.trim();
  let found: HTMLElement | null = null;
  for (const element of root.querySelectorAll<HTMLElement>('h2, span, button, label, legend')) {
    if (element.textContent?.trim() !== wanted) continue;
    if (element.offsetParent === null) continue;
    found = element;
    break;
  }
  if (!found) return null;
  return (
    found.closest<HTMLElement>('.mx-field, .mx-toggle-row, .mx-row') ??
    found.closest<HTMLElement>('.mx-panel') ??
    found
  );
}

function reveal(text: string): () => void {
  const root = document.querySelector('main');
  if (!root) return () => {};
  let observer: MutationObserver | null = null;
  const show = () => {
    const target = locate(root, text);
    if (!target) return false;
    observer?.disconnect();
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('mx-found');
    void target.offsetWidth;
    target.classList.add('mx-found');
    window.setTimeout(() => target.classList.remove('mx-found'), 2_400);
    return true;
  };
  if (show()) return () => {};
  observer = new MutationObserver(() => {
    show();
  });
  observer.observe(root, { childList: true, subtree: true });
  const timer = window.setTimeout(() => observer?.disconnect(), FIND_TIMEOUT);
  return () => {
    observer?.disconnect();
    window.clearTimeout(timer);
  };
}

export function useSettingFinder(): (text: string, href: string) => void {
  const pathname = usePathname();
  const router = useRouter();
  const [wanted, setWanted] = useState<{ text: string; path: string } | null>(null);

  useEffect(() => {
    if (!wanted || wanted.path !== pathname) return;
    return reveal(wanted.text);
  }, [pathname, wanted]);

  return (text, href) => {
    setWanted(text ? { text, path: href } : null);
    if (href !== pathname) router.push(href);
  };
}

export function SettingsSearch({
  base,
  pages,
  query,
  setQuery,
}: {
  base: string;
  pages: PageInfo[];
  query: string;
  setQuery: (next: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(t, pages, query), [t, pages, query]);
  const find = useSettingFinder();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const href = (page: PageInfo) => (page.key === 'overview' ? base : `${base}/${page.key}`);
  const open = (hit: Hit) => {
    setQuery('');
    input.current?.blur();
    find(hit.label ? hit.text : '', href(hit.page));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        ref={input}
        type="search"
        className="mx-input mx-nav-search"
        placeholder={t('Search settings')}
        aria-label={t('Search settings')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
          if (event.key === 'Enter' && hits[0]) {
            event.preventDefault();
            open(hits[0]);
          }
        }}
      />
      {query.trim().length >= 2 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {hits.length === 0 ? (
            <span className="mx-sub" style={{ padding: '8px 9px' }}>
              {t('No settings found.')}
            </span>
          ) : null}
          {hits.map((hit) => (
            <Link
              key={`${hit.page.key}:${hit.label ?? ''}`}
              className="mx-nav-item"
              style={{ '--pole': POLE_COLOR[hit.page.pole] } as React.CSSProperties}
              href={href(hit.page)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                open(hit);
              }}
            >
              <ModuleIcon d={hit.page.icon} fill="var(--pole)" size={22} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span>{hit.text}</span>
                {hit.label ? <span className="mx-sub">{t(hit.page.name)}</span> : null}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
