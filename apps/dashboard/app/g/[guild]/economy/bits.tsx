'use client';

import type { ReactNode } from 'react';
import { NumberInput } from '@/components/controls';
import { Empty, type Mood } from '@/components/ui';

export function Small({
  value,
  onChange,
  label,
  min = 0,
  max,
  width = 76,
  suffix,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  min?: number;
  max?: number;
  width?: number;
  suffix?: string;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ width }}>
        <NumberInput
          label={label}
          value={value}
          min={min}
          max={max}
          onChange={(next) => onChange(Math.trunc(next))}
        />
      </span>
      {suffix ? <span className="mx-suffix">{suffix}</span> : null}
    </span>
  );
}

export function StatStrip({
  stats,
  quiet = false,
}: {
  stats: { label: string; value: string; note?: string }[];
  quiet?: boolean;
}) {
  return (
    <div
      className={quiet ? 'mx-panel mx-stat-quiet' : 'mx-panel'}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="mx-stat">
          <span className="mx-stat-label">{stat.label}</span>
          <span className="mx-stat-value">{stat.value}</span>
          {stat.note && !quiet ? <span className="mx-sub">{stat.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="mx-inset"
      style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <span className="mx-stat-label">{label}</span>
      <span className="mx-ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>
        {value}
      </span>
      {sub ? <span className="mx-sub">{sub}</span> : null}
    </div>
  );
}

export function Inset({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-inset"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {children}
    </div>
  );
}

export function Section({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mx-panel-head" style={{ borderTop: '1px solid var(--mx-line)' }}>
      <h3>{title}</h3>
      {aside ? <span className="mx-sub">{aside}</span> : null}
    </div>
  );
}

export function Invite({
  mood = 'sleeping',
  children,
  action,
}: {
  mood?: Mood;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty mood={mood}>
      <div>{children}</div>
      {action ? (
        <div className="mx-inline" style={{ justifyContent: 'center', marginTop: 14 }}>
          {action}
        </div>
      ) : null}
    </Empty>
  );
}
