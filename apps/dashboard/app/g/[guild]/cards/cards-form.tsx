'use client';

import type { CardsConfig } from '@maxwell/core/modules/cards';
import { useEffect, useId, useState, useTransition } from 'react';
import { type CardLook, DEFAULT_ACCENT, RankCard, WelcomeCard } from '@/components/card-preview';
import { Seg } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { failed, type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Field, Grid, Panel, PanelBody } from '@/components/ui';
import type { Key } from '@/lib/i18n';
import { shrinkImage } from '@/lib/image';
import { removeBackground, uploadBackground } from './actions';

const swatches: { hex: string; name: Key }[] = [
  { hex: '#F26B3A', name: 'Maxwell orange' },
  { hex: '#3A9EEA', name: 'Blue' },
  { hex: '#2EB67D', name: 'Green' },
  { hex: '#E8B23A', name: 'Yellow' },
  { hex: '#D96BCB', name: 'Pink' },
  { hex: '#EC5B78', name: 'Red' },
];

const backgrounds: { value: 'field' | 'plain' | 'image'; label: Key }[] = [
  { value: 'field', label: 'Field lines' },
  { value: 'plain', label: 'Plain' },
  { value: 'image', label: 'Image' },
];

const UPLOAD_LIMIT = 900_000;
const MAX_SIDE = 1600;

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function checkHex(raw: string): { hex: string } | { problem: Key } {
  const hex = `#${raw.trim().replace(/^#/, '')}`.toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(hex)) return { problem: 'Use a six digit hex code, like #3A9EEA.' };
  const contrast = (luminance(hex) + 0.05) / (luminance('#17171B') + 0.05);
  if (contrast < 3) return { problem: 'Too dark for the cards.' };
  return { hex };
}

function ImageControls({
  version,
  onVersion,
  onRemoved,
}: {
  version: number | null;
  onVersion: (next: number | null) => void;
  onRemoved: () => void;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { readOnly } = useDraft<CardsConfig>();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const upload = (file: File) =>
    start(async () => {
      let blob: Blob;
      try {
        blob = await shrinkImage(file, { maxSide: MAX_SIDE, limit: UPLOAD_LIMIT });
      } catch {
        setStatus(failed(t('That image could not be read.')));
        return;
      }
      const form = new FormData();
      form.set('image', blob);
      const result = await uploadBackground(guildId, form);
      if (result.ok) {
        onVersion(result.data?.version ?? Date.now());
        setStatus(null);
      } else {
        setStatus(failed(result.error));
      }
    });

  return (
    <div className="mx-inset mx-stack" style={{ gap: 8, padding: 12 }}>
      <div className="mx-inline" style={{ gap: 10 }}>
        {version ? (
          <img
            src={`/g/${guildId}/cards/background?v=${version}`}
            alt={t('Current background')}
            style={{
              width: 88,
              height: 50,
              objectFit: 'cover',
              borderRadius: 'var(--mx-radius-sm)',
              display: 'block',
            }}
          />
        ) : null}
        {readOnly ? null : (
          <>
            <label className="mx-btn" aria-disabled={pending}>
              {version ? t('Replace image') : t('Upload image')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="mx-sr"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload(file);
                  event.target.value = '';
                }}
              />
            </label>
            {version ? (
              <TwoStep
                label={t('Remove')}
                confirm={t('Click again to remove')}
                ghost
                disabled={pending}
                run={() =>
                  start(async () => {
                    const result = await removeBackground(guildId);
                    if (result.ok) {
                      onVersion(null);
                      onRemoved();
                      setStatus(null);
                    } else {
                      setStatus(failed(result.error));
                    }
                  })
                }
              />
            ) : null}
          </>
        )}
      </div>
      <StatusText status={status} />
    </div>
  );
}

export function CardsForm({
  imageVersion,
  sample,
}: {
  imageVersion: number | null;
  sample: {
    name: string;
    username: string;
    avatarUrl: string | null;
    memberCount: number | null;
    guildName: string;
  };
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { value, set, readOnly } = useDraft<CardsConfig>();
  const accent = (value.accent ?? DEFAULT_ACCENT).toUpperCase();
  const [hexText, setHexText] = useState(accent);
  const [problem, setProblem] = useState<Key | ''>('');
  const [version, setVersion] = useState(imageVersion);
  const accentLabel = useId();

  useEffect(() => {
    setHexText((current) => {
      const parsed = checkHex(current);
      return 'hex' in parsed && parsed.hex === accent ? current : accent;
    });
    setProblem('');
  }, [accent]);

  const look: CardLook = {
    accent,
    background: value.background,
    dim: value.dim,
    imageUrl: version ? `/g/${guildId}/cards/background?v=${version}` : null,
  };
  const dimPercent = Math.round(value.dim * 100);

  return (
    <Grid>
      <Panel
        title={t('Style')}
        span={5}
        actions={
          <span className="mx-sub">{t('Welcome, goodbye, rank, level up, leaderboard')}</span>
        }
      >
        <PanelBody>
          <div className="mx-field">
            <span className="mx-label" id={accentLabel}>
              {t('Accent color')}
            </span>
            <div className="mx-inline" style={{ gap: 10 }}>
              <div className="mx-inline" role="group" aria-labelledby={accentLabel}>
                {swatches.map((swatch) => {
                  const active = swatch.hex === accent;
                  return (
                    <button
                      key={swatch.hex}
                      type="button"
                      aria-label={t(swatch.name)}
                      aria-pressed={active}
                      disabled={readOnly}
                      onClick={() =>
                        set({ accent: swatch.hex === DEFAULT_ACCENT ? null : swatch.hex })
                      }
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        border: 0,
                        background: swatch.hex,
                        boxShadow: active
                          ? '0 0 0 2px var(--mx-panel), 0 0 0 4px var(--mx-text)'
                          : 'none',
                        cursor: readOnly ? 'default' : 'pointer',
                        opacity: 1,
                        padding: 0,
                      }}
                    />
                  );
                })}
              </div>
              <input
                className="mx-input mx-mono"
                type="text"
                aria-label={t('Hex code')}
                value={hexText}
                maxLength={7}
                spellCheck={false}
                readOnly={readOnly}
                aria-invalid={problem ? true : undefined}
                style={{ width: 104 }}
                onChange={(event) => {
                  const raw = event.target.value;
                  setHexText(raw);
                  const result = checkHex(raw);
                  if ('hex' in result) {
                    setProblem('');
                    set({ accent: result.hex === DEFAULT_ACCENT ? null : result.hex });
                  } else {
                    setProblem(raw.trim().replace(/^#/, '').length >= 6 ? result.problem : '');
                  }
                }}
              />
            </div>
            {problem ? (
              <span role="alert" className="mx-field-error">
                {t(problem)}
              </span>
            ) : null}
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Background')}</span>
            <Seg
              label={t('Background')}
              value={value.background}
              options={backgrounds.map((entry) => ({ ...entry, label: t(entry.label) }))}
              onChange={(background) => set({ background })}
            />
          </div>
          {value.background === 'image' ? (
            <>
              <ImageControls
                version={version}
                onVersion={setVersion}
                onRemoved={() => set({ background: 'field' })}
              />
              <Field label={t('Dim')} aside={`${dimPercent}%`}>
                <input
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={dimPercent}
                  disabled={readOnly}
                  onChange={(event) => set({ dim: Number(event.target.value) / 100 })}
                  style={{ width: '100%' }}
                />
              </Field>
            </>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel title={t('Preview')} span={7}>
        <PanelBody>
          <WelcomeCard
            look={look}
            name={sample.name}
            avatarUrl={sample.avatarUrl}
            subtitle={
              sample.memberCount
                ? t('Member #{number} of {guild}', {
                    number: sample.memberCount,
                    guild: sample.guildName,
                  })
                : sample.guildName
            }
          />
          <RankCard
            look={look}
            name={sample.name}
            username={sample.username}
            avatarUrl={sample.avatarUrl}
            rank={4}
            level={12}
            into={840}
            needed={1200}
          />
        </PanelBody>
      </Panel>
    </Grid>
  );
}
