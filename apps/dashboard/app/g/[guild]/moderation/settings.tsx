'use client';

import {
  dmActions,
  type EscalationStep,
  type ModerationConfig,
  type ReasonTemplate,
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
  TextInput,
  ToggleRow,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import {
  Callout,
  CloseIcon,
  Column,
  Empty,
  Field,
  Fields,
  Grid,
  Panel,
  PanelBody,
} from '@/components/ui';
import type { Key, Translator } from '@/lib/i18n';
import { duration } from '@/lib/time';
import { setCommand } from './actions';
import { withChoice } from './reason-picks';

export interface CommandRow {
  name: string;
  description: string;
  on: boolean;
}

const timeoutMinutes = [5, 10, 30, 60, 360, 1_440, 10_080, 40_320];
const banDeleteDays = [0, 1, 2, 3, 7];
const expiryOptions = [30, 90, 180, 365];
const windowOptions = [7, 14, 30, 60, 90];

const dmNames: Record<(typeof dmActions)[number], Key> = {
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

function stepLabel(t: Translator, step: Omit<EscalationStep, 'warns'>): string {
  const length = step.durationMinutes !== null ? duration(t, step.durationMinutes * 60_000) : null;
  const base =
    step.action === 'timeout'
      ? t('Timeout {length}', { length: length ?? t('default length') })
      : step.action === 'kick'
        ? t('Kick')
        : length
          ? t('Ban {length}', { length })
          : t('Ban');
  return step.review ? t('{action}, held for review', { action: base }) : base;
}

function parseStep(key: string): Omit<EscalationStep, 'warns'> {
  const [action, minutes, review] = key.split(':');
  return {
    action: action === 'kick' || action === 'ban' ? action : 'timeout',
    durationMinutes: minutes ? Number(minutes) : null,
    review: review === '1',
  };
}

function days(t: Translator, value: number): string {
  return t.plural(value, '{n} day', '{n} days');
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
  const t = useT();
  const { guildId } = useGuild();
  const [state, setState] = useState(() =>
    Object.fromEntries(commands.map((command) => [command.name, command.on])),
  );
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  return (
    <Panel title={t('Commands')} span={5} actions={<StatusText status={status} />}>
      {commands.length === 0 ? (
        <Empty mood="sleeping">{t('Maxwell lists them once it is online.')}</Empty>
      ) : (
        commands.map((command) => {
          const on = state[command.name] ?? true;
          const name = `${prefix}${command.name}`;
          return (
            <div key={command.name} className="mx-row">
              <div className="mx-row-main">
                <span className="mx-row-title mx-mono">{name}</span>
                <span className="mx-sub">{command.description}</span>
              </div>
              <Switch
                order
                checked={on}
                disabled={pending}
                label={on ? t('{name} on', { name }) : t('{name} off', { name })}
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
  const t = useT();
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
      title={t('Escalation')}
      span={7}
      id="escalation"
      actions={
        <Switch
          order
          checked={value.escalationEnabled}
          label={t('Escalation')}
          onChange={(escalationEnabled) => set({ escalationEnabled })}
        />
      }
    >
      <PanelBody>
        <Fields>
          <Field label={t('Count warns from the last')}>
            <Select
              label={t('Count warns from the last')}
              value={String(value.escalationWindowDays)}
              options={windowList.map((option) => ({
                value: String(option),
                label: days(t, option),
              }))}
              onChange={(next) => set({ escalationWindowDays: Number(next) })}
            />
          </Field>
          <Field label={t('Warns expire after')}>
            <Select
              label={t('Warns expire after')}
              value={expiry === null ? 'never' : String(expiry)}
              options={[
                ...expiryList.map((option) => ({ value: String(option), label: days(t, option) })),
                { value: 'never', label: t('Never') },
              ]}
              onChange={(next) => set({ warnExpiryDays: next === 'never' ? null : Number(next) })}
            />
          </Field>
        </Fields>
      </PanelBody>
      {steps.length === 0 ? <Empty>{t('No steps. Warns stay warns.')}</Empty> : null}
      {rows.map(({ step, id }, index) => {
        const key = stepKey(step);
        const known = presetSteps.some((preset) => stepKey(preset) === key);
        const options = known ? presetSteps : [...presetSteps, step];
        const number = String(index + 1);
        return (
          <div className="mx-row" key={id}>
            <div style={{ width: 120, flexShrink: 0 }}>
              <NumberInput
                value={step.warns}
                min={1}
                max={100}
                suffix={t('warns')}
                label={t('Warns for step {number}', { number })}
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
                label={t('Action for step {number}', { number })}
                value={key}
                options={options.map((option) => ({
                  value: stepKey(option),
                  label: stepLabel(t, option),
                }))}
                onChange={(next) => update(index, parseStep(next))}
              />
            </div>
            {readOnly ? null : (
              <button
                type="button"
                className="mx-chip-x"
                aria-label={t('Remove step {number}', { number })}
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
            <Callout tone="warn">
              {t('Two steps at {count} warns. Only the last one counts.', { count: doubled })}
            </Callout>
          ) : null}
          {readOnly || steps.length >= 10 ? null : (
            <div className="mx-inline">
              <AddPicker
                label={t('Add step')}
                options={presetSteps.map((option) => ({
                  value: stepKey(option),
                  label: stepLabel(t, option),
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

function templateKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[_-]+/, '')
    .slice(0, 24);
}

function freeKey(templates: readonly ReasonTemplate[]): string {
  const taken = new Set(templates.map((template) => template.key));
  let n = templates.length + 1;
  while (taken.has(`reason${n}`)) n += 1;
  return `reason${n}`;
}

function TemplatesPanel({ prefix }: { prefix: string }) {
  const t = useT();
  const { value, set, readOnly } = useDraft<ModerationConfig>();
  const templates = value.reasonTemplates;
  const ids = useRef<number[]>([]);
  const nextId = useRef(0);
  while (ids.current.length < templates.length) ids.current.push(nextId.current++);
  if (ids.current.length > templates.length) ids.current.length = templates.length;
  const keys = templates.map((template) => template.key);
  const doubled = keys.find((key, index) => keys.indexOf(key) !== index);
  const update = (index: number, patch: Partial<ReasonTemplate>) =>
    set({
      reasonTemplates: templates.map((template, position) =>
        position === index ? { ...template, ...patch } : template,
      ),
    });

  return (
    <Panel title={t('Reason templates')} span={6} id="templates">
      {templates.length === 0 ? <Empty>{t('No templates yet.')}</Empty> : null}
      {templates.map((template, index) => {
        const number = String(index + 1);
        const lengths = withChoice(timeoutMinutes, template.timeoutMinutes);
        return (
          <div
            className="mx-row"
            key={ids.current[index] ?? index}
            style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}
          >
            <div style={{ width: 120, flexShrink: 0 }}>
              <TextInput
                mono
                value={template.key}
                maxLength={24}
                label={t('Key for template {number}', { number })}
                onChange={(next) => update(index, { key: templateKey(next) })}
              />
              {template.key ? null : <span className="mx-field-error">{t('Add a key.')}</span>}
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <TextInput
                value={template.text}
                maxLength={500}
                label={t('Reason for template {number}', { number })}
                onChange={(next) => update(index, { text: next })}
              />
              {template.text.trim() ? null : (
                <span className="mx-field-error">{t('Write a reason.')}</span>
              )}
            </div>
            {readOnly ? null : (
              <button
                type="button"
                className="mx-chip-x"
                aria-label={t('Remove template {number}', { number })}
                onClick={() => {
                  ids.current.splice(index, 1);
                  set({
                    reasonTemplates: templates.filter((_, position) => position !== index),
                  });
                }}
              >
                <CloseIcon />
              </button>
            )}
            <div className="mx-inline" style={{ flexBasis: '100%', gap: 18 }}>
              <Select
                label={t('Timeout for template {number}', { number })}
                value={template.timeoutMinutes === null ? '' : String(template.timeoutMinutes)}
                style={{ width: 200 }}
                options={[
                  { value: '', label: t('Default timeout') },
                  ...lengths.map((minutes) => ({
                    value: String(minutes),
                    label: t('Timeout {length}', { length: duration(t, minutes * 60_000) }),
                  })),
                ]}
                onChange={(next) => update(index, { timeoutMinutes: next ? Number(next) : null })}
              />
              <Checkbox
                label={t('Delete messages on ban')}
                checked={template.deleteMessages}
                onChange={(deleteMessages) => update(index, { deleteMessages })}
              />
            </div>
          </div>
        );
      })}
      <PanelBody>
        {doubled !== undefined ? (
          <Callout tone="warn">{t('Two templates use {key}.', { key: doubled })}</Callout>
        ) : null}
        <div className="mx-inline" style={{ justifyContent: 'space-between' }}>
          <span className="mx-hint mx-mono">{`${prefix}ban @member ${keys[0] ?? 'spam'}`}</span>
          {readOnly || templates.length >= 25 ? null : (
            <button
              type="button"
              className="mx-btn"
              onClick={() =>
                set({
                  reasonTemplates: [
                    ...templates,
                    {
                      key: freeKey(templates),
                      text: t('New reason'),
                      timeoutMinutes: null,
                      deleteMessages: false,
                    },
                  ],
                })
              }
            >
              {t('Add template')}
            </button>
          )}
        </div>
      </PanelBody>
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
  const t = useT();
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
    action: t('timed out for 1 hour'),
    reason: t('Spam in #general'),
    duration: t('1 hour'),
  };
  const templateEmpty = !value.dmTemplate.trim();

  return (
    <Grid>
      <Column span={6}>
        <Panel title={t('General')} span={6} id="general">
          <PanelBody>
            <Fields>
              <Field label={t('Mod log')}>
                <ChannelSelect
                  label={t('Mod log')}
                  value={value.logChannelId}
                  onChange={(logChannelId) => set({ logChannelId })}
                />
              </Field>
              <Field label={t('Default timeout')}>
                <Select
                  label={t('Default timeout')}
                  value={String(value.defaultTimeoutMinutes)}
                  options={timeoutList.map((minutes) => ({
                    value: String(minutes),
                    label: duration(t, minutes * 60_000),
                  }))}
                  onChange={(next) => set({ defaultTimeoutMinutes: Number(next) })}
                />
              </Field>
            </Fields>
            <Field label={t('On ban, delete their messages from')}>
              <Select
                label={t('On ban, delete their messages from')}
                value={String(value.banDeleteMessageDays)}
                options={deleteList.map((count) => ({
                  value: String(count),
                  label:
                    count === 0
                      ? t('Keep messages')
                      : t.plural(count, 'The last {n} day', 'The last {n} days'),
                }))}
                onChange={(next) => set({ banDeleteMessageDays: Number(next) })}
              />
            </Field>
            <div className="mx-field">
              <span className="mx-label">{t('Moderator roles')}</span>
              <RoleMulti
                bots
                value={value.modRoleIds}
                onChange={(modRoleIds) => set({ modRoleIds: modRoleIds.slice(0, 25) })}
              />
            </div>
            <ToggleRow
              order
              title={t('Reason required')}
              checked={value.requireReason}
              onChange={(requireReason) => set({ requireReason })}
            />
            <ToggleRow
              order
              title={t('DM the member')}
              checked={value.dmMembers}
              onChange={(dmMembers) => set({ dmMembers })}
            />
            {value.dmMembers ? (
              <div
                className="mx-inline"
                role="group"
                aria-label={t('DM on these actions')}
                style={{ gap: 18 }}
              >
                {dmActions.map((action) => {
                  const on = value.dmActions.includes(action);
                  return (
                    <Checkbox
                      key={action}
                      label={t(dmNames[action])}
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
        <EscalationPanel />
      </Column>
      <Column span={6}>
        <Panel title={t('Message to the member')} span={6} id="dm">
          <PanelBody>
            <div className="mx-field">
              <textarea
                className="mx-textarea"
                rows={4}
                maxLength={1_500}
                aria-label={t('DM template')}
                aria-invalid={leftEmpty && templateEmpty ? true : undefined}
                value={value.dmTemplate}
                readOnly={readOnly}
                onBlur={() => setLeftEmpty(templateEmpty)}
                onChange={(event) => set({ dmTemplate: event.target.value })}
              />
              {leftEmpty && templateEmpty ? (
                <span className="mx-field-error">{t('Write a message.')}</span>
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
        <TemplatesPanel prefix={prefix} />
        <CommandsPanel commands={commands} prefix={prefix} />
      </Column>
    </Grid>
  );
}
