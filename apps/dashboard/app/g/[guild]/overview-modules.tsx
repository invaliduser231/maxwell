'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Switch } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { LockIcon } from '@/components/ui';
import { setModuleEnabled } from '@/lib/actions';

export interface ModuleTile {
  key: string;
  page: string;
  name: string;
  south: boolean;
  enabled: boolean;
  editable: boolean;
  locked: boolean;
}

export function ModuleGrid({ tiles }: { tiles: ModuleTile[] }) {
  const { guildId } = useGuild();
  const [states, setStates] = useState(() =>
    Object.fromEntries(tiles.map((tile) => [tile.key, tile.enabled])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const active = tiles.filter((tile) => states[tile.key]).length;
  const incoming = tiles.map((tile) => `${tile.key}:${tile.enabled}`).join(',');

  const seen = useRef(incoming);

  useEffect(() => {
    if (incoming === seen.current) return;
    seen.current = incoming;
    setStates(
      Object.fromEntries(
        incoming.split(',').map((entry) => {
          const [key = '', on] = entry.split(':');
          return [key, on === 'true'];
        }),
      ),
    );
  }, [incoming]);

  const toggle = (tile: ModuleTile) => {
    const next = !states[tile.key];
    setStates((previous) => ({ ...previous, [tile.key]: next }));
    setError(null);
    setBusy(tile.key);
    start(async () => {
      const result = await setModuleEnabled(guildId, tile.key, next).catch(() => null);
      setBusy(null);
      if (!result?.ok) {
        setStates((previous) => ({ ...previous, [tile.key]: !next }));
        setError(result && !result.ok ? result.error : 'That did not work.');
      }
    });
  };

  return (
    <section className="mx-panel mx-s5" aria-labelledby="overview-modules">
      <div className="mx-panel-head">
        <h2 id="overview-modules">Modules</h2>
        {error ? (
          <span className="mx-status mx-status-error" role="status">
            {error}
          </span>
        ) : (
          <span className="mx-sub">
            {active} of {tiles.length} on
          </span>
        )}
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
      >
        {tiles.map((tile) => {
          const on = states[tile.key] ?? false;
          return (
            <div
              key={tile.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                borderTop: '1px solid var(--mx-line)',
                minWidth: 0,
              }}
            >
              <Link
                href={`/g/${guildId}/${tile.page}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13.5,
                  textDecoration: 'none',
                  color: on ? 'var(--mx-text)' : 'var(--mx-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {tile.name}
              </Link>
              {tile.locked ? <LockIcon /> : null}
              <Switch
                checked={on}
                order={tile.south}
                label={`${tile.name} ${on ? 'on' : 'off'}`}
                disabled={!tile.editable || tile.locked || busy === tile.key}
                onChange={() => toggle(tile)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
