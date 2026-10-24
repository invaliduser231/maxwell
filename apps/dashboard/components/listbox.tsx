'use client';

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface ListOption {
  value: string;
  label: string;
  hint?: string;
  color?: string;
  group?: string;
  muted?: boolean;
}

interface Place {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

const MAX_HEIGHT = 300;
const SEARCH_FROM = 9;

function Chevron() {
  return (
    <svg
      className="mx-listbox-chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M7 10l5 5 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OptionBody({ option }: { option: ListOption }) {
  return (
    <>
      {option.color ? <span className="mx-dot" style={{ background: option.color }} /> : null}
      <span className="mx-ellipsis" style={{ flex: 1, minWidth: 0 }}>
        {option.label}
      </span>
      {option.hint ? <span className="mx-option-hint">{option.hint}</span> : null}
    </>
  );
}

export function Listbox({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose',
  disabled = false,
  searchable,
  style,
  compact = false,
  trigger,
}: {
  value: string;
  options: readonly ListOption[];
  onChange: (next: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  style?: CSSProperties;
  compact?: boolean;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? null;
  const withSearch = searchable ?? options.length >= SEARCH_FROM;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        (option.group ?? '').toLowerCase().includes(needle),
    );
  }, [options, query]);

  const measure = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 220 && above > below;
    setPlace({
      left: rect.left,
      top: up ? rect.top - 6 : rect.bottom + 6,
      width: Math.max(rect.width, 200),
      maxHeight: Math.min(MAX_HEIGHT, Math.max(140, up ? above : below)),
      up,
    });
  }, []);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setQuery('');
    if (focus) button.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    measure();
    const index = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    setActive(index);
    setOpen(true);
  };

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
    if (withSearch) search.current?.focus();
    else list.current?.focus();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || list.current?.parentElement?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, withSearch, close]);

  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (option: ListOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(visible.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(visible.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(visible[active]);
    } else if (!withSearch && event.key.length === 1) {
      const now = Date.now();
      const text = now - typed.current.at < 700 ? typed.current.text + event.key : event.key;
      typed.current = { text, at: now };
      const index = visible.findIndex((option) =>
        option.label.toLowerCase().replace(/^#/, '').startsWith(text.toLowerCase()),
      );
      if (index >= 0) setActive(index);
    }
  };

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={button}
        type="button"
        className={compact ? 'mx-listbox-button mx-listbox-compact' : 'mx-listbox-button'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${selected?.label ?? placeholder}` : undefined}
        disabled={disabled}
        style={style}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && !open) {
            event.preventDefault();
            openList();
          }
        }}
      >
        {trigger ??
          (selected ? (
            <OptionBody option={{ ...selected, hint: undefined }} />
          ) : (
            <span className="mx-listbox-placeholder mx-ellipsis">{placeholder}</span>
          ))}
        <Chevron />
      </button>
      {open && place
        ? createPortal(
            <div
              role="dialog"
              aria-label={label ?? placeholder}
              className="mx-listbox"
              data-up={place.up}
              style={{
                left: place.left,
                width: place.width,
                ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
              }}
              onKeyDown={onKey}
            >
              {withSearch ? (
                <input
                  ref={search}
                  className="mx-listbox-search"
                  placeholder="Search"
                  aria-label="Search"
                  aria-controls={listId}
                  aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                />
              ) : null}
              <div
                ref={list}
                id={listId}
                role="listbox"
                aria-label={label}
                tabIndex={-1}
                aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
                className="mx-listbox-options"
                style={{ maxHeight: place.maxHeight - (withSearch ? 44 : 0) }}
              >
                {visible.length === 0 ? <div className="mx-option-empty">Nothing found</div> : null}
                {visible.map((option, index) => {
                  const header = option.group && option.group !== lastGroup ? option.group : null;
                  lastGroup = option.group;
                  return (
                    <div key={`${option.group ?? ''}-${option.value}`}>
                      {header ? <div className="mx-option-group">{header}</div> : null}
                      <div
                        id={`${listId}-${index}`}
                        role="option"
                        tabIndex={-1}
                        data-index={index}
                        aria-selected={option.value === value}
                        className={[
                          'mx-option',
                          index === active ? 'mx-option-active' : '',
                          option.muted ? 'mx-option-muted' : '',
                        ].join(' ')}
                        onMouseEnter={() => setActive(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(option)}
                        onKeyDown={() => undefined}
                      >
                        <OptionBody option={option} />
                        {option.value === value ? <Check /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
