'use client';

import type { WelcomeConfig } from '@maxwell/core/modules/welcome';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  ChannelSelect,
  RoleMulti,
  RoleSelect,
  Select,
  Switch,
  TextArea,
  TextInput,
  ToggleRow,
} from '@/components/controls';
import { useChannelName, useGuild } from '@/components/guild';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { outcome, type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { runAction } from '@/lib/actions';
import { minutesLabel } from '@/lib/time';

export interface Sample {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  server: string;
  members: number | null;
  created: string;
}

type SendAs = 'channel' | 'dm' | 'both' | 'none';
type Target = 'join' | 'dm';

const sendAsOptions = [
  { value: 'channel', label: 'Channel message' },
  { value: 'dm', label: 'Direct message' },
  { value: 'both', label: 'Both' },
  { value: 'none', label: 'Nothing' },
] as const;

const tokens = ['user', 'name', 'username', 'server', 'count', 'ordinal', 'created'] as const;

const delays = [5, 10, 30, 60, 1440, 10080];

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}

function variables(sample: Sample, offset = 0): Record<string, string> {
  const members = sample.members === null ? null : Math.max(sample.members + offset, 0);
  return {
    user: `@${sample.name}`,
    name: sample.name,
    username: sample.username,
    id: sample.id,
    server: sample.server,
    count: members === null ? '?' : members.toLocaleString('en-US'),
    ordinal: members === null ? '?' : ordinal(members),
    created: sample.created,
  };
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-z]+)\}/gi, (match, key: string) => vars[key.toLowerCase()] ?? match);
}

function Card({
  title,
  subtitle,
  sample,
  muted,
}: {
  title: string;
  subtitle: string;
  sample: Sample;
  muted?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={`${title}, ${subtitle}`}
      style={{
        width: '100%',
        maxWidth: 420,
        borderRadius: 8,
        background: muted ? 'var(--mx-field)' : 'var(--mx-raised)',
        borderLeft: `4px solid ${muted ? 'var(--mx-faint)' : 'var(--mx-north)'}`,
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <Avatar src={sample.avatarUrl} name={sample.name} size={56} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          className="mx-ellipsis"
          style={{ fontFamily: 'var(--mx-display)', fontWeight: 700, fontSize: 18 }}
        >
          {title}
        </span>
        <span className="mx-sub mx-ellipsis">{subtitle}</span>
      </div>
    </div>
  );
}

function sendAsOf(value: WelcomeConfig): SendAs {
  if (value.join.enabled && value.dm.enabled) return 'both';
  if (value.join.enabled) return 'channel';
  if (value.dm.enabled) return 'dm';
  return 'none';
}

function MessagePanel() {
  const { value, set, readOnly } = useDraft<WelcomeConfig>();
  const sendAs = sendAsOf(value);
  const channel = sendAs === 'channel' || sendAs === 'both';
  const direct = sendAs === 'dm' || sendAs === 'both';
  const [target, setTarget] = useState<Target>('join');
  const active: Target = channel && direct ? target : direct ? 'dm' : 'join';
  const refs = { join: useRef<HTMLTextAreaElement>(null), dm: useRef<HTMLTextAreaElement>(null) };
  const length = (active === 'dm' ? value.dm.message : value.join.message).length;

  const setJoin = (patch: Partial<WelcomeConfig['join']>) =>
    set({ join: { ...value.join, ...patch } });
  const setDm = (patch: Partial<WelcomeConfig['dm']>) => set({ dm: { ...value.dm, ...patch } });

  const insert = (token: string) => {
    const text = `{${token}}`;
    const current = active === 'dm' ? value.dm.message : value.join.message;
    const area = refs[active].current;
    const start = area?.selectionStart ?? current.length;
    const end = area?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${text}${current.slice(end)}`.slice(0, 2000);
    if (active === 'dm') setDm({ message: next });
    else setJoin({ message: next });
    requestAnimationFrame(() => {
      if (!area) return;
      area.focus();
      area.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const box = (which: Target, label: string, message: string, onChange: (v: string) => void) => (
    <label className="mx-field">
      <span className="mx-label">{label}</span>
      <textarea
        ref={refs[which]}
        className="mx-textarea"
        rows={4}
        maxLength={2000}
        value={message}
        readOnly={readOnly}
        onFocus={() => setTarget(which)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );

  return (
    <Panel
      title="Welcome message"
      id="w-msg"
      actions={<span className="mx-sub">{length.toLocaleString('en-US')} / 2,000</span>}
    >
      <PanelBody>
        <Fields>
          <Field label="Send as">
            <Select
              value={sendAs}
              options={sendAsOptions}
              onChange={(next) =>
                set({
                  join: { ...value.join, enabled: next === 'channel' || next === 'both' },
                  dm: { ...value.dm, enabled: next === 'dm' || next === 'both' },
                })
              }
            />
          </Field>
          {channel ? (
            <Field label="Channel">
              <ChannelSelect
                value={value.join.channelId}
                onChange={(channelId) => setJoin({ channelId })}
              />
            </Field>
          ) : null}
        </Fields>
        {channel
          ? box('join', 'Message', value.join.message, (message) => setJoin({ message }))
          : null}
        {direct
          ? box('dm', 'Direct message', value.dm.message, (message) => setDm({ message }))
          : null}
        {(channel || direct) && !readOnly ? (
          <div className="mx-chips" role="group" aria-label="Insert a variable">
            {tokens.map((token) => (
              <button
                key={token}
                type="button"
                className="mx-chip mx-mono"
                style={{ border: 0, cursor: 'pointer', color: 'var(--mx-text-2)' }}
                onClick={() => insert(token)}
              >
                {`{${token}}`}
              </button>
            ))}
          </div>
        ) : null}
      </PanelBody>
      {channel ? (
        <div style={{ borderTop: '1px solid var(--mx-line)' }}>
          <Row title="Ping the member">
            <Switch
              label="Ping the member"
              checked={value.join.ping}
              onChange={(ping) => setJoin({ ping })}
            />
          </Row>
          <Row title="Welcome card" sub="Uses the style from Cards">
            <Switch
              label="Welcome card"
              checked={value.join.card}
              onChange={(card) => setJoin({ card })}
            />
          </Row>
          {value.join.card ? (
            <PanelBody>
              <Fields>
                <Field label="Card title">
                  <TextInput
                    value={value.join.cardTitle}
                    maxLength={80}
                    onChange={(cardTitle) => setJoin({ cardTitle })}
                  />
                </Field>
                <Field label="Card subtitle">
                  <TextInput
                    value={value.join.cardSubtitle}
                    maxLength={120}
                    onChange={(cardSubtitle) => setJoin({ cardSubtitle })}
                  />
                </Field>
              </Fields>
            </PanelBody>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function RulesGate({ posted }: { posted: { channelId: string; messageId: string } | null }) {
  const { value, set, readOnly } = useDraft<WelcomeConfig>();
  const { guildId } = useGuild();
  const channelName = useChannelName();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const rules = value.rules;
  const setRules = (patch: Partial<WelcomeConfig['rules']>) =>
    set({ rules: { ...rules, ...patch } });

  useEffect(() => {
    if (!status || status.error) return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [status, router]);

  const run = (action: 'rules.publish' | 'rules.remove', done: string) =>
    start(async () => {
      const result = await runAction(guildId, 'welcome', action);
      setStatus(outcome(result, done));
    });

  const ready = Boolean(rules.channelId && rules.roleId && rules.emoji);
  const where = rules.channelId ? channelName(rules.channelId) : null;

  return (
    <>
      <Row title="Rules gate" sub={where ? `A reaction on the rules post in ${where}` : undefined}>
        <Switch
          label="Rules gate"
          checked={rules.enabled}
          onChange={(enabled) => setRules({ enabled })}
        />
      </Row>
      {rules.enabled ? (
        <PanelBody>
          <Fields>
            <Field label="Rules channel">
              <ChannelSelect
                value={rules.channelId}
                onChange={(channelId) => setRules({ channelId })}
              />
            </Field>
            <Field label="Role for accepting">
              <RoleSelect value={rules.roleId} onChange={(roleId) => setRules({ roleId })} />
            </Field>
            <Field label="Reaction">
              <TextInput
                mono
                value={rules.emoji}
                maxLength={80}
                onChange={(emoji) => setRules({ emoji: emoji.trim() })}
              />
            </Field>
            <Field label="Existing message ID">
              <TextInput
                mono
                value={rules.messageId ?? ''}
                placeholder="Optional"
                maxLength={21}
                onChange={(next) => {
                  const id = next.replace(/\D/g, '');
                  setRules({ messageId: id || null });
                }}
              />
            </Field>
          </Fields>
          {rules.messageId ? null : (
            <>
              <Field label="Title">
                <TextInput
                  value={rules.title}
                  maxLength={256}
                  onChange={(title) => setRules({ title })}
                />
              </Field>
              <Field
                label="Rules"
                aside={`${rules.content.length.toLocaleString('en-US')} / 3,800`}
              >
                <TextArea
                  value={rules.content}
                  rows={5}
                  maxLength={3800}
                  onChange={(content) => setRules({ content })}
                />
              </Field>
            </>
          )}
          <ToggleRow
            title="Take the role back when the reaction goes"
            checked={rules.removeOnUnreact}
            onChange={(removeOnUnreact) => setRules({ removeOnUnreact })}
          />
          {readOnly ? (
            posted ? (
              <span className="mx-sub">Posted in {channelName(posted.channelId)}</span>
            ) : null
          ) : (
            <div className="mx-inline">
              <button
                type="button"
                className="mx-btn"
                disabled={pending || !ready}
                onClick={() =>
                  run('rules.publish', rules.messageId || posted ? 'Updating.' : 'Posting.')
                }
              >
                {rules.messageId ? 'Add the reaction' : posted ? 'Update post' : 'Post rules'}
              </button>
              {posted && !rules.messageId ? (
                <TwoStep
                  label="Remove post"
                  danger
                  disabled={pending}
                  run={() => run('rules.remove', 'Removing.')}
                />
              ) : null}
              {status ? (
                <StatusText status={status} />
              ) : posted && !rules.messageId ? (
                <span className="mx-sub">Posted in {channelName(posted.channelId)}</span>
              ) : null}
            </div>
          )}
        </PanelBody>
      ) : null}
    </>
  );
}

function JoinPanel({ posted }: { posted: { channelId: string; messageId: string } | null }) {
  const { value, set, update } = useDraft<WelcomeConfig>();
  const delay = value.delayedRoles[0]?.delayMinutes ?? 10;
  const gate = value.rules.enabled && value.rules.roleId !== null;
  const from = gate ? 'after the rules' : 'after joining';
  const options = (delays.includes(delay) ? delays : [...delays, delay].sort((a, b) => a - b)).map(
    (minutes) => ({ value: String(minutes), label: `${minutesLabel(minutes)} ${from}` }),
  );

  return (
    <Panel title="On join" id="w-join">
      <PanelBody>
        <div className="mx-field">
          <span className="mx-label">Roles later</span>
          <RoleMulti
            value={value.delayedRoles.map((entry) => entry.roleId)}
            onChange={(ids) =>
              update((previous) => ({
                ...previous,
                delayedRoles: ids.slice(0, 10).map((roleId) => ({
                  roleId,
                  delayMinutes:
                    previous.delayedRoles.find((entry) => entry.roleId === roleId)?.delayMinutes ??
                    delay,
                })),
              }))
            }
          />
        </div>
        {value.delayedRoles.length > 0 ? (
          <Fields>
            <Field label="Give roles">
              <Select
                label="Give roles"
                value={String(delay)}
                options={options}
                onChange={(next) =>
                  update((previous) => ({
                    ...previous,
                    delayedRoles: previous.delayedRoles.map((entry) => ({
                      ...entry,
                      delayMinutes: Number(next),
                    })),
                  }))
                }
              />
            </Field>
          </Fields>
        ) : null}
      </PanelBody>
      <div style={{ borderTop: '1px solid var(--mx-line)' }}>
        <Row title="Skip bots">
          <Switch
            label="Skip bots"
            checked={value.ignoreBots}
            onChange={(ignoreBots) => set({ ignoreBots })}
          />
        </Row>
        <RulesGate posted={posted} />
      </div>
    </Panel>
  );
}

function GoodbyePanel() {
  const { value, set } = useDraft<WelcomeConfig>();
  const leave = value.leave;
  const setLeave = (patch: Partial<WelcomeConfig['leave']>) =>
    set({ leave: { ...leave, ...patch } });

  return (
    <Panel
      title="Goodbye"
      id="w-bye"
      actions={
        <Switch
          label="Goodbye message"
          checked={leave.enabled}
          onChange={(enabled) => setLeave({ enabled })}
        />
      }
    >
      {leave.enabled ? (
        <PanelBody>
          <Fields>
            <Field label="Channel">
              <ChannelSelect
                value={leave.channelId}
                onChange={(channelId) => setLeave({ channelId })}
              />
            </Field>
          </Fields>
          <Field label="Message">
            <TextInput
              value={leave.message}
              maxLength={2000}
              onChange={(message) => setLeave({ message })}
            />
          </Field>
          <ToggleRow
            title="Goodbye card"
            checked={leave.card}
            onChange={(card) => setLeave({ card })}
          />
          {leave.card ? (
            <Fields>
              <Field label="Card title">
                <TextInput
                  value={leave.cardTitle}
                  maxLength={80}
                  onChange={(cardTitle) => setLeave({ cardTitle })}
                />
              </Field>
              <Field label="Card subtitle">
                <TextInput
                  value={leave.cardSubtitle}
                  maxLength={120}
                  onChange={(cardSubtitle) => setLeave({ cardSubtitle })}
                />
              </Field>
            </Fields>
          ) : null}
        </PanelBody>
      ) : null}
    </Panel>
  );
}

function PreviewPanel({ sample }: { sample: Sample }) {
  const { value, readOnly } = useDraft<WelcomeConfig>();
  const { guildId, userId } = useGuild();
  const channelName = useChannelName();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const vars = variables(sample);
  const leaveVars = variables(sample, -1);
  const plain = { ...vars, user: sample.name };
  const plainLeave = { ...leaveVars, user: sample.name };
  const kind = value.join.enabled ? 'join' : value.dm.enabled ? 'dm' : null;
  const empty = !value.join.enabled && !value.dm.enabled && !value.leave.enabled;

  const test = () =>
    start(async () => {
      if (!kind) return;
      const result = await runAction(guildId, 'welcome', 'preview', { userId, kind });
      setStatus(outcome(result, 'Sent.'));
    });

  return (
    <Panel
      title="Preview"
      id="w-prev"
      actions={
        <>
          <span className="mx-sub">As @{sample.username}</span>
          {readOnly || !kind ? null : (
            <button type="button" className="mx-btn mx-btn-ghost" disabled={pending} onClick={test}>
              Send test
            </button>
          )}
          <StatusText status={status} />
        </>
      }
    >
      {empty ? (
        <Empty mood="sleeping">Nothing is sent yet.</Empty>
      ) : (
        <PanelBody>
          <div className="mx-preview">
            {value.join.enabled ? (
              <>
                <span className="mx-sub">
                  {value.join.channelId ? channelName(value.join.channelId) : 'No channel'}
                </span>
                <MessagePreview content={value.join.message} vars={vars}>
                  {value.join.card ? (
                    <Card
                      title={fill(value.join.cardTitle, plain)}
                      subtitle={fill(value.join.cardSubtitle, plain)}
                      sample={sample}
                    />
                  ) : null}
                </MessagePreview>
              </>
            ) : null}
            {value.dm.enabled ? (
              <>
                <span className="mx-sub">Direct message to {sample.name}</span>
                <MessagePreview
                  content={value.dm.message}
                  vars={vars}
                  divided={value.join.enabled}
                />
              </>
            ) : null}
            {value.leave.enabled ? (
              <>
                <span className="mx-sub">
                  {value.leave.channelId ? channelName(value.leave.channelId) : 'No channel'}
                </span>
                <MessagePreview
                  content={value.leave.message}
                  vars={leaveVars}
                  divided={value.join.enabled || value.dm.enabled}
                >
                  {value.leave.card ? (
                    <Card
                      title={fill(value.leave.cardTitle, plainLeave)}
                      subtitle={fill(value.leave.cardSubtitle, plainLeave)}
                      sample={sample}
                      muted
                    />
                  ) : null}
                </MessagePreview>
              </>
            ) : null}
          </div>
        </PanelBody>
      )}
    </Panel>
  );
}

export function WelcomeForm({
  rulesPost,
  recent,
  sample,
}: {
  rulesPost: { channelId: string; messageId: string } | null;
  recent: { joined: number; accepted: number; quickLeaves: number };
  sample: Sample;
}) {
  const quiet = recent.joined === 0 && recent.accepted === 0 && recent.quickLeaves === 0;
  return (
    <Grid>
      <div className="mx-s7 mx-stack" style={{ gap: 16, minWidth: 0 }}>
        <MessagePanel />
        <JoinPanel posted={rulesPost} />
        <GoodbyePanel />
      </div>
      <div className="mx-s5 mx-stack" style={{ gap: 16, minWidth: 0 }}>
        <PreviewPanel sample={sample} />
        <Panel title="Last 7 days" id="w-stats">
          <div
            className={quiet ? 'mx-stat-quiet' : undefined}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
          >
            <div className="mx-stat">
              <span className="mx-stat-label">Joined</span>
              <span className="mx-stat-value">{recent.joined.toLocaleString('en-US')}</span>
            </div>
            <div className="mx-stat">
              <span className="mx-stat-label">Passed the gate</span>
              <span className="mx-stat-value">{recent.accepted.toLocaleString('en-US')}</span>
            </div>
            <div className="mx-stat">
              <span className="mx-stat-label">Left within a day</span>
              <span className="mx-stat-value">{recent.quickLeaves.toLocaleString('en-US')}</span>
            </div>
          </div>
        </Panel>
      </div>
    </Grid>
  );
}
