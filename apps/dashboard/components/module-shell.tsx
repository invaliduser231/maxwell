'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { saveModule, setModuleEnabled } from '@/lib/actions';
import type { Key } from '@/lib/i18n';
import { allPages, type PageInfo, POLE_COLOR, type Pole, pageByKey } from '@/lib/pages';
import { useGuild } from './guild';
import { useT } from './i18n';
import { fingerprint, useRemote } from './live';
import { failed, type Status, StatusText } from './status-text';
import { Callout, ModuleIcon } from './ui';
import { VoteLock } from './vote-lock';

interface DraftContext {
  value: Record<string, unknown>;
  update: (fn: (previous: Record<string, unknown>) => Record<string, unknown>) => void;
  readOnly: boolean;
  dirty: boolean;
  save: () => Promise<boolean>;
}

const Draft = createContext<DraftContext | null>(null);
const ReadOnly = createContext(false);

export function useReadOnly(): boolean {
  return useContext(ReadOnly);
}

export function useDraft<T extends object>(): {
  value: T;
  set: (patch: Partial<T>) => void;
  update: (fn: (previous: T) => T) => void;
  readOnly: boolean;
  dirty: boolean;
  save: () => Promise<boolean>;
} {
  const context = useContext(Draft);
  if (!context) throw new Error('useDraft outside ModuleShell');
  return {
    value: context.value as T,
    set: (patch) => context.update((previous) => ({ ...previous, ...patch })),
    update: (fn) =>
      context.update((previous) => fn(previous as T) as unknown as Record<string, unknown>),
    readOnly: context.readOnly,
    dirty: context.dirty,
    save: context.save,
  };
}

function PageMark({ page }: { page: PageInfo }) {
  const color = page.pole === 'neutral' ? '#8E929A' : POLE_COLOR[page.pole];
  return (
    <span className="mx-page-mark" aria-hidden="true">
      <ModuleIcon d={page.icon} fill={color} size={30} className="mx-page-icon" />
    </span>
  );
}

export function PageHeader({
  title,
  page,
  pole = 'neutral',
  enabled,
  onToggle,
  toggleDisabled,
  badge,
  children,
}: {
  title: string;
  page?: string;
  pole?: Pole;
  enabled?: boolean;
  onToggle?: (next: boolean) => void;
  toggleDisabled?: boolean;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  const info =
    (page ? pageByKey(page) : undefined) ?? allPages.find((entry) => entry.name === title);
  return (
    <div className="mx-between" style={{ minHeight: 40, gap: '10px 16px' }}>
      <div className="mx-page-head">
        {info ? <PageMark page={info} /> : null}
        <h1 className="mx-h1">{title}</h1>
        {enabled !== undefined && onToggle ? (
          <button
            type="button"
            className={pole === 'south' ? 'mx-switch mx-order' : 'mx-switch'}
            role="switch"
            aria-checked={enabled}
            aria-label={
              enabled ? t('{name} on', { name: title }) : t('{name} off', { name: title })
            }
            disabled={toggleDisabled}
            onClick={() => onToggle(!enabled)}
          />
        ) : null}
        {badge ? <span className="mx-chip">{badge}</span> : null}
      </div>
      <div className="mx-inline">{children}</div>
    </div>
  );
}

export function DirtyActions({
  dirty,
  pending,
  status,
  stale = false,
  onDiscard,
  onSave,
  children,
}: {
  dirty: boolean;
  pending: boolean;
  status: Status;
  stale?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <StatusText status={status} />
      {dirty ? (
        <>
          {status ? null : (
            <span className="mx-sub">{stale ? t('Changed elsewhere') : t('Unsaved changes')}</span>
          )}
          <button type="button" className="mx-btn" disabled={pending} onClick={onDiscard}>
            {t('Discard')}
          </button>
          <button
            type="button"
            className="mx-btn mx-btn-primary"
            disabled={pending}
            onClick={onSave}
          >
            {pending ? t('Saving') : t('Save')}
          </button>
        </>
      ) : (
        children
      )}
    </>
  );
}

export function useSortedFade(status: Status, clear: () => void): void {
  useEffect(() => {
    if (!status || status.error) return;
    const timer = setTimeout(clear, 2500);
    return () => clearTimeout(timer);
  }, [status, clear]);
}

export function useLeaveWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

interface ShellProps {
  module: string;
  title: Key;
  pole: Pole;
  initial: Record<string, unknown>;
  enabled: boolean;
  toggleable: boolean;
  readOnly: boolean;
  locked: boolean;
  badge?: ReactNode;
  actions?: ReactNode;
  resetKey?: string | number;
  onSaved?: (saved: Record<string, unknown>) => void;
  children: ReactNode;
}

export function ModuleShell(props: ShellProps) {
  return <Shell key={props.resetKey} {...props} />;
}

function Shell({
  module,
  title,
  pole,
  initial,
  enabled,
  toggleable,
  readOnly,
  locked,
  badge,
  actions,
  onSaved,
  children,
}: ShellProps) {
  const { guildId } = useGuild();
  const t = useT();
  const name = t(title);
  const [baseline, setBaseline] = useState(initial);
  const [value, setValue] = useState(initial);
  const [on, setOn] = useState(enabled);
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const [pending, start] = useTransition();
  const blocked = readOnly || locked;
  const current = useMemo(() => fingerprint(value), [value]);
  const dirty = current !== fingerprint(baseline);
  const clearStatus = useCallback(() => setStatus(null), []);
  const valueRef = useRef(value);
  valueRef.current = value;
  const flight = useRef<Promise<boolean> | null>(null);
  const savedPrints = useRef(new Set<string>());
  const rejected = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remote = useRemote(
    initial,
    dirty || saving || pending,
    (next) => {
      setBaseline(next);
      setValue(next);
    },
    (print) => savedPrints.current.has(print),
  );

  useEffect(() => {
    if (!pending) setOn(enabled);
  }, [enabled, pending]);

  useLeaveWarning(dirty);
  useSortedFade(status, clearStatus);

  const update = useCallback(
    (fn: (previous: Record<string, unknown>) => Record<string, unknown>) => {
      if (blocked) return;
      setValue((previous) => fn(previous));
      setStatus((previous) => (previous?.error ? null : previous));
    },
    [blocked],
  );

  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const persist = async (): Promise<boolean> => {
    if (flight.current) await flight.current;
    const snapshot = valueRef.current;
    const print = fingerprint(snapshot);
    if (print === fingerprint(baselineRef.current)) return true;
    setSaving(true);
    const run = saveModule(guildId, module, snapshot).then((result) => {
      if (!result.ok) {
        rejected.current = print;
        setStatus(failed(result.error));
        return false;
      }
      const saved = result.data ?? snapshot;
      const savedPrint = fingerprint(saved);
      savedPrints.current.add(savedPrint);
      if (savedPrints.current.size > 20) {
        savedPrints.current.delete(savedPrints.current.values().next().value ?? '');
      }
      rejected.current = null;
      baselineRef.current = saved;
      setBaseline(saved);
      setValue((now) => (fingerprint(now) === print ? saved : now));
      setStatus({ message: 'Saved', error: false });
      onSaved?.(saved);
      return true;
    });
    flight.current = run;
    try {
      return await run;
    } finally {
      if (flight.current === run) {
        flight.current = null;
        setSaving(false);
      }
    }
  };

  const persistRef = useRef(persist);
  persistRef.current = persist;
  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return persistRef.current();
  }, []);

  const auto = !blocked && dirty && !remote.stale && rejected.current !== current;

  useEffect(() => {
    if (!auto || !current) return;
    const typing = document.activeElement?.matches(
      'textarea, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range])',
    );
    timer.current = setTimeout(
      () => {
        timer.current = null;
        void persistRef.current();
      },
      typing ? 1_200 : 250,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [auto, current]);

  const autoRef = useRef(auto);
  autoRef.current = auto;
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    const leave = (event: FocusEvent) => {
      const target = event.target;
      if (!autoRef.current || !(target instanceof Element)) return;
      if (target.matches('textarea, input, [contenteditable]')) void saveNow();
    };
    node.addEventListener('focusout', leave);
    return () => node.removeEventListener('focusout', leave);
  }, [saveNow]);
  useEffect(
    () => () => {
      if (autoRef.current) void persistRef.current();
    },
    [],
  );

  const save = () =>
    start(async () => {
      await saveNow();
    });

  const toggle = (next: boolean) =>
    start(async () => {
      setOn(next);
      const result = await setModuleEnabled(guildId, module, next);
      if (!result.ok) {
        setOn(!next);
        setStatus(failed(result.error));
      }
    });

  const context = useMemo(
    () => ({ value, update, readOnly: blocked, dirty, save: saveNow }),
    [value, update, blocked, dirty, saveNow],
  );

  const body = (
    <Draft.Provider value={context}>
      <ReadOnly.Provider value={blocked}>
        <div ref={area} className="mx-contents">
          {children}
        </div>
      </ReadOnly.Provider>
    </Draft.Provider>
  );

  return (
    <>
      <PageHeader
        title={name}
        page={
          allPages.find((entry) => entry.module === module && entry.name === title)?.key ?? module
        }
        pole={pole}
        enabled={toggleable ? on : undefined}
        onToggle={toggleable ? toggle : undefined}
        toggleDisabled={blocked || pending}
        badge={badge ?? (readOnly ? t('View only') : undefined)}
      >
        <DirtyActions
          dirty={dirty && (remote.stale || rejected.current === current)}
          pending={pending || saving}
          status={saving && !status?.error ? { message: 'Saving', error: false } : status}
          stale={remote.stale}
          onDiscard={() => (remote.stale ? remote.take() : setValue(baseline))}
          onSave={save}
        >
          {actions}
        </DirtyActions>
      </PageHeader>
      {toggleable && !on && !locked ? (
        <Callout
          tone="warn"
          action={
            readOnly ? null : (
              <button
                type="button"
                className="mx-btn mx-btn-primary"
                disabled={pending}
                onClick={() => toggle(true)}
              >
                {t('Turn on')}
              </button>
            )
          }
        >
          {t('{name} is off. Nothing runs until you turn it on.', { name })}
        </Callout>
      ) : null}
      {locked ? (
        <div className="mx-lock-wrap">
          <div aria-hidden="true" inert>
            {body}
          </div>
          <div className="mx-lock-cover">
            <VoteLock module={name} />
          </div>
        </div>
      ) : (
        body
      )}
    </>
  );
}
