'use client';

import {
  dmActions,
  type EscalationStep,
  type ModerationConfig,
} from '@maxwell/core/modules/moderation';
import { useRef, useState, useTransition } from 'react';
import {
  AddPicker,
  ChannelSelect,
  Checkbox,
  NumberInput,
  RoleMulti,
  Select,
  Switch,
  ToggleRow,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { Callout, CloseIcon, Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { duration } from '@/lib/time';
import { setCommand } from './actions';

export interface CommandRow {
  name: string;
  description: string;
  on: boolean;
}

const timeoutMinutes = [5, 10, 30, 60, 360, 1_440, 10_080, 40_320];
const banDeleteDays = [0, 1, 2, 3, 7];
const expiryOptions = [30, 90, 180, 365];
const windowOptions = [7, 14, 30, 60, 90];

const dmNames: Record<(typeof dmActions)[number], string> = {
  warn: 'Warn',
  timeout: 'Timeout',
  kick: 'Kick',
  ban: 'Ban',
};

const presetSteps: Omit<EscalationStep, 'warns'>[] = [
  { action: 'timeout', durationMinutes: 10, review: false },
  { action: 'timeout', durationMinutes: 60, review: false },
  { action: 'timeout', durationMinutes: 1_440, review: false },
  { action: 'timeout', durationMinutes: 10_080, review: false },
  { action: 'kick', durationMinutes: null, review: false },
  { action: 'kick', durationMinutes: null, review: true },
  { action: 'ban', durationMinutes: 10_080, review: false },
  { action: 'ban', durationMinutes: null, review: true },
  { action: 'ban', durationMinutes: null, review: false },
];

function stepKey(step: Omit<EscalationStep, 'warns'>): string {
  const minutes = step.action === 'kick' ? '' : (step.durationMinutes ?? '');
  return `${step.action}:${minutes}:${step.review ? 1 : 0}`;
}

function stepLabel(step: Omit<EscalationStep, 'warns'>): string {
  const length = step.durationMinutes !== null ? duration(step.durationMinutes * 60_000) : null;
  const base =
    step.action === 'timeout'
      ? `Timeout ${length ?? 'default length'}`
      : step.action === 'kick'
        ? 'Kick'
        : length
          ? `Ban ${length}`
          : 'Ban';
  return step.review ? `${base}, held for review` : base;
}

function parseStep(key: string): Omit<EscalationStep, 'warns'> {
  const [action, minutes, review] = key.split(':');
  return {
    action: action === 'kick' || action === 'ban' ? action : 'timeout',
    durationMinutes: minutes ? Number(minutes) : null,
    review: review === '1',
  };
}

function days(value: number): string {
  return value === 1 ? '1 day' : `${value} days`;
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        fill="none"
        stroke="var(--mx-faint)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommandsPanel({ commands, prefix }: { commands: CommandRow[]; prefix: string }) {
  const { guildId } = useGuild();
  const [state, setState] = useState(() =>
    Object.fromEntries(commands.map((command) => [command.name, command.on])),
  );
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  return (
    <Panel title="Commands" span={5} actions={<StatusText status={status} />}>
      {commands.length === 0 ? (
        <Empty mood="sleeping">Maxwell lists them once it is online.</Empty>
      ) : (
        commands.map((command) => {
          const on = state[command.name] ?? true;
          return (
            <div key={command.name} className="mx-row">
              <div className="mx-row-main">
                <span className="mx-row-title mx-mono">{`${prefix}${command.name}`}</span>
                <span className="mx-sub">{command.description}</span>
              </div>
              <Switch
                order
                checked={on}
                disabled={pending}
                label={`${prefix}${command.name} ${on ? 'on' : 'off'}`}
                onChange={(next) => {
                  setState((previous) => ({ ...previous, [command.name]: next }));
                  start(async () => {
                    const result = await setCommand(guildId, command.name, next);
                    if (!result.ok) {
                      setState((previous) => ({ ...previous, [command.name]: !next }));
                      setStatus({ message: result.error, error: true });
                    } else {
                      setStatus(null);
                    }
                  });
                }}
              />
            </div>
          );
        })
      )}
    </Panel>
  );
}

function EscalationPanel() {
  const { value, set, readOnly } = useDraft<ModerationConfig>();
  const steps = value.escalationSteps;
  const expiry = value.warnExpiryDays;
  const ids = useRef<number[]>([]);
  const nextId = useRef(0);
  while (ids.current.length < steps.length) ids.current.push(nextId.current++);
  if (ids.current.length > steps.length) ids.current.length = steps.length;
  const rows = steps.map((step, position) => ({ step, id: ids.current[position] ?? position }));
  const expiryList =
    expiry === null || expiryOptions.includes(expiry) ? expiryOptions : [...expiryOptions, expiry];
  const windowList = windowOptions.includes(value.escalationWindowDays)
    ? windowOptions
    : [...windowOptions, value.escalationWindowDays].sort((a, b) => a - b);
  const counts = steps.map((step) => step.warns);
  const doubled = counts.find((count, index) => counts.indexOf(count) !== index);

  const update = (index: number, patch: Partial<EscalationStep>) =>
    set({
      escalationSteps: steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    });

  return (
    <Panel
      title="Escalation"
      span={7}
      id="escalation"
      actions={
        <Switch
          order
          checked={value.escalationEnabled}
          label="Escalation"
          onChange={(escalationEnabled) => set({ escalationEnabled })}
        />
      }
    >
      <PanelBody>
        <Fields>
          <Field label="Count warns from the last">
            <Select
              label="Count warns from the last"
              value={String(value.escalationWindowDays)}
              options={windowList.map((option) => ({ value: String(option), label: days(option) }))}
              onChange={(next) => set({ escalationWindowDays: Number(next) })}
            />
          </Field>
          <Field label="Warns expire after">
            <Select
              label="Warns expire after"
              value={expiry === null ? 'never' : String(expiry)}
              options={[
                ...expiryList.map((option) => ({ value: String(option), label: days(option) })),
                { value: 'never', label: 'Never' },
              ]}
              onChange={(next) => set({ warnExpiryDays: next === 'never' ? null : Number(next) })}
            />
          </Field>
        </Fields>
      </PanelBody>
      {steps.length === 0 ? <Empty>No steps. Warns stay warns.</Empty> : null}
      {rows.map(({ step, id }, index) => {
        const key = stepKey(step);
        const known = presetSteps.some((preset) => stepKey(preset) === key);
        const options = known ? presetSteps : [...presetSteps, step];
        return (
          <div className="mx-row" key={id}>
            <div style={{ width: 120, flexShrink: 0 }}>
              <NumberInput
                value={step.warns}
                min={1}
                max={100}
                suffix="warns"
                label={`Warns for step ${index + 1}`}
                onChange={(next) => {
                  if (Number.isInteger(next) && next >= 1 && next <= 100) {
                    update(index, { warns: next });
                  }
                }}
              />
            </div>
            <ArrowIcon />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                label={`Action for step ${index + 1}`}
                value={key}
                options={options.map((option) => ({
                  value: stepKey(option),
                  label: stepLabel(option),
                }))}
                onChange={(next) => update(index, parseStep(next))}
              />
            </div>
            {readOnly ? null : (
              <button
                type="button"
                className="mx-chip-x"
                aria-label={`Remove step ${index + 1}`}
                onClick={() => {
                  ids.current.splice(index, 1);
                  set({ escalationSteps: steps.filter((_, position) => position !== index) });
                }}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        );
      })}
      {doubled !== undefined || !(readOnly || steps.length >= 10) ? (
        <PanelBody>
          {doubled !== undefined ? (
            <Callout tone="warn">{`Two steps at ${doubled} warns. Only the last one counts.`}</Callout>
          ) : null}
          {readOnly || steps.length >= 10 ? null : (
            <div className="mx-inline">
              <AddPicker
                label="Add step"
                options={presetSteps.map((option) => ({
                  value: stepKey(option),
                  label: stepLabel(option),
                }))}
                onPick={(next) => {
                  const top = Math.max(0, ...counts);
                  set({
                    escalationSteps: [
                      ...steps,
                      { warns: Math.min(top + 2, 100), ...parseStep(next) },
                    ],
                  });
                }}
              />
            </div>
          )}
        </PanelBody>
      ) : null}
    </Panel>
  );
}

export function SettingsTab({
  commands,
  prefix,
  guildName,
  viewerName,
}: {
  commands: CommandRow[];
  prefix: string;
  guildName: string;
  viewerName: string;
}) {
  const { value, set, readOnly } = useDraft<ModerationConfig>();
  const [leftEmpty, setLeftEmpty] = useState(false);
  const timeoutList = timeoutMinutes.includes(value.defaultTimeoutMinutes)
    ? timeoutMinutes
    : [...timeoutMinutes, value.defaultTimeoutMinutes].sort((a, b) => a - b);
  const deleteList = banDeleteDays.includes(value.banDeleteMessageDays)
    ? banDeleteDays
    : [...banDeleteDays, value.banDeleteMessageDays].sort((a, b) => a - b);
  const dmVars = {
    user: viewerName,
    server: guildName,
    action: 'timed out for 1 hour',
    reason: 'Spam in #general',
    duration: '1 hour',
  };
  const templateEmpty = !value.dmTemplate.trim();

  return (
    <Grid>
      <Panel title="General" span={6} id="general">
        <PanelBody>
          <Fields>
            <Field label="Mod log">
              <ChannelSelect
                label="Mod log"
                value={value.logChannelId}
                onChange={(logChannelId) => set({ logChannelId })}
              />
            </Field>
            <Field label="Default timeout">
              <Select
                label="Default timeout"
                value={String(value.defaultTimeoutMinutes)}
                options={timeoutList.map((minutes) => ({
                  value: String(minutes),
                  label: duration(minutes * 60_000),
                }))}
                onChange={(next) => set({ defaultTimeoutMinutes: Number(next) })}
              />
            </Field>
          </Fields>
          <Field label="On ban, delete their messages from">
            <Select
              label="On ban, delete their messages from"
              value={String(value.banDeleteMessageDays)}
              options={deleteList.map((count) => ({
                value: String(count),
                label: count === 0 ? 'Keep messages' : `The last ${days(count)}`,
              }))}
              onChange={(next) => set({ banDeleteMessageDays: Number(next) })}
            />
          </Field>
          <div className="mx-field">
            <span className="mx-label">Moderator roles</span>
            <RoleMulti
              value={value.modRoleIds}
              onChange={(modRoleIds) => set({ modRoleIds: modRoleIds.slice(0, 25) })}
            />
          </div>
          <ToggleRow
            order
            title="Reason required"
            checked={value.requireReason}
            onChange={(requireReason) => set({ requireReason })}
          />
          <ToggleRow
            order
            title="DM the member"
            checked={value.dmMembers}
            onChange={(dmMembers) => set({ dmMembers })}
          />
          {value.dmMembers ? (
            <div
              className="mx-inline"
              role="group"
              aria-label="DM on these actions"
              style={{ gap: 18 }}
            >
              {dmActions.map((action) => {
                const on = value.dmActions.includes(action);
                return (
                  <Checkbox
                    key={action}
                    label={dmNames[action]}
                    checked={on}
                    onChange={() =>
                      set({
                        dmActions: on
                          ? value.dmActions.filter((entry) => entry !== action)
                          : dmActions.filter(
                              (entry) => entry === action || value.dmActions.includes(entry),
                            ),
                      })
                    }
                  />
                );
              })}
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel title="Message to the member" span={6} id="dm">
        <PanelBody>
          <div className="mx-field">
            <textarea
              className="mx-textarea"
              rows={4}
              maxLength={1_500}
              aria-label="DM template"
              aria-invalid={leftEmpty && templateEmpty ? true : undefined}
              value={value.dmTemplate}
              readOnly={readOnly}
              onBlur={() => setLeftEmpty(templateEmpty)}
              onChange={(event) => set({ dmTemplate: event.target.value })}
            />
            {leftEmpty && templateEmpty ? (
              <span className="mx-field-error">Write a message.</span>
            ) : (
              <span className="mx-hint mx-mono">
                {'{user} {server} {action} {reason} {duration}'}
              </span>
            )}
          </div>
          <div className="mx-preview">
            <MessagePreview time="DM" content={value.dmTemplate} vars={dmVars} />
          </div>
        </PanelBody>
      </Panel>

      <EscalationPanel />
      <CommandsPanel commands={commands} prefix={prefix} />
    </Grid>
  );
}
