import type { ReactNode } from 'react';

type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12;

export function Grid({ children }: { children: ReactNode }) {
  return <div className="mx-grid">{children}</div>;
}

export function Panel({
  title,
  span = 12,
  actions,
  children,
  id,
}: {
  title?: ReactNode;
  span?: Span;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`mx-panel mx-s${span}`} aria-labelledby={headingId} id={id}>
      {title || actions ? (
        <div className="mx-panel-head">
          {title ? <h2 id={headingId}>{title}</h2> : <span />}
          {actions ? <div className="mx-inline">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Column({ span, children }: { span: Span; children: ReactNode }) {
  return <div className={`mx-col mx-s${span}`}>{children}</div>;
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="mx-panel-body">{children}</div>;
}

export function Fields({ children }: { children: ReactNode }) {
  return <div className="mx-fields">{children}</div>;
}

export function Field({
  label,
  hint,
  aside,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="mx-field">
      <span
        className="mx-label"
        style={aside ? { display: 'flex', justifyContent: 'space-between' } : undefined}
      >
        <span>{label}</span>
        {aside ? <span className="mx-muted">{aside}</span> : null}
      </span>
      {children}
      {hint ? <span className="mx-hint">{hint}</span> : null}
    </label>
  );
}

export function Row({
  title,
  sub,
  leading,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-row">
      {leading}
      <div className="mx-row-main">
        <span className="mx-row-title">{title}</span>
        {sub ? <span className="mx-sub">{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  span = 3,
  quiet = false,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: { text: string; up: boolean } | null;
  span?: Span;
  quiet?: boolean;
}) {
  return (
    <div className={`mx-panel mx-s${span}${quiet ? ' mx-stat-quiet' : ''}`}>
      <div className="mx-stat">
        <span className="mx-stat-label">{label}</span>
        <span className="mx-stat-value">{value}</span>
        {delta ? (
          <span className={`mx-sub ${delta.up ? 'mx-up' : 'mx-down'}`}>{delta.text}</span>
        ) : null}
      </div>
    </div>
  );
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="mx-chip">
      {color ? <span className="mx-dot" style={{ background: color }} /> : null}
      {children}
    </span>
  );
}

export type Mood = 'neutral' | 'happy' | 'thinking' | 'sleeping' | 'skeptical' | 'error';

export function Empty({
  children,
  mood,
  action,
}: {
  children: ReactNode;
  mood?: Mood;
  action?: ReactNode;
}) {
  return (
    <div className="mx-empty">
      {mood ? (
        <img
          className="mx-empty-mascot"
          src={`/mascot/${mood}.svg`}
          alt=""
          width={44}
          height={44}
        />
      ) : null}
      {children}
      {action ? <div className="mx-empty-action">{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warn';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`mx-callout mx-callout-${tone}`}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 28,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      className="mx-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: '#3A9EEA',
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="100" fill="#F26B3A" />
      <path
        d="M50 143V93a25 25 0 0 1 50 0v50M100 93a25 25 0 0 1 50 0v50"
        fill="none"
        stroke="#17171B"
        strokeWidth="22"
      />
      <path d="M39 127h22v16H39zM89 127h22v16H89zM139 127h22v16h-22z" fill="#E6E6EA" />
    </svg>
  );
}

export function ModuleIcon({
  d,
  fill,
  size = 18,
  className = 'mx-nav-icon',
}: {
  d: string;
  fill: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 160 160"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M18 152V80a62 62 0 0 1 124 0v72H95v-14a15 15 0 0 0-30 0v14z" style={{ fill }} />
      <path d="M18 138h47v14H18zM95 138h47v14H95z" fill="#E6E6EA" />
      <g transform="translate(80 78) scale(.74) translate(-80 -80)">
        <path
          d={d}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" role="img" aria-label="Locked until you vote">
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        fill="none"
        stroke="#6E727A"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="5" y="11" width="14" height="10" rx="2.5" fill="#6E727A" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function roleColor(color: number): string {
  return color ? `#${color.toString(16).padStart(6, '0')}` : '#9A9EA6';
}
