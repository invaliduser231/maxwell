'use client';

import type { NukeLimitKey, SecurityConfig } from '@maxwell/core/modules/security';
import { useState } from 'react';
import {
  ChannelMulti,
  ChannelSelect,
  NumberInput,
  RoleMulti,
  RoleSelect,
  Seg,
  ToggleRow,
  WordList,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Callout, Empty, Field, Fields, Grid, Panel, PanelBody, Stat } from '@/components/ui';
import { runAction } from '@/lib/actions';
import type { Translator } from '@/lib/i18n';
import { ago, clock } from '@/lib/time';
import type { CheckRow, EventRow, SecurityView } from './data';

type Verification = SecurityConfig['verification'];
type Weights = Verification['weights'];
type WeightKey = Exclude<keyof Weights, 'ageTiers'>;

const weightKeys: { key: WeightKey; label: string }[] = [
  { key: 'noAvatar', label: 'No profile picture' },
  { key: 'noName', label: 'No display name or nickname' },
  { key: 'newWithoutAvatar', label: 'New account without a picture' },
  { key: 'randomName', label: 'Name looks generated' },
  { key: 'digitName', label: 'Long number in the name' },
  { key: 'spamName', label: 'Name contains a spam word' },
  { key: 'wave', label: 'Joined with similar accounts' },
  { key: 'rejoin', label: 'Came back right after leaving' },
  { key: 'priorKick', label: 'Kicked here before' },
  { key: 'priorBan', label: 'Banned here before' },
  { key: 'newInviter', label: 'Invited by a brand new member' },
  { key: 'established', label: 'Old account with a picture' },
];

const limitKeys: { key: NukeLimitKey; label: string }[] = [
  { key: 'channelDelete', label: 'Channels deleted' },
  { key: 'channelCreate', label: 'Channels created' },
  { key: 'roleDelete', label: 'Roles deleted' },
  { key: 'ban', label: 'Bans' },
  { key: 'kick', label: 'Kicks' },
  { key: 'webhook', label: 'Webhooks created' },
  { key: 'botAdd', label: 'Bots added' },
  { key: 'dangerousGrant', label: 'Dangerous permissions handed out' },
];

function ageLabel(t: Translator, hours: number): string {
  if (hours % 24 !== 0) return t.raw('Younger than {n} hours', { n: hours });
  const days = hours / 24;
  return days === 1 ? t.raw('Younger than 1 day') : t.raw('Younger than {n} days', { n: days });
}

export function reasonText(t: Translator, reason: CheckRow['reasons'][number]): string {
  switch (reason.key) {
    case 'age':
      return ageLabel(t, reason.hours ?? 24).toLowerCase();
    case 'spamName':
      return t.raw('name contains "{word}"', { word: reason.word ?? '' });
    case 'wave':
      return t.raw('joined with {n} similar accounts', { n: Math.max(1, (reason.size ?? 2) - 1) });
    case 'rejoin':
      return t.raw('came back {n} minutes after leaving', { n: reason.minutes ?? 1 });
    case 'priorKick':
      return t.raw('kicked here before');
    case 'priorBan':
      return t.raw('banned here before');
    case 'raid':
      return t.raw('joined during raid mode');
    default: {
      const found = weightKeys.find((entry) => entry.key === reason.key);
      return found ? t.raw(found.label).toLowerCase() : reason.key;
    }
  }
}

const statusLabels: Record<string, string> = {
  clear: 'Passed',
  pending: 'Waiting for captcha',
  passed: 'Passed after captcha',
  failed: 'Failed',
  expired: 'Did not answer in time',
  left: 'Left before answering',
  released: 'Let in by a moderator',
};

function eventText(t: Translator, event: EventRow): string {
  switch (event.kind) {
    case 'raid':
      return event.summary === 'ended' ? t.raw('Raid mode ended') : t.raw('Raid mode started');
    case 'nuke':
      return t.raw('{name} was stopped for mass changes', {
        name: event.actor ?? t.raw('Someone'),
      });
    case 'honeypot':
      return t.raw('{name} walked into the honeypot', { name: event.user ?? t.raw('Someone') });
    case 'severe':
      return t.raw('{name} was removed for a very high risk score', {
        name: event.user ?? t.raw('Someone'),
      });
    case 'verify':
      return t.raw('{name} solved the captcha', { name: event.user ?? t.raw('Someone') });
    default:
      return event.summary;
  }
}

export function SecurityForm({ view }: { view: SecurityView }) {
  const t = useT();
  const { guildId, timezone } = useGuild();
  const { value, set, update, readOnly } = useDraft<SecurityConfig>();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const verification = value.verification;
  const raid = value.raid;
  const nuke = value.nuke;
  const honeypot = value.honeypot;

  const patchVerification = (next: Partial<Verification>) =>
    update((previous) => ({ ...previous, verification: { ...previous.verification, ...next } }));
  const patchWeights = (next: Partial<Weights>) =>
    patchVerification({ weights: { ...verification.weights, ...next } });
  const patchRaid = (next: Partial<SecurityConfig['raid']>) =>
    update((previous) => ({ ...previous, raid: { ...previous.raid, ...next } }));
  const patchNuke = (next: Partial<SecurityConfig['nuke']>) =>
    update((previous) => ({ ...previous, nuke: { ...previous.nuke, ...next } }));
  const patchHoneypot = (next: Partial<SecurityConfig['honeypot']>) =>
    update((previous) => ({ ...previous, honeypot: { ...previous.honeypot, ...next } }));

  const act = (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    setStatus(null);
    runAction(guildId, 'security', action, payload).then((result) => {
      setBusy(false);
      setStatus(
        result.ok
          ? { message: t.raw('Sent to Maxwell.'), error: false }
          : { message: result.error, error: true },
      );
    });
  };

  return (
    <Grid>
      {view.raid ? (
        <div className="mx-s12">
          <Callout
            tone="warn"
            action={
              readOnly ? null : (
                <button
                  type="button"
                  className="mx-btn"
                  disabled={busy}
                  onClick={() => act('raid.stop')}
                >
                  {t.raw('End raid mode')}
                </button>
              )
            }
          >
            <span className="mx-row-title">
              {view.raid.endsAt
                ? t.raw('Raid mode until {time}', { time: clock(view.raid.endsAt, timezone) })
                : t.raw('Raid mode is on')}
            </span>
            <span className="mx-sub"> {t.raw('Every new member gets a captcha.')}</span>
          </Callout>
        </div>
      ) : null}

      {view.gateRoleId === null ? (
        <div className="mx-s12">
          <Callout
            tone="warn"
            action={
              readOnly ? null : (
                <button
                  type="button"
                  className="mx-btn"
                  disabled={busy}
                  onClick={() => act('gate.setup')}
                >
                  {t.raw('Set up gate role')}
                </button>
              )
            }
          >
            {t.raw('No gate role yet.')}
          </Callout>
        </div>
      ) : null}

      {view.above.length > 0 ? (
        <div className="mx-s12">
          <Callout tone="warn">
            {t.raw('Maxwell is below {roles}. Move its role higher.', {
              roles: t.list(view.above.slice(0, 5)),
            })}
          </Callout>
        </div>
      ) : null}

      <Stat label={t.raw('Joined, last 24 hours')} value={t.count(view.counts.checked)} quiet />
      <Stat label={t.raw('Flagged')} value={t.count(view.counts.flagged)} quiet />
      <Stat label={t.raw('Passed the captcha')} value={t.count(view.counts.passed)} quiet />
      <Stat label={t.raw('Waiting now')} value={t.count(view.counts.pending)} quiet />

      <Panel title={t.raw('Captcha')} span={6} id="sec-verify">
        <ToggleRow
          title={t.raw('Check new members')}
          checked={verification.enabled}
          onChange={(enabled) => patchVerification({ enabled })}
        />
        <PanelBody>
          <Fields>
            <Field label={t.raw('Captcha from risk score')}>
              <NumberInput
                value={verification.threshold}
                min={1}
                max={100}
                onChange={(threshold) => patchVerification({ threshold })}
              />
            </Field>
            <Field label={t.raw('Tries')}>
              <NumberInput
                value={verification.attempts}
                min={1}
                max={10}
                onChange={(attempts) => patchVerification({ attempts })}
              />
            </Field>
            <Field label={t.raw('Time to answer')}>
              <NumberInput
                value={verification.minutes}
                min={2}
                max={1440}
                suffix="min"
                onChange={(minutes) => patchVerification({ minutes })}
              />
            </Field>
            <Field label={t.raw('When it fails or runs out')}>
              <Seg
                label={t.raw('When it fails or runs out')}
                value={verification.onExpire}
                options={[
                  { value: 'keep', label: t.raw('Keep at the gate') },
                  { value: 'kick', label: t.raw('Kick') },
                ]}
                onChange={(onExpire) => patchVerification({ onExpire })}
              />
            </Field>
            <Field label={t.raw('Very high score')}>
              <Seg
                label={t.raw('Very high score')}
                value={verification.severeAction}
                options={[
                  { value: 'none', label: t.raw('Captcha too') },
                  { value: 'kick', label: t.raw('Kick') },
                  { value: 'ban', label: t.raw('Ban') },
                ]}
                onChange={(severeAction) => patchVerification({ severeAction })}
              />
            </Field>
            {verification.severeAction !== 'none' ? (
              <Field label={t.raw('Very high from score')}>
                <NumberInput
                  value={verification.severeScore}
                  min={1}
                  max={200}
                  onChange={(severeScore) => patchVerification({ severeScore })}
                />
              </Field>
            ) : null}
            <Field label={t.raw('Channel when DMs are closed')}>
              <ChannelSelect
                value={verification.channelId}
                none={t.raw('Gate channel')}
                onChange={(channelId) => patchVerification({ channelId })}
              />
            </Field>
          </Fields>
        </PanelBody>
      </Panel>

      <Panel title={t.raw('Risk score')} span={6} id="sec-score">
        <PanelBody>
          <div className="mx-stack">
            <span className="mx-label">{t.raw('Account age')}</span>
            <div className="mx-weights">
              {verification.weights.ageTiers.map((tier, index) => (
                <div key={tier.hours} className="mx-weight">
                  <span>{ageLabel(t, tier.hours)}</span>
                  <div style={{ width: 88 }}>
                    <NumberInput
                      label={ageLabel(t, tier.hours)}
                      value={tier.points}
                      min={0}
                      max={30}
                      onChange={(points) =>
                        patchWeights({
                          ageTiers: verification.weights.ageTiers.map((entry, position) =>
                            position === index ? { ...entry, points } : entry,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <span className="mx-label">{t.raw('Other signs')}</span>
            <div className="mx-weights">
              {weightKeys.map((entry) => (
                <div key={entry.key} className="mx-weight">
                  <span>{t.raw(entry.label)}</span>
                  <div style={{ width: 88 }}>
                    <NumberInput
                      label={t.raw(entry.label)}
                      value={verification.weights[entry.key]}
                      min={-20}
                      max={30}
                      onChange={(points) => patchWeights({ [entry.key]: points })}
                    />
                  </div>
                </div>
              ))}
            </div>
            <span className="mx-label">{t.raw('Spam words in names')}</span>
            <WordList
              value={verification.spamWords}
              onChange={(spamWords) => patchVerification({ spamWords })}
            />
          </div>
        </PanelBody>
      </Panel>

      <Panel title={t.raw('Raids')} span={6} id="sec-raid">
        <ToggleRow
          title={t.raw('Watch for raids')}
          checked={raid.enabled}
          onChange={(enabled) => patchRaid({ enabled })}
        />
        <PanelBody>
          <Fields>
            <Field label={t.raw('Joins')}>
              <NumberInput
                value={raid.joins}
                min={3}
                max={500}
                onChange={(joins) => patchRaid({ joins })}
              />
            </Field>
            <Field label={t.raw('Within')}>
              <NumberInput
                value={raid.perSeconds}
                min={5}
                max={600}
                suffix="s"
                onChange={(perSeconds) => patchRaid({ perSeconds })}
              />
            </Field>
            <Field label={t.raw('Similar accounts')}>
              <NumberInput
                value={raid.waveSize}
                min={2}
                max={100}
                onChange={(waveSize) => patchRaid({ waveSize })}
              />
            </Field>
            <Field label={t.raw('Same message from new members')}>
              <NumberInput
                value={raid.floodMembers}
                min={2}
                max={100}
                onChange={(floodMembers) => patchRaid({ floodMembers })}
              />
            </Field>
            <Field label={t.raw('Raid mode lasts')}>
              <NumberInput
                value={raid.minutes}
                min={1}
                max={1440}
                suffix="min"
                onChange={(minutes) => patchRaid({ minutes })}
              />
            </Field>
            <Field label={t.raw('Slowmode during a raid')}>
              <NumberInput
                value={raid.slowmodeSeconds}
                min={0}
                max={21_600}
                suffix="s"
                onChange={(slowmodeSeconds) => patchRaid({ slowmodeSeconds })}
              />
            </Field>
          </Fields>
          {raid.slowmodeSeconds > 0 ? (
            <ChannelMulti
              value={raid.slowmodeChannelIds}
              onChange={(slowmodeChannelIds) => patchRaid({ slowmodeChannelIds })}
            />
          ) : null}
        </PanelBody>
        <ToggleRow
          title={t.raw('Pause invites during a raid')}
          checked={raid.pauseInvites}
          onChange={(pauseInvites) => patchRaid({ pauseInvites })}
        />
        {readOnly ? null : (
          <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <div className="mx-between">
              <StatusText status={status} />
              {view.raid ? null : (
                <TwoStep
                  label={t.raw('Start raid mode now')}
                  disabled={busy}
                  run={() => act('raid.start')}
                />
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel title={t.raw('Nukes')} span={6} id="sec-nuke">
        <ToggleRow
          title={t.raw('Stop mass changes')}
          checked={nuke.enabled}
          onChange={(enabled) => patchNuke({ enabled })}
        />
        <PanelBody>
          <Fields>
            <Field label={t.raw('Time window')}>
              <NumberInput
                value={nuke.windowSeconds}
                min={10}
                max={3600}
                suffix="s"
                onChange={(windowSeconds) => patchNuke({ windowSeconds })}
              />
            </Field>
            {limitKeys.map((entry) => (
              <Field key={entry.key} label={t.raw(entry.label)}>
                <NumberInput
                  value={nuke.limits[entry.key]}
                  min={1}
                  max={200}
                  onChange={(limit) =>
                    patchNuke({ limits: { ...nuke.limits, [entry.key]: limit } })
                  }
                />
              </Field>
            ))}
            <Field label={t.raw('People')}>
              <Seg
                label={t.raw('People')}
                value={nuke.response}
                options={[
                  { value: 'strip', label: t.raw('Take roles') },
                  { value: 'kick', label: t.raw('Kick') },
                  { value: 'ban', label: t.raw('Ban') },
                ]}
                onChange={(response) => patchNuke({ response })}
              />
            </Field>
            <Field label={t.raw('Bots')}>
              <Seg
                label={t.raw('Bots')}
                value={nuke.botResponse}
                options={[
                  { value: 'strip', label: t.raw('Take roles') },
                  { value: 'kick', label: t.raw('Kick') },
                  { value: 'ban', label: t.raw('Ban') },
                ]}
                onChange={(botResponse) => patchNuke({ botResponse })}
              />
            </Field>
          </Fields>
          <span className="mx-label">{t.raw('Trusted roles')}</span>
          <RoleMulti
            value={nuke.trustedRoleIds}
            onChange={(trustedRoleIds) => patchNuke({ trustedRoleIds })}
          />
          <span className="mx-label">{t.raw('Trusted user IDs')}</span>
          <WordList
            mono
            value={nuke.trustedUserIds}
            onChange={(ids) =>
              patchNuke({ trustedUserIds: ids.filter((id) => /^\d{1,21}$/.test(id)) })
            }
          />
        </PanelBody>
        <ToggleRow
          title={t.raw('Restore from the last backup')}
          sub={t.raw('Needs Backups.')}
          checked={nuke.restore}
          onChange={(restore) => patchNuke({ restore })}
        />
      </Panel>

      <Panel title={t.raw('Honeypot')} span={6} id="sec-honeypot">
        <ToggleRow
          title={t.raw('Trap spam bots')}
          checked={honeypot.enabled}
          onChange={(enabled) => patchHoneypot({ enabled })}
        />
        <PanelBody>
          <span className="mx-label">{t.raw('Trap channels')}</span>
          <ChannelMulti
            value={honeypot.channelIds}
            onChange={(channelIds) => patchHoneypot({ channelIds: channelIds.slice(0, 5) })}
          />
          <Fields>
            <Field label={t.raw('Trap role')}>
              <RoleSelect
                value={honeypot.roleId}
                none={t.raw('No trap role')}
                onChange={(roleId) => patchHoneypot({ roleId })}
              />
            </Field>
            <Field label={t.raw('What happens')}>
              <Seg
                label={t.raw('What happens')}
                value={honeypot.action}
                options={[
                  { value: 'softban', label: t.raw('Kick and clean up') },
                  { value: 'ban', label: t.raw('Ban') },
                  { value: 'quarantine', label: t.raw('Hold at the gate') },
                ]}
                onChange={(action) => patchHoneypot({ action })}
              />
            </Field>
          </Fields>
        </PanelBody>
        <ToggleRow
          title={t.raw('Moderators can post there')}
          checked={honeypot.exemptMods}
          onChange={(exemptMods) => patchHoneypot({ exemptMods })}
        />
        {readOnly || honeypot.channelIds.length >= 5 ? null : (
          <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <button
              type="button"
              className="mx-btn"
              disabled={busy}
              onClick={() => act('honeypot.setup')}
            >
              {t.raw('Create a trap channel')}
            </button>
          </div>
        )}
      </Panel>

      <Panel title={t.raw('Alerts')} span={6} id="sec-alerts">
        <PanelBody>
          <Fields>
            <Field label={t.raw('Log channel')}>
              <ChannelSelect
                value={value.logChannelId}
                onChange={(logChannelId) => set({ logChannelId })}
              />
            </Field>
            <Field label={t.raw('Ping on raids and nukes')}>
              <RoleSelect
                value={value.alertRoleId}
                none={t.raw('Nobody')}
                onChange={(alertRoleId) => set({ alertRoleId })}
              />
            </Field>
          </Fields>
        </PanelBody>
      </Panel>

      <Panel title={t.raw('Recent joins')} span={12} id="sec-checks">
        {view.checks.length === 0 ? (
          <Empty mood="sleeping">{t.raw('Nobody joined since Security was set up.')}</Empty>
        ) : (
          <div className="mx-scroll">
            <table className="mx-table">
              <thead>
                <tr>
                  <th scope="col">{t.raw('Member')}</th>
                  <th scope="col">{t.raw('Score')}</th>
                  <th scope="col">{t.raw('Why')}</th>
                  <th scope="col">{t.raw('Result')}</th>
                  <th scope="col">{t.raw('When')}</th>
                  <th scope="col" aria-label={t.raw('Actions')} />
                </tr>
              </thead>
              <tbody>
                {view.checks.map((check) => (
                  <tr key={check.id}>
                    <td>{check.name}</td>
                    <td className="mx-mono">{check.score}</td>
                    <td className="mx-muted">
                      {check.reasons.length > 0
                        ? check.reasons.map((reason) => reasonText(t, reason)).join(', ')
                        : t.raw('Nothing unusual')}
                    </td>
                    <td>{t.raw(statusLabels[check.status] ?? check.status)}</td>
                    <td className="mx-muted">{ago(t, check.at, view.now)}</td>
                    <td>
                      {check.status === 'pending' && !readOnly ? (
                        <button
                          type="button"
                          className="mx-btn mx-btn-ghost"
                          disabled={busy}
                          onClick={() => act('pass', { userId: check.userId })}
                        >
                          {t.raw('Let in')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t.raw('Incidents')} span={12} id="sec-events">
        {view.events.filter((event) => event.kind !== 'verify').length === 0 ? (
          <Empty mood="sleeping">{t.raw('No raids, nukes or trapped bots yet.')}</Empty>
        ) : (
          view.events
            .filter((event) => event.kind !== 'verify')
            .map((event) => (
              <div key={event.id} className="mx-row">
                <div className="mx-row-main">
                  <span className="mx-row-title">{eventText(t, event)}</span>
                  <span className="mx-sub">{ago(t, event.at, view.now)}</span>
                </div>
              </div>
            ))
        )}
      </Panel>
    </Grid>
  );
}
