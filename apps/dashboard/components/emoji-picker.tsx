'use client';

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Lang } from '@/lib/i18n';
import { type EmojiOption, useGuild } from './guild';
import { useT } from './i18n';

const CDN = 'https://fluxerusercontent.com/emojis';
const WIDTH = 332;
const HEIGHT = 360;
const COLUMNS = 8;
const SEARCH_LIMIT = 160;
const DATA_VERSION = '18.0.0-1';

interface Dataset {
  groups: { id: number; label: string }[];
  emojis: [string, string, string, number][];
}

interface Cell {
  value: string;
  label: string;
  custom: EmojiOption | null;
}

const datasets = new Map<Lang, Promise<Dataset>>();

function loadDataset(lang: Lang): Promise<Dataset> {
  let found = datasets.get(lang);
  if (!found) {
    found = fetch(`/emoji?lang=${lang}&v=${DATA_VERSION}`).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Dataset>;
    });
    found.catch(() => datasets.delete(lang));
    datasets.set(lang, found);
  }
  return found;
}

export function parseCustom(value: string): { name: string; id: string; animated: boolean } | null {
  const text = value.trim();
  const tagged = /^<(a?):([\w~-]{1,32}):(\d{15,21})>$/.exec(text);
  if (tagged?.[2] && tagged[3])
    return { name: tagged[2], id: tagged[3], animated: tagged[1] === 'a' };
  const bare = /^([\w~-]{1,32}):(\d{15,21})$/.exec(text);
  if (bare?.[1] && bare[2]) return { name: bare[1], id: bare[2], animated: false };
  return null;
}

function Smiley({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9.2" cy="10.2" r="1.1" fill="currentColor" />
      <circle cx="14.8" cy="10.2" r="1.1" fill="currentColor" />
      <path
        d="M8.6 14.2c.9 1.3 2.1 1.9 3.4 1.9s2.5-.6 3.4-1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmojiGlyph({
  value,
  size = 20,
  empty = 'icon',
}: {
  value: string | null | undefined;
  size?: number;
  empty?: 'icon' | 'none';
}) {
  const { emojis } = useGuild();
  const text = value?.trim() ?? '';
  if (!text) {
    return empty === 'icon' ? (
      <span className="mx-emoji-empty" style={{ width: size, height: size }}>
        <Smiley size={size} />
      </span>
    ) : null;
  }
  const custom = parseCustom(text);
  if (custom) {
    const animated =
      custom.animated || emojis.some((emoji) => emoji.id === custom.id && emoji.animated);
    return (
      <img
        className="mx-emoji-glyph"
        src={`${CDN}/${custom.id}.webp${animated ? '?animated=true' : ''}`}
        alt={`:${custom.name}:`}
        title={`:${custom.name}:`}
        width={size}
        height={size}
      />
    );
  }
  return (
    <span className="mx-emoji-glyph" style={{ fontSize: Math.round(size * 0.9), lineHeight: 1 }}>
      {text}
    </span>
  );
}

export function EmojiPicker({
  value,
  onChange,
  label,
  clearable = false,
  disabled = false,
  fallback,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  label: string;
  clearable?: boolean;
  disabled?: boolean;
  fallback?: string;
}) {
  const t = useT();
  const { emojis } = useGuild();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const [data, setData] = useState<Dataset | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'server' | number>(emojis.length > 0 ? 'server' : 0);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gridId = useId();

  const measure = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const up = below < HEIGHT && rect.top - 12 > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
    setPlace({ left, top: up ? rect.top - 6 : rect.bottom + 6, up });
  }, []);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setQuery('');
    if (focus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || panel.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  useEffect(() => {
    if (!open || data) return;
    let alive = true;
    setFailed(false);
    loadDataset(t.lang)
      .then((loaded) => {
        if (alive) setData(loaded);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, data, t.lang]);

  const cells = useMemo<Cell[]>(() => {
    const needle = query.trim().toLowerCase();
    const server: Cell[] = emojis.map((emoji) => ({
      value: `${emoji.name}:${emoji.id}`,
      label: emoji.name,
      custom: emoji,
    }));
    if (needle) {
      const found = server.filter((cell) => cell.label.toLowerCase().includes(needle));
      for (const [unicode, name, words] of data?.emojis ?? []) {
        if (found.length >= SEARCH_LIMIT) break;
        if (words.includes(needle)) found.push({ value: unicode, label: name, custom: null });
      }
      return found;
    }
    if (tab === 'server') return server;
    return (data?.emojis ?? [])
      .filter((entry) => entry[3] === tab)
      .map(([unicode, name]) => ({ value: unicode, label: name, custom: null }));
  }, [query, tab, emojis, data]);

  useEffect(() => {
    if (!open) return;
    grid.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (cell: Cell | undefined) => {
    if (!cell) return;
    onChange(cell.value);
    close();
  };

  const onKey = (event: KeyboardEvent) => {
    const last = cells.length - 1;
    const move = (next: number) => {
      event.preventDefault();
      setActive(Math.max(0, Math.min(last, next)));
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key === 'ArrowRight') move(active + 1);
    else if (event.key === 'ArrowLeft') move(active - 1);
    else if (event.key === 'ArrowDown') move(active + COLUMNS);
    else if (event.key === 'ArrowUp') move(active - COLUMNS);
    else if (event.key === 'Enter') {
      event.preventDefault();
      choose(cells[active]);
    }
  };

  const tabs: { key: 'server' | number; label: string; glyph: string | null }[] = [
    ...(emojis.length > 0
      ? [{ key: 'server' as const, label: t('This community'), glyph: null }]
      : []),
    ...(data?.groups ?? []).map((group) => ({
      key: group.id,
      label: group.label,
      glyph: data?.emojis.find((entry) => entry[3] === group.id)?.[0] ?? null,
    })),
  ];
  const loading = !data && !failed && (query.trim() !== '' || tab !== 'server');

  return (
    <>
      <span className="mx-emoji-field">
        <button
          ref={button}
          type="button"
          className="mx-emoji-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={value ? `${label}: ${value}` : label}
          title={label}
          disabled={disabled}
          onClick={() => {
            if (open) close();
            else {
              measure();
              setActive(0);
              setOpen(true);
            }
          }}
        >
          {!value && fallback ? (
            <span style={{ opacity: 0.55, display: 'inline-grid' }}>
              <EmojiGlyph value={fallback} size={20} />
            </span>
          ) : (
            <EmojiGlyph value={value} size={20} />
          )}
        </button>
        {clearable && value && !disabled ? (
          <button
            type="button"
            className="mx-btn mx-btn-ghost mx-emoji-clear"
            onClick={() => onChange(null)}
          >
            {t('Default')}
          </button>
        ) : null}
      </span>
      {open && place
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label={label}
              className="mx-emoji-panel"
              style={{
                left: place.left,
                width: WIDTH,
                ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
              }}
              onKeyDown={onKey}
            >
              <input
                ref={search}
                className="mx-listbox-search"
                placeholder={t('Search')}
                aria-label={t('Search')}
                aria-controls={gridId}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
              {query.trim() ? null : (
                <div className="mx-emoji-tabs" role="tablist" aria-label={t('Categories')}>
                  {tabs.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === entry.key}
                      aria-label={entry.label}
                      title={entry.label}
                      className="mx-emoji-tab"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setTab(entry.key);
                        setActive(0);
                      }}
                    >
                      {entry.glyph ?? <ServerIcon />}
                    </button>
                  ))}
                </div>
              )}
              <div
                ref={grid}
                id={gridId}
                role="listbox"
                aria-label={label}
                className="mx-emoji-grid"
              >
                {cells.map((cell, index) => (
                  <button
                    key={cell.value}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    data-index={index}
                    aria-selected={cell.value === value}
                    aria-label={cell.label}
                    title={cell.custom ? `:${cell.label}:` : cell.label}
                    className={
                      index === active ? 'mx-emoji-cell mx-emoji-cell-active' : 'mx-emoji-cell'
                    }
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(cell)}
                  >
                    {cell.custom ? (
                      <img
                        src={`${CDN}/${cell.custom.id}.webp${cell.custom.animated ? '?animated=true' : ''}`}
                        alt=""
                        width={26}
                        height={26}
                        loading="lazy"
                      />
                    ) : (
                      cell.value
                    )}
                  </button>
                ))}
                {cells.length === 0 ? (
                  <div className="mx-option-empty">
                    {loading
                      ? t('Loading')
                      : failed
                        ? t('Could not load emojis.')
                        : t('Nothing found')}
                  </div>
                ) : null}
              </div>
              <div className="mx-emoji-foot mx-ellipsis">{cells[active]?.label ?? ''}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ServerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M9 10h6M9 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
