'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { pageByKey } from '@/lib/pages';

type Listener = (modules: string[]) => void;

const Context = createContext<((listener: Listener) => () => void) | null>(null);

const REFRESH_GAP_MS = 1_500;
const EVERYWHERE = new Set(['general', 'prefix', 'structure']);

function pageModules(pathname: string, guildId: string): Set<string> | 'all' | null {
  const base = `/g/${guildId}`;
  if (pathname === base) return 'all';
  const key = pathname.slice(base.length + 1).split('/')[0] ?? '';
  if (key === 'audit') return null;
  const module = pageByKey(key)?.module;
  return module ? new Set([module]) : null;
}

function useThrottled(run: () => void): () => void {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(run);
  latest.current = run;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) return;
    const wait = Math.max(0, last.current + REFRESH_GAP_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      latest.current();
    }, wait);
  }, []);
}

export function LiveProvider({ guildId, children }: { guildId: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const listeners = useRef(new Set<Listener>());
  const path = useRef(pathname);
  path.current = pathname;
  const refresh = useThrottled(() => router.refresh());

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let hiddenAt = 0;

    const deliver = (modules: string[]) => {
      for (const listener of listeners.current) listener(modules);
      const wanted = pageModules(path.current, guildId);
      if (!wanted) return;
      const relevant =
        wanted === 'all' ||
        modules.some((module) => module === '*' || wanted.has(module) || EVERYWHERE.has(module));
      if (relevant) refresh();
    };

    const open = () => {
      if (source) return;
      source = new EventSource(`/g/${guildId}/live`);
      source.onmessage = (event) => {
        try {
          const modules = JSON.parse(event.data) as unknown;
          if (Array.isArray(modules)) deliver(modules.map(String));
        } catch {}
      };
    };

    const close = () => {
      source?.close();
      source = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        close();
        return;
      }
      open();
      if (hiddenAt) deliver(['*']);
      hiddenAt = 0;
    };

    if (document.visibilityState === 'visible') open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
    };
  }, [guildId, refresh]);

  return <Context.Provider value={subscribe}>{children}</Context.Provider>;
}

export function useLive(modules: readonly string[], onChange: () => void): void {
  const subscribe = useContext(Context);
  const latest = useRef(onChange);
  latest.current = onChange;
  const key = modules.join(',');
  useEffect(() => {
    if (!subscribe) return;
    const wanted = new Set(key.split(','));
    return subscribe((changed) => {
      if (changed.some((module) => module === '*' || wanted.has(module))) latest.current();
    });
  }, [subscribe, key]);
}

export function useRemote<T>(
  incoming: T,
  dirty: boolean,
  apply: (next: T) => void,
  own?: (fingerprint: string) => boolean,
): { stale: boolean; take: () => void } {
  const seen = useRef(fingerprint(incoming));
  const [remote, setRemote] = useState<{ value: T } | null>(null);
  const latest = useRef(apply);
  latest.current = apply;
  const mine = useRef(own);
  mine.current = own;

  useEffect(() => {
    const next = fingerprint(incoming);
    if (next === seen.current) return;
    seen.current = next;
    if (dirty && mine.current?.(next)) return;
    if (dirty) {
      setRemote({ value: incoming });
      return;
    }
    setRemote(null);
    latest.current(incoming);
  }, [incoming, dirty]);

  useEffect(() => {
    if (!dirty && remote) {
      setRemote(null);
    }
  }, [dirty, remote]);

  const take = useCallback(() => {
    if (!remote) return;
    latest.current(remote.value);
    setRemote(null);
  }, [remote]);

  return { stale: remote !== null, take };
}

export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}
