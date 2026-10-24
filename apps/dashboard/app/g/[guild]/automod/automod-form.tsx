'use client';

import type {
  AutomodAction,
  AutomodConfig,
  AutomodMode,
  AutomodRuleKey,
} from '@maxwell/core/modules/automod';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import {
  ChannelMulti,
  ChannelSelect,
  NumberInput,
  RoleMulti,
  RoleSelect,
  Seg,
  Select,
  Switch,
  Tabs,
  ToggleRow,
  WordList,
} from '@/components/controls';
import { useChannelName, useGuild } from '@/components/guild';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import { runAction, undoEntry } from '@/lib/actions';
import { clock, dayTime, hoursLabel, inSentence, plural, span } from '@/lib/time';
import { dryRunResult, gateRole, gateStatus, startDryRun } from './actions';
import type { DryRunView, GateView } from './data';

type Rules = AutomodConfig['rules'];
type Raid = AutomodConfig['raid'];
type AnyRule = Rules[AutomodRuleKey];

const RULES: { key: AutomodRuleKey; name: string }[] = [
  { key: 'spam', name: 'Spam' },
  { key: 'invites', name: 'Invite links' },
  { key: 'links', name: 'Links' },
  { key: 'mentions', name: 'Mass mentions' },
  { key: 'caps', name: 'Caps' },
  { key: 'words', name: 'Word list' },
  { key: 'repeats', name: 'Repeated messages' },
  { key: 'emoji', name: 'Emoji spam' },
  { key: 'newAccountLinks', name: 'New accounts posting links' },
];

const MODES: { value: AutomodMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'log', label: 'Log' },
  { value: 'enforce', label: 'Enforce' },
];

const ACTIONS: { value: AutomodAction; label: string }[] = [
  { value: 'delete', label: 'Delete' },
  { value: 'warn', label: 'Warn' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'kick', label: 'Kick' },
  { value: 'ban', label: 'Ban' },
];

type Tab = 'rules' | 'raid' | 'settings';

const TABS: { value: Tab; label: string }[] = [
  { value: 'rules', label: 'Rules' },
  { value: 'raid', label: 'Raid shield' },
  { value: 'settings', label: 'Settings' },
];

function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="mx-fields" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {children}
    </div>
  );
}

const AGE_OPTIONS = [1, 6, 24, 72, 168, 720];
const HOLD_OPTIONS = [0, 24, 72, 168];
const LOCKDOWN_OPTIONS = [5, 15, 30, 60, 120, 360];
const TRIGGERS = [
  [5, 10],
  [10, 10],
  [20, 30],
  [30, 60],
];

function summary(key: AutomodRuleKey, rules: Rules): string {
  switch (key) {
    case 'spam':
      return `More than ${rules.spam.maxMessages} messages in ${rules.spam.perSeconds} seconds`;
    case 'invites':
      return rules.invites.allowedCodes.length > 0
        ? `Invites to other communities, ${rules.invites.allowedCodes.length} allowed`
        : 'Invites to other communities';
    case 'links': {
      const count = rules.links.domains.length;
      if (rules.links.listMode === 'allow') return `Only ${plural(count, 'allowed domain')}`;
      return count > 0 ? plural(count, 'blocked domain') : 'No domains listed yet';
    }
    case 'mentions':
      return `More than ${rules.mentions.maxMentions} mentions in one message`;
    case 'caps':
      return `Over ${rules.caps.maxPercent}% capitals, ${rules.caps.minLength} characters or more`;
    case 'words':
      return rules.words.patterns.length > 0
        ? `${plural(rules.words.patterns.length, 'pattern')}, wildcards allowed`
        : 'No patterns yet';
    case 'repeats':
      return `Same text more than ${rules.repeats.maxRepeats} times in ${rules.repeats.perSeconds} seconds`;
    case 'emoji':
      return `More than ${rules.emoji.maxEmojis} emojis`;
    case 'newAccountLinks':
      return `Accounts under ${hoursLabel(rules.newAccountLinks.minAccountAgeHours)}`;
  }
}

function withCurrent<T extends string>(
  options: { value: T; label: string }[],
  value: T,
  label: string,
): { value: T; label: string }[] {
  return options.some((option) => option.value === value)
    ? options
    : [...options, { value, label }];
}

function ShieldIcon({ color }: { color: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 160 160" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M18 152V80a62 62 0 0 1 124 0v72H95v-14a15 15 0 0 0-30 0v14z" fill={color} />
      <path d="M18 138h47v14H18zM95 138h47v14H95z" fill="#E6E6EA" />
      <g transform="translate(80 78) scale(.74) translate(-80 -80)">
        <path
          d="M80 36l38 14v28c0 25-17 42-38 48-21-6-38-23-38-48V50z"
          fill="none"
          stroke="#17171B"
          strokeWidth="15"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function Gate({ initial, raid }: { initial: GateView; raid: Raid }) {
  const { guildId, timezone } = useGuild();
  const { readOnly } = useDraft<AutomodConfig>();
  const [gate, setGate] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const poll = usePoll();

  const refresh = (until: (next: GateView) => boolean) =>
    poll(
      async () => {
        const result = await gateStatus(guildId);
        if (!result.ok || !result.data) return false;
        const next = result.data;
        if (!until(next)) return false;
        setGate(next);
        setBusy(false);
        return true;
      },
      () => {
        setBusy(false);
        setStatus({ message: 'Maxwell has not answered yet. Reload in a moment.', error: true });
      },
      40,
    );

  const act = (action: 'gate.letin' | 'gate.banall' | 'lockdown.end') => {
    setBusy(true);
    setStatus(null);
    setOpen(false);
    const before = gate;
    runAction(
      guildId,
      'automod',
      action,
      action === 'lockdown.end' ? { incidentId: before.incident?.id ?? null } : { userIds: null },
    ).then((result) => {
      if (!result.ok) {
        setBusy(false);
        setStatus({ message: result.error, error: true });
        return;
      }
      refresh((next) =>
        action === 'lockdown.end'
          ? next.incident?.id !== before.incident?.id
          : next.heldCount < before.heldCount || next.last?.entryId !== before.last?.entryId,
      );
    });
  };

  const undo = (entryId: string) => {
    setBusy(true);
    setStatus(null);
    undoEntry(guildId, entryId).then((result) => {
      if (!result.ok) {
        setBusy(false);
        setStatus({ message: result.error, error: true });
        return;
      }
      refresh((next) => next.last?.entryId !== entryId);
    });
  };

  const held = gate.heldCount;
  const active = held > 0 || gate.incident !== null;
  if (!active && !gate.last) return null;

  let title: string;
  let detail: string;
  if (active && held > 0) {
    title = gate.incident
      ? `Raid shield held ${plural(held, 'account')} at the gate`
      : `${plural(held, 'account')} waiting at the gate`;
    const started = inSentence(
      dayTime(gate.incident?.startedAt ?? gate.held[0]?.heldAt ?? gate.now, gate.now, timezone),
    );
    const until = gate.incident?.endsAt
      ? ` New joins wait until ${clock(gate.incident.endsAt, timezone)}.`
      : '';
    detail = `Held since ${started}.${until}${raid.gateRoleId ? ' They have the gate role and see no channels.' : ''}`;
  } else if (active && gate.incident) {
    title = gate.incident.endsAt
      ? `Lockdown until ${clock(gate.incident.endsAt, timezone)}`
      : 'Lockdown is on';
    detail = 'Nobody joined since it started.';
  } else {
    title = gate.last?.summary ?? '';
    detail = gate.last ? dayTime(gate.last.createdAt, gate.now, timezone) : '';
  }

  return (
    <>
      <div className={`mx-callout ${active ? 'mx-callout-warn' : 'mx-callout-info'}`} role="status">
        <ShieldIcon color={active ? '#F2C14E' : '#3A9EEA'} />
        <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="mx-row-title">{title}</span>
          <span className="mx-sub" style={{ color: 'var(--mx-text-2)' }}>
            {detail}
          </span>
          <StatusText status={status} />
        </div>
        {held > 0 ? (
          <button
            type="button"
            className="mx-btn"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide list' : `Show ${held}`}
          </button>
        ) : null}
        {!readOnly && held > 0 ? (
          <>
            <button
              type="button"
              className="mx-btn"
              disabled={busy}
              onClick={() => act('gate.letin')}
            >
              Let all in
            </button>
            <TwoStep label="Ban all" danger disabled={busy} run={() => act('gate.banall')} />
          </>
        ) : null}
        {!readOnly && held === 0 && gate.incident ? (
          <button
            type="button"
            className="mx-btn"
            disabled={busy}
            onClick={() => act('lockdown.end')}
          >
            End lockdown
          </button>
        ) : null}
        {!readOnly && !active && gate.last ? (
          <button
            type="button"
            className="mx-btn"
            disabled={busy}
            onClick={() => gate.last && undo(gate.last.entryId)}
          >
            Undo
          </button>
        ) : null}
      </div>

      {open && held > 0 ? (
        <section className="mx-panel" aria-label="Held at the gate">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            }}
          >
            {gate.held.map((member) => (
              <div
                key={member.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderTop: '1px solid var(--mx-line)',
                  fontSize: 13,
                }}
              >
                <Avatar src={member.avatar} name={member.name} size={22} />
                <span className="mx-ellipsis" style={{ flex: 1, minWidth: 0 }}>
                  {member.name}
                </span>
                {member.accountAge !== null ? (
                  <span className="mx-sub">{`${span(member.accountAge)} old`}</span>
                ) : null}
              </div>
            ))}
          </div>
          {held > gate.held.length ? (
            <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
              <span className="mx-sub">{`${plural(held - gate.held.length, 'more account')}`}</span>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function RuleParams({
  ruleKey,
  rules,
  set,
}: {
  ruleKey: AutomodRuleKey;
  rules: Rules;
  set: (patch: Partial<AnyRule>) => void;
}) {
  switch (ruleKey) {
    case 'spam':
      return (
        <Pair>
          <Field label="Messages">
            <NumberInput
              value={rules.spam.maxMessages}
              min={1}
              max={50}
              onChange={(maxMessages) => set({ maxMessages })}
            />
          </Field>
          <Field label="Seconds">
            <NumberInput
              value={rules.spam.perSeconds}
              min={2}
              max={120}
              onChange={(perSeconds) => set({ perSeconds })}
            />
          </Field>
        </Pair>
      );
    case 'invites':
      return (
        <div className="mx-field">
          <span className="mx-label">Allowed invites</span>
          <WordList
            value={rules.invites.allowedCodes}
            mono
            placeholder="Invite code or link"
            onChange={(allowedCodes) => set({ allowedCodes })}
          />
        </div>
      );
    case 'links':
      return (
        <>
          <div className="mx-field">
            <span className="mx-label">Domains</span>
            <Seg
              label="Domain list"
              value={rules.links.listMode}
              options={[
                { value: 'deny', label: 'Block these' },
                { value: 'allow', label: 'Allow only these' },
              ]}
              onChange={(listMode) => set({ listMode })}
            />
          </div>
          <WordList
            value={rules.links.domains}
            mono
            placeholder="example.com"
            onChange={(domains) => set({ domains })}
          />
        </>
      );
    case 'mentions':
      return (
        <>
          <Pair>
            <Field label="Mentions">
              <NumberInput
                value={rules.mentions.maxMentions}
                min={1}
                max={100}
                onChange={(maxMentions) => set({ maxMentions })}
              />
            </Field>
          </Pair>
          <ToggleRow
            title="Count role mentions"
            order
            checked={rules.mentions.countRoles}
            onChange={(countRoles) => set({ countRoles })}
          />
        </>
      );
    case 'caps':
      return (
        <Pair>
          <Field label="Percent">
            <NumberInput
              value={rules.caps.maxPercent}
              min={50}
              max={100}
              onChange={(maxPercent) => set({ maxPercent })}
            />
          </Field>
          <Field label="Min length">
            <NumberInput
              value={rules.caps.minLength}
              min={4}
              max={2000}
              onChange={(minLength) => set({ minLength })}
            />
          </Field>
        </Pair>
      );
    case 'words':
      return (
        <div className="mx-field">
          <span className="mx-label">Patterns</span>
          <WordList
            value={rules.words.patterns}
            mono
            placeholder="spam* or *scam*"
            onChange={(patterns) => set({ patterns })}
          />
        </div>
      );
    case 'repeats':
      return (
        <Pair>
          <Field label="Repeats">
            <NumberInput
              value={rules.repeats.maxRepeats}
              min={1}
              max={20}
              onChange={(maxRepeats) => set({ maxRepeats })}
            />
          </Field>
          <Field label="Seconds">
            <NumberInput
              value={rules.repeats.perSeconds}
              min={5}
              max={3600}
              onChange={(perSeconds) => set({ perSeconds })}
            />
          </Field>
        </Pair>
      );
    case 'emoji':
      return (
        <Pair>
          <Field label="Emojis">
            <NumberInput
              value={rules.emoji.maxEmojis}
              min={1}
              max={200}
              onChange={(maxEmojis) => set({ maxEmojis })}
            />
          </Field>
        </Pair>
      );
    case 'newAccountLinks': {
      const hours = rules.newAccountLinks.minAccountAgeHours;
      return (
        <Pair>
          <Field label="Account age under">
            <Select
              value={String(hours)}
              options={withCurrent(
                AGE_OPTIONS.map((value) => ({ value: String(value), label: hoursLabel(value) })),
                String(hours),
                hoursLabel(hours),
              )}
              onChange={(next) => set({ minAccountAgeHours: Number(next) })}
            />
          </Field>
        </Pair>
      );
    }
  }
}

function DryRunPanel({
  run,
  name,
  setMode,
}: {
  run: DryRunView;
  name: string;
  setMode: (mode: AutomodMode) => void;
}) {
  const { timezone } = useGuild();
  const { readOnly } = useDraft<AutomodConfig>();
  const channelName = useChannelName();
  const now = run.finishedAt ?? run.createdAt;
  const stats: [string, string][] = [
    ['Would have caught', run.caught.toLocaleString('en-US')],
    ['Messages checked', run.scanned.toLocaleString('en-US')],
    ['From moderators', run.byMods.toLocaleString('en-US')],
  ];
  return (
    <section className="mx-panel mx-s12" aria-labelledby="dry-title">
      <div className="mx-panel-head">
        <h2 id="dry-title">{`Dry run: ${name}, last 7 days`}</h2>
        {readOnly ? null : (
          <div className="mx-inline">
            <button type="button" className="mx-btn" onClick={() => setMode('log')}>
              Log only
            </button>
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              onClick={() => setMode('enforce')}
            >
              Enforce
            </button>
          </div>
        )}
      </div>
      <div
        className={run.caught === 0 ? 'mx-stat-quiet' : undefined}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          borderBottom: '1px solid var(--mx-line)',
        }}
      >
        {stats.map(([label, value]) => (
          <div key={label} className="mx-stat">
            <span className="mx-stat-label">{label}</span>
            <span className="mx-stat-value">{value}</span>
          </div>
        ))}
      </div>
      {run.samples.length === 0 ? (
        <Empty mood="happy">Nothing would have been caught.</Empty>
      ) : (
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Channel</th>
                <th scope="col">Message</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {run.samples.map((sample) => (
                <tr key={sample.messageId}>
                  <td>
                    {sample.name} {sample.byMod ? <span className="mx-sub">Moderator</span> : null}
                  </td>
                  <td className="mx-muted">{channelName(sample.channelId)}</td>
                  <td
                    className="mx-mono"
                    title={sample.content}
                    style={{
                      maxWidth: 420,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sample.content}
                  </td>
                  <td className="mx-muted" style={{ whiteSpace: 'nowrap' }}>
                    {dayTime(sample.createdAt, now, timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mx-field">
      <span className="mx-label">{label}</span>
      {children}
    </div>
  );
}

export function AutomodForm({
  hits,
  runs,
  gate,
  saved,
}: {
  hits: Record<string, number>;
  runs: DryRunView[];
  gate: GateView;
  saved: AutomodConfig;
}) {
  const { guildId } = useGuild();
  const router = useRouter();
  const { value, update, readOnly } = useDraft<AutomodConfig>();
  const [tab, setTab] = useState<Tab>('rules');
  const [selected, setSelected] = useState<AutomodRuleKey>('spam');
  const [results, setResults] = useState<Record<string, DryRunView>>(() =>
    Object.fromEntries(runs.map((run) => [run.ruleKey, run])),
  );
  const [running, setRunning] = useState<AutomodRuleKey | null>(null);
  const [dryStatus, setDryStatus] = useState<Status>(null);
  const [gateStatusText, setGateStatusText] = useState<Status>(null);
  const [setupPending, startSetup] = useTransition();
  const poll = usePoll();
  const gatePoll = usePoll();

  const rules = value.rules;
  const raid = value.raid;
  const rule = rules[selected];
  const ruleName = RULES.find((entry) => entry.key === selected)?.name ?? selected;
  const result = results[selected];
  const enforced = RULES.filter((entry) => rules[entry.key].mode === 'enforce').length;
  const logged = RULES.filter((entry) => rules[entry.key].mode === 'log').length;

  const setRule = (key: AutomodRuleKey, patch: Partial<AnyRule>) =>
    update((previous) => ({
      ...previous,
      rules: { ...previous.rules, [key]: { ...previous.rules[key], ...patch } } as Rules,
    }));
  const setRaid = (patch: Partial<Raid>) =>
    update((previous) => ({ ...previous, raid: { ...previous.raid, ...patch } }));

  const dryRun = () => {
    const key = selected;
    setRunning(key);
    setDryStatus(null);
    startDryRun(guildId, key, rules[key]).then((started) => {
      if (!started.ok || !started.data) {
        setRunning(null);
        setDryStatus({ message: started.ok ? 'That did not work.' : started.error, error: true });
        return;
      }
      const id = started.data.id;
      poll(
        async () => {
          const next = await dryRunResult(guildId, id);
          if (!next.ok || !next.data) return false;
          const run = next.data;
          if (run.status === 'failed') {
            setRunning(null);
            setDryStatus({ message: 'The dry run failed. Try again.', error: true });
            return true;
          }
          if (run.status !== 'done') return false;
          setResults((previous) => ({ ...previous, [key]: run }));
          setRunning(null);
          return true;
        },
        () => {
          setRunning(null);
          setDryStatus({ message: 'Still running. Check back in a minute.', error: true });
        },
        40,
      );
    });
  };

  const setupGate = () => {
    if (JSON.stringify(value) !== JSON.stringify(saved)) {
      setGateStatusText({ message: 'Save or discard your changes first.', error: true });
      return;
    }
    setGateStatusText(null);
    startSetup(async () => {
      const queued = await runAction(guildId, 'automod', 'gate.setup');
      if (!queued.ok) {
        setGateStatusText({ message: queued.error, error: true });
        return;
      }
      gatePoll(
        async () => {
          const next = await gateRole(guildId);
          if (!next.ok || !next.data?.roleId) return false;
          router.refresh();
          return true;
        },
        () =>
          setGateStatusText({
            message: 'Maxwell has not answered yet. Reload in a moment.',
            error: true,
          }),
        40,
      );
    });
  };

  const trigger = `${raid.joins}:${raid.perSeconds}`;
  const triggerLabel = (joins: number, seconds: number) => `${joins} joins in ${seconds} seconds`;

  return (
    <div className="mx-stack" style={{ gap: 16 }}>
      <Gate initial={gate} raid={raid} />

      <Tabs label="AutoMod" value={tab} options={TABS} onChange={setTab} />

      {tab === 'rules' ? (
        <Grid>
          <Panel
            title="Rules"
            span={7}
            id="rules"
            actions={
              <span className="mx-sub">{`${enforced} enforced, ${logged} logging only`}</span>
            }
          >
            {RULES.map((entry) => {
              const mode = rules[entry.key].mode;
              const count = hits[entry.key] ?? 0;
              const current = entry.key === selected;
              return (
                <div key={entry.key} className="mx-row">
                  <div className="mx-row-main">
                    <button
                      type="button"
                      className="mx-pick mx-row-title"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        setSelected(entry.key);
                        setDryStatus(null);
                      }}
                    >
                      {entry.name}
                    </button>
                    <span className="mx-sub mx-ellipsis">{summary(entry.key, rules)}</span>
                  </div>
                  <span
                    className="mx-sub"
                    style={{ width: 92, textAlign: 'right', color: 'var(--mx-faint)' }}
                  >
                    {mode === 'off' || count === 0
                      ? null
                      : `${count.toLocaleString('en-US')} this week`}
                  </span>
                  <Seg
                    label={`Mode for ${entry.name}`}
                    value={mode}
                    options={MODES}
                    onChange={(next) => setRule(entry.key, { mode: next })}
                  />
                </div>
              );
            })}
          </Panel>

          <Panel title={ruleName} span={5} id="edit">
            <PanelBody>
              <RuleParams
                ruleKey={selected}
                rules={rules}
                set={(patch) => setRule(selected, patch)}
              />
              <Pair>
                <Field label="Action">
                  <Select
                    value={rule.action}
                    options={ACTIONS}
                    onChange={(action) => setRule(selected, { action })}
                  />
                </Field>
                {rule.action === 'timeout' ? (
                  <Field label="Timeout">
                    <NumberInput
                      value={rule.timeoutMinutes}
                      min={1}
                      max={525_600}
                      suffix="minutes"
                      onChange={(timeoutMinutes) => setRule(selected, { timeoutMinutes })}
                    />
                  </Field>
                ) : null}
              </Pair>
              {rule.action === 'delete' ? null : (
                <ToggleRow
                  title="Delete the message too"
                  order
                  checked={rule.deleteMessage}
                  onChange={(deleteMessage) => setRule(selected, { deleteMessage })}
                />
              )}
              <Labelled label="Ignored channels">
                <ChannelMulti
                  value={rule.exemptChannelIds}
                  onChange={(exemptChannelIds) => setRule(selected, { exemptChannelIds })}
                />
              </Labelled>
              <Labelled label="Ignored roles">
                <RoleMulti
                  value={rule.exemptRoleIds}
                  onChange={(exemptRoleIds) => setRule(selected, { exemptRoleIds })}
                />
              </Labelled>
              <ToggleRow
                title="Ignore moderators"
                order
                checked={rule.exemptMods}
                onChange={(exemptMods) => setRule(selected, { exemptMods })}
              />
              {readOnly ? null : (
                <div className="mx-inline">
                  <button
                    type="button"
                    className="mx-btn mx-btn-primary"
                    disabled={running !== null}
                    onClick={dryRun}
                  >
                    {running === selected
                      ? 'Running'
                      : result
                        ? 'Run dry run again'
                        : 'Dry run on the last 7 days'}
                  </button>
                  <StatusText status={dryStatus} />
                </div>
              )}
            </PanelBody>
          </Panel>

          {result ? (
            <DryRunPanel
              run={result}
              name={ruleName}
              setMode={(mode) => setRule(selected, { mode })}
            />
          ) : null}
        </Grid>
      ) : null}

      {tab === 'raid' ? (
        <Panel
          title="Raid shield"
          id="shield"
          actions={
            <Switch
              order
              label="Raid shield"
              checked={raid.enabled}
              onChange={(enabled) => setRaid({ enabled })}
            />
          }
        >
          <PanelBody>
            <Fields>
              <Field label="Trigger">
                <Select
                  value={trigger}
                  options={withCurrent(
                    TRIGGERS.map(([joins = 0, seconds = 0]) => ({
                      value: `${joins}:${seconds}`,
                      label: triggerLabel(joins, seconds),
                    })),
                    trigger,
                    triggerLabel(raid.joins, raid.perSeconds),
                  )}
                  onChange={(next) => {
                    const [joins, perSeconds] = next.split(':').map(Number);
                    if (joins && perSeconds) setRaid({ joins, perSeconds });
                  }}
                />
              </Field>
              <Field label="Lockdown length">
                <Select
                  value={String(raid.lockdownMinutes)}
                  options={withCurrent(
                    LOCKDOWN_OPTIONS.map((minutes) => ({
                      value: String(minutes),
                      label: minutes < 60 ? `${minutes} minutes` : hoursLabel(minutes / 60),
                    })),
                    String(raid.lockdownMinutes),
                    `${raid.lockdownMinutes} minutes`,
                  )}
                  onChange={(next) => setRaid({ lockdownMinutes: Number(next) })}
                />
              </Field>
              <Field label="Hold accounts younger than">
                <Select
                  value={String(raid.minAccountAgeHours)}
                  options={withCurrent(
                    HOLD_OPTIONS.map((hours) => ({
                      value: String(hours),
                      label: hours === 0 ? 'Off' : hoursLabel(hours),
                    })),
                    String(raid.minAccountAgeHours),
                    hoursLabel(raid.minAccountAgeHours),
                  )}
                  onChange={(next) => setRaid({ minAccountAgeHours: Number(next) })}
                />
              </Field>
              <Labelled label="Gate role">
                <div className="mx-inline" style={{ flexWrap: 'nowrap' }}>
                  <RoleSelect
                    label="Gate role"
                    value={raid.gateRoleId}
                    onChange={(gateRoleId) => setRaid({ gateRoleId })}
                  />
                  {readOnly || raid.gateRoleId ? null : (
                    <button
                      type="button"
                      className="mx-btn"
                      disabled={setupPending}
                      onClick={setupGate}
                    >
                      Create
                    </button>
                  )}
                </div>
                <StatusText status={gateStatusText} />
              </Labelled>
              <Field label="Waiting room">
                <ChannelSelect
                  value={raid.gateChannelId}
                  onChange={(gateChannelId) => setRaid({ gateChannelId })}
                />
              </Field>
              <Field label="Ping">
                <RoleSelect
                  value={raid.alertRoleId}
                  none="Nobody"
                  onChange={(alertRoleId) => setRaid({ alertRoleId })}
                />
              </Field>
            </Fields>
          </PanelBody>
        </Panel>
      ) : null}

      {tab === 'settings' ? (
        <Grid>
          <Panel title="General" span={7} id="settings">
            <PanelBody>
              <Field label="Log channel">
                <ChannelSelect
                  value={value.logChannelId}
                  onChange={(logChannelId) => update((previous) => ({ ...previous, logChannelId }))}
                />
              </Field>
              <Labelled label="Moderator roles">
                <RoleMulti
                  value={value.modRoleIds}
                  onChange={(modRoleIds) => update((previous) => ({ ...previous, modRoleIds }))}
                />
              </Labelled>
              <Labelled label="Channels ignored everywhere">
                <ChannelMulti
                  value={value.exemptChannelIds}
                  onChange={(exemptChannelIds) =>
                    update((previous) => ({ ...previous, exemptChannelIds }))
                  }
                />
              </Labelled>
              <Labelled label="Roles ignored everywhere">
                <RoleMulti
                  value={value.exemptRoleIds}
                  onChange={(exemptRoleIds) =>
                    update((previous) => ({ ...previous, exemptRoleIds }))
                  }
                />
              </Labelled>
            </PanelBody>
          </Panel>
          <Panel title="Options" span={5} id="options">
            <PanelBody>
              <ToggleRow
                title="Ignore bots and webhooks"
                order
                checked={value.ignoreBots}
                onChange={(ignoreBots) => update((previous) => ({ ...previous, ignoreBots }))}
              />
              <ToggleRow
                title="Tell members why"
                order
                checked={value.notifyMembers}
                onChange={(notifyMembers) => update((previous) => ({ ...previous, notifyMembers }))}
              />
              <ToggleRow
                title="Keep 7 days of messages for dry runs"
                order
                checked={value.keepHistory}
                onChange={(keepHistory) => update((previous) => ({ ...previous, keepHistory }))}
              />
            </PanelBody>
          </Panel>
        </Grid>
      ) : null}
    </div>
  );
}
