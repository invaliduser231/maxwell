'use client';

import type { GeneralConfig } from '@maxwell/core';
import { useState, useTransition } from 'react';
import { AddPicker, ChannelMulti, Seg, Select, TimezoneSelect } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useRemote } from '@/components/live';
import { useDraft } from '@/components/module-shell';
import { failed, outcome, type Status, StatusText, sorted } from '@/components/status-text';
import { DangerRow } from '@/components/two-step';
import { CloseIcon, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import type { BotProfile } from '@/lib/fluxer';
import type { Key } from '@/lib/i18n';
import { removeMaxwell, resetSettings, saveAvatar, savePrefix, saveProfile } from './actions';

const languageNames: Record<GeneralConfig['language'], string> = {
  en: 'English',
  de: 'Deutsch',
};

const retention: { value: string; label: Key }[] = [
  { value: 'forever', label: 'Forever' },
  { value: '730', label: '2 years' },
  { value: '365', label: '1 year' },
  { value: '90', label: '90 days' },
];

function PrefixPanel({ initial }: { initial: string }) {
  const { guildId } = useGuild();
  const t = useT();
  const { readOnly } = useDraft<GeneralConfig>();
  const [prefix, setPrefix] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  useRemote(initial, prefix !== saved || pending, (next) => {
    setSaved(next);
    setPrefix(next);
  });

  return (
    <div className="mx-field">
      <span className="mx-label">{t('Prefix')}</span>
      <div className="mx-inline">
        <input
          className="mx-input mx-mono"
          aria-label={t('Prefix')}
          value={prefix}
          maxLength={8}
          readOnly={readOnly}
          onChange={(event) => setPrefix(event.target.value)}
          style={{ maxWidth: 140 }}
        />
        {prefix !== saved ? (
          <button
            type="button"
            className="mx-btn"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await savePrefix(guildId, prefix);
                if (result.ok) {
                  setSaved(prefix.trim());
                  setPrefix(prefix.trim());
                  setStatus(sorted());
                } else {
                  setStatus(failed(result.error));
                }
              })
            }
          >
            {t('Save prefix')}
          </button>
        ) : null}
        <StatusText status={status} />
      </div>
    </div>
  );
}

function ProfilePanel({ profile, guildName }: { profile: BotProfile | null; guildName: string }) {
  const { guildId } = useGuild();
  const t = useT();
  const { readOnly } = useDraft<GeneralConfig>();
  const [nick, setNick] = useState(profile?.nick ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatar, setAvatar] = useState(profile?.avatarUrl ?? null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const changed = nick !== (profile?.nick ?? '') || bio !== (profile?.bio ?? '');

  const upload = (file: File) => {
    if (file.size > 1_000_000) {
      setStatus(failed(t('Use an image under 1 MB.')));
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      start(async () => {
        const dataUrl = String(reader.result);
        const result = await saveAvatar(guildId, dataUrl);
        if (result.ok) setAvatar(dataUrl);
        setStatus(outcome(result));
      });
    reader.readAsDataURL(file);
  };

  return (
    <Panel title={t('Maxwell in {guild}', { guild: guildName })} span={6}>
      <PanelBody>
        <div className="mx-inline" style={{ gap: 14 }}>
          <img
            src={avatar ?? '/mascot/neutral.svg'}
            alt={t("Maxwell's avatar in this community")}
            width={56}
            height={56}
            style={{ borderRadius: '50%', display: 'block' }}
          />
          {readOnly ? null : (
            <div className="mx-inline">
              <label className="mx-btn" aria-disabled={pending}>
                {t('Upload avatar')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="mx-sr"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload(file);
                    event.target.value = '';
                  }}
                />
              </label>
              {avatar ? (
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await saveAvatar(guildId, null);
                      if (result.ok) setAvatar(null);
                      setStatus(outcome(result));
                    })
                  }
                >
                  {t('Use default')}
                </button>
              ) : null}
            </div>
          )}
        </div>
        <Field label={t('Nickname')}>
          <input
            className="mx-input"
            value={nick}
            maxLength={32}
            placeholder="Maxwell"
            readOnly={readOnly}
            onChange={(event) => setNick(event.target.value)}
          />
        </Field>
        <Field label={t('About me')} aside={`${bio.length} / 320`}>
          <textarea
            className="mx-textarea"
            rows={3}
            maxLength={320}
            value={bio}
            readOnly={readOnly}
            onChange={(event) => setBio(event.target.value)}
          />
        </Field>
        <div className="mx-inline">
          {changed && !readOnly ? (
            <button
              type="button"
              className="mx-btn"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await saveProfile(guildId, {
                    nick: nick || null,
                    bio: bio || null,
                  });
                  setStatus(outcome(result));
                })
              }
            >
              {t('Save profile')}
            </button>
          ) : null}
          <StatusText status={status} />
        </div>
      </PanelBody>
    </Panel>
  );
}

export function GeneralForm({
  prefix,
  commands,
  profile,
  guildName,
  admin,
}: {
  prefix: string;
  commands: string[];
  profile: BotProfile | null;
  guildName: string;
  admin: boolean;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { value, set, readOnly } = useDraft<GeneralConfig>();
  const [scoped, setScoped] = useState(value.commandChannels.length > 0);
  const available = commands.filter((name) => !value.disabledCommands.includes(name));
  const retentionOptions = retention.map((entry) => ({ ...entry, label: t(entry.label) }));

  return (
    <Grid>
      <Panel title={t('Basics')} span={6}>
        <PanelBody>
          <PrefixPanel initial={prefix} />
          <Fields>
            <Field label={t('Bot language')}>
              <Select
                value={value.language}
                options={Object.entries(languageNames).map(([code, name]) => ({
                  value: code as GeneralConfig['language'],
                  label: name,
                }))}
                onChange={(language) => set({ language })}
              />
            </Field>
            <Field label={t('Timezone')}>
              <TimezoneSelect value={value.timezone} onChange={(timezone) => set({ timezone })} />
            </Field>
          </Fields>
        </PanelBody>
      </Panel>

      <ProfilePanel profile={profile} guildName={guildName} />

      <Panel title={t('Commands')} span={6}>
        <PanelBody>
          <div className="mx-field">
            <span className="mx-label">{t('Turned off')}</span>
            <div className="mx-chips">
              {value.disabledCommands.map((name) => (
                <span key={name} className="mx-chip">
                  <span className="mx-mono">{name}</span>
                  {readOnly ? null : (
                    <button
                      type="button"
                      className="mx-chip-x"
                      aria-label={t('Turn {name} back on', { name })}
                      onClick={() =>
                        set({
                          disabledCommands: value.disabledCommands.filter(
                            (entry) => entry !== name,
                          ),
                        })
                      }
                    >
                      <CloseIcon />
                    </button>
                  )}
                </span>
              ))}
              {readOnly && value.disabledCommands.length === 0 ? (
                <span className="mx-sub">{t('None')}</span>
              ) : null}
              {readOnly || available.length === 0 ? null : (
                <AddPicker
                  label={t('Turn off a command')}
                  options={available.map((name) => ({ value: name, label: name }))}
                  onPick={(name) => set({ disabledCommands: [...value.disabledCommands, name] })}
                />
              )}
            </div>
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Where commands work')}</span>
            <Seg
              label={t('Where commands work')}
              value={scoped ? 'some' : 'all'}
              options={[
                { value: 'all', label: t('Everywhere') },
                { value: 'some', label: t('Some channels') },
              ]}
              onChange={(next) => {
                setScoped(next === 'some');
                if (next === 'all') set({ commandChannels: [] });
              }}
            />
            {scoped ? (
              <ChannelMulti
                value={value.commandChannels}
                onChange={(commandChannels) => set({ commandChannels })}
              />
            ) : null}
          </div>
        </PanelBody>
      </Panel>

      <Panel title={t('Privacy')} span={6}>
        <PanelBody>
          <Field label={t('Keep cases')}>
            <Select
              value={value.caseRetentionDays === null ? 'forever' : String(value.caseRetentionDays)}
              options={
                value.caseRetentionDays === null ||
                retention.some((entry) => entry.value === String(value.caseRetentionDays))
                  ? retentionOptions
                  : [
                      ...retentionOptions,
                      {
                        value: String(value.caseRetentionDays),
                        label: t.plural(value.caseRetentionDays, '{n} day', '{n} days'),
                      },
                    ]
              }
              onChange={(next) =>
                set({ caseRetentionDays: next === 'forever' ? null : Number(next) })
              }
            />
          </Field>
        </PanelBody>
        <Row
          title={t('Members export their data')}
          sub={<span className="mx-mono">{`${prefix}mydata`}</span>}
        />
        <Row
          title={t('Members delete their data')}
          sub={<span className="mx-mono">{`${prefix}forgetme`}</span>}
        />
      </Panel>

      {admin ? (
        <Panel title={t('Reset')} span={12}>
          <DangerRow
            label={t('Reset all settings')}
            sub={t('Levels, currency, cases and backups stay')}
            run={() => resetSettings(guildId)}
          />
          <DangerRow
            label={t('Remove Maxwell')}
            sub={t('Maxwell leaves {guild}', { guild: guildName })}
            run={() => removeMaxwell(guildId)}
          />
        </Panel>
      ) : null}
    </Grid>
  );
}
