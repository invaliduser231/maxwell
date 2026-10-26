import type { CSSProperties, ReactNode } from 'react';
import { useT } from './i18n';

export const DEFAULT_ACCENT = '#F26B3A';

export interface CardLook {
  accent: string;
  background: 'field' | 'plain' | 'image';
  dim: number;
  imageUrl: string | null;
}

interface Arches {
  cx: number;
  baseline: number;
  radii: number[];
  start: number;
}

const DISPLAY = 'var(--mx-display)';
const MUTED = '#8A8F98';
const TRACK = '#2B2B33';

function arch(cx: number, baseline: number, r: number, bottom: number): string {
  return `M${cx - r} ${bottom}V${baseline}a${r} ${r} 0 0 1 ${2 * r} 0V${bottom}`;
}

function Backdrop({
  look,
  width,
  height,
  glow,
  lines,
}: {
  look: CardLook;
  width: number;
  height: number;
  glow?: { x: number; y: number; r: number; alpha: number };
  lines: Arches;
}) {
  const image = look.background === 'image' && look.imageUrl;
  const kind = image ? 'image' : look.background === 'plain' ? 'plain' : 'field';
  const glowId = `glow-${width}-${height}-${glow?.x ?? 0}`;
  const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
  return (
    <>
      {image ? (
        <>
          <img src={image} alt="" style={{ ...fill, objectFit: 'cover', display: 'block' }} />
          <div style={{ ...fill, background: `rgba(23, 23, 27, ${look.dim.toFixed(2)})` }} />
        </>
      ) : null}
      {kind !== 'image' && glow ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={fill}
        >
          <defs>
            <radialGradient
              id={glowId}
              cx={glow.x}
              cy={glow.y}
              r={glow.r}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor={look.accent} stopOpacity={glow.alpha} />
              <stop offset="1" stopColor={look.accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width={width} height={height} fill={`url(#${glowId})`} />
        </svg>
      ) : null}
      {kind === 'field' ? (
        <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={fill}>
          <g fill="none" stroke={look.accent} strokeWidth="4">
            {lines.radii.map((r, i) => (
              <path
                key={r}
                d={arch(lines.cx, lines.baseline, r, height + 200)}
                strokeOpacity={Math.round(Math.max(0.06, lines.start * 0.7 ** i) * 1000) / 1000}
              />
            ))}
          </g>
        </svg>
      ) : null}
    </>
  );
}

function Face({
  look,
  name,
  avatarUrl,
  style,
  ring,
  fontSize,
}: {
  look: CardLook;
  name: string;
  avatarUrl: string | null;
  style: CSSProperties;
  ring: string;
  fontSize: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        aspectRatio: '1',
        borderRadius: '50%',
        background: look.accent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          style={{ width: ring, aspectRatio: '1', borderRadius: '50%', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: ring,
            aspectRatio: '1',
            borderRadius: '50%',
            background: TRACK,
            color: look.accent,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function Frame({
  ratio,
  radius,
  label,
  children,
}: {
  ratio: string;
  radius: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        containerType: 'inline-size',
        position: 'relative',
        width: '100%',
        aspectRatio: ratio,
        borderRadius: radius,
        overflow: 'hidden',
        background: '#17171B',
        color: '#F4F4F2',
      }}
    >
      {children}
    </div>
  );
}

export function WelcomeCard({
  look,
  name,
  avatarUrl,
  subtitle,
}: {
  look: CardLook;
  name: string;
  avatarUrl: string | null;
  subtitle: string;
}) {
  const t = useT();
  return (
    <Frame ratio="1000 / 420" radius={14} label={t('Welcome card for {name}', { name })}>
      <Backdrop
        look={look}
        width={1000}
        height={420}
        glow={{ x: 500, y: 150, r: 460, alpha: 0.22 }}
        lines={{ cx: 500, baseline: 150, radii: [130, 185, 245, 310, 380], start: 0.42 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '47.6%',
          height: '23.8%',
          background: 'linear-gradient(rgba(23, 23, 27, 0), rgba(23, 23, 27, .92))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '28.6%',
          background: 'rgba(23, 23, 27, .92)',
        }}
      />
      <Face
        look={look}
        name={name}
        avatarUrl={avatarUrl}
        style={{ left: '40.2%', top: '11.4%', width: '19.6%' }}
        ring="91.8%"
        fontSize="8cqw"
      />
      <div
        className="mx-ellipsis"
        style={{
          position: 'absolute',
          left: '4%',
          right: '4%',
          top: '64%',
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: '6cqw',
        }}
      >
        {t('Welcome, {name}', { name })}
      </div>
      <div
        className="mx-ellipsis"
        style={{
          position: 'absolute',
          left: '4%',
          right: '4%',
          top: '81%',
          textAlign: 'center',
          fontWeight: 500,
          fontSize: '2.8cqw',
          color: MUTED,
        }}
      >
        {subtitle}
      </div>
    </Frame>
  );
}

export function RankCard({
  look,
  name,
  username,
  avatarUrl,
  rank,
  level,
  into,
  needed,
}: {
  look: CardLook;
  name: string;
  username: string;
  avatarUrl: string | null;
  rank: number;
  level: number;
  into: number;
  needed: number;
}) {
  const t = useT();
  const share = needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 100;
  const stat: CSSProperties = {
    fontFamily: DISPLAY,
    fontWeight: 700,
    fontSize: '6.4cqw',
    lineHeight: 1,
  };
  return (
    <Frame
      ratio="1000 / 300"
      radius={12}
      label={t('Rank card for {name}, level {level}', { name, level })}
    >
      <Backdrop
        look={look}
        width={1000}
        height={300}
        lines={{ cx: 880, baseline: 330, radii: [150, 205, 265], start: 0.3 }}
      />
      <Face
        look={look}
        name={name}
        avatarUrl={avatarUrl}
        style={{ left: '5%', top: '16.7%', width: '20%' }}
        ring="94%"
        fontSize="8cqw"
      />
      <div
        className="mx-ellipsis"
        style={{
          position: 'absolute',
          left: '29.2%',
          right: '36%',
          top: '21%',
          fontWeight: 600,
          fontSize: '4.6cqw',
        }}
      >
        {name}
      </div>
      <div
        className="mx-ellipsis"
        style={{
          position: 'absolute',
          left: '29.2%',
          right: '36%',
          top: '41%',
          fontSize: '2.5cqw',
          color: MUTED,
        }}
      >
        @{username}
      </div>
      <div
        style={{
          position: 'absolute',
          right: '5%',
          top: '14%',
          display: 'flex',
          gap: '4.4cqw',
          textAlign: 'right',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '2.2cqw', color: MUTED }}>{t('Rank')}</span>
          <span style={stat}>#{rank}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '2.2cqw', color: MUTED }}>{t('Level')}</span>
          <span style={{ ...stat, color: look.accent }}>{level}</span>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '29.2%',
          right: '5%',
          top: '60%',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '2.4cqw',
          color: MUTED,
        }}
      >
        <span>
          {t.count(into)} / {t.count(needed)} XP
        </span>
        <span>{share}%</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '29.2%',
          right: '5%',
          top: '72.7%',
          height: '10%',
          borderRadius: 99,
          background: TRACK,
          overflow: 'hidden',
        }}
      >
        <div
          style={{ width: `${share}%`, height: '100%', borderRadius: 99, background: look.accent }}
        />
      </div>
    </Frame>
  );
}

export function LevelUpCard({
  look,
  name,
  avatarUrl,
  level,
  reward,
}: {
  look: CardLook;
  name: string;
  avatarUrl: string | null;
  level: number;
  reward: { name: string; color: string } | null;
}) {
  const t = useT();
  return (
    <Frame
      ratio="1000 / 300"
      radius={10}
      label={t('Level-up card for {name}, level {level}', { name, level })}
    >
      <Backdrop
        look={look}
        width={1000}
        height={300}
        glow={{ x: 860, y: 330, r: 440, alpha: 0.2 }}
        lines={{ cx: 860, baseline: 250, radii: [120, 175, 235, 300, 370], start: 0.35 }}
      />
      <Face
        look={look}
        name={name}
        avatarUrl={avatarUrl}
        style={{ left: '5.6%', top: '20%', width: '18%' }}
        ring="93%"
        fontSize="7cqw"
      />
      <div
        className="mx-ellipsis"
        style={{
          position: 'absolute',
          left: '29%',
          right: '6%',
          top: '20%',
          fontWeight: 600,
          fontSize: '3.6cqw',
          color: MUTED,
        }}
      >
        {name}
      </div>
      <div
        style={{
          position: 'absolute',
          left: '29%',
          top: '36%',
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: '9.6cqw',
          lineHeight: 1,
        }}
      >
        {t('Level')} <span style={{ color: look.accent }}>{level}</span>
      </div>
      {reward ? (
        <div
          className="mx-ellipsis"
          style={{
            position: 'absolute',
            left: '29.2%',
            right: '6%',
            top: '72%',
            fontSize: '2.8cqw',
            color: MUTED,
          }}
        >
          {t('Unlocked')}{' '}
          <span style={{ fontWeight: 600, color: reward.color }}>{reward.name}</span>
        </div>
      ) : null}
    </Frame>
  );
}
