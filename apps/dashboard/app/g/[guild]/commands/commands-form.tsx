'use client';

import {
  COMMAND_LIMIT,
  type CommandsConfig,
  type CustomCommand,
  type KeywordMode,
  PATTERN_MAX,
  type PatternProblem,
  type TriggerType,
  validatePattern,
} from '@maxwell/core/modules/commands';
import type { CommandTestResult } from '@maxwell/core/stores/commands';
import { type CSSProperties, type ReactNode, useState, useTransition } from 'react';
import {
  ChannelMulti,
  NumberInput,
  RoleMulti,
  Seg,
  Select,
  Switch,
  ToggleRow,
} from '@/components/controls';
import { ChannelType, useChannelName, useGuild, useRoleName } from '@/components/guild';
import { useT } from '@/components/i18n';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { ModuleShell, useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { CloseIcon, Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import { runAction } from '@/lib/actions';
import type { Key } from '@/lib/i18n';
import type { ShellProps } from '@/lib/module';
import { forgetDeleted, testResult } from './actions';

const kinds: { value: TriggerType; label: Key }[] = [
  { value: 'command', label: 'Command' },
  { value: 'keyword', label: 'Keyword' },
  { value: 'regex', label: 'Regex' },
];

const kindNames: Record<TriggerType, Key> = {
  command: 'Command',
  keyword: 'Keyword',
  regex: 'Regex',
};

const patternLabels: Record<TriggerType, Key> = {
  command: 'Command name',
  keyword: 'Words',
  regex: 'Pattern',
};

const modes: { value: KeywordMode; label: Key }[] = [
  { value: 'word', label: 'As whole words' },
  { value: 'contains', label: 'Anywhere in the message' },
  { value: 'startsWith', label: 'At the start' },
  { value: 'exact', label: 'The whole message' },
];

const scopes: { value: 'user' | 'channel' | 'guild'; label: Key }[] = [
  { value: 'user', label: 'Per member' },
  { value: 'channel', label: 'Per channel' },
  { value: 'guild', label: 'Whole server' },
];

const targets: { value: CustomCommand['roleTarget']; label: Key }[] = [
  { value: 'author', label: 'Whoever uses it' },
  { value: 'mention', label: 'The mentioned member' },
];

const variables = [
  '{user}',
  '{user.mention}',
  '{target.mention}',
  '{server}',
  '{channel}',
  '{args}',
  '{args.1}',
  '{match}',
  '{random:a|b|c}',
];

const problemText: Record<Exclude<PatternProblem, 'too_long'>, Key> = {
  empty: 'Needs a trigger.',
  invalid: 'That pattern is not valid.',
  unsafe: 'That pattern could take too long. Remove the nested repeats.',
  name: 'Command names have no spaces and none of < > @ # `',
};

const testProblems: Record<NonNullable<CommandTestResult['problem']>, Key> = {
  no_match: 'No match',
  invalid_pattern: 'Pattern is not valid',
  timeout: 'Pattern took too long',
  missing: 'Command not found',
  empty: 'Needs a trigger',
  builtin: 'Maxwell already uses this name',
};

const tokenButton: CSSProperties = {
  border: 0,
  color: 'var(--mx-text-2)',
  cursor: 'pointer',
  padding: '4px 8px',
};

const sectionHead: CSSProperties = { borderTop: '1px solid var(--mx-line)', paddingTop: 14 };

function newId(taken: readonly string[]): string {
  for (;;) {
    const id = `cmd-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.includes(id)) return id;
  }
}

function display(command: CustomCommand, prefix: string): string {
  const pattern = command.pattern.trim();
  if (command.trigger === 'command') return `${prefix}${pattern || 'name'}`;
  if (command.trigger === 'regex') return `/${pattern}/`;
  return `"${pattern}"`;
}

function sampleText(command: CustomCommand, prefix: string): string {
  if (command.trigger === 'command') return `${prefix}${command.pattern.trim()}`;
  if (command.trigger === 'keyword') return command.pattern.trim();
  return '';
}

function hex(color: number | null): string {
  return `#${(color ?? 0x3a9eea).toString(16).padStart(6, '0')}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="mx-panel-head" style={sectionHead}>
        <h3>{title}</h3>
      </div>
      <PanelBody>{children}</PanelBody>
    </>
  );
}

function CommandList({
  commands,
  selected,
  usage,
  prefix,
  onSelect,
  onAdd,
  onToggle,
}: {
  commands: CustomCommand[];
  selected: string | null;
  usage: Record<string, number>;
  prefix: string;
  onSelect: (command: CustomCommand) => void;
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  return (
    <Panel
      title={t('Commands')}
      id="commands-list"
      actions={
        readOnly || commands.length >= COMMAND_LIMIT ? null : (
          <button type="button" className="mx-btn" onClick={onAdd}>
            {t('New')}
          </button>
        )
      }
    >
      {commands.map((command) => {
        const uses = usage[command.id] ?? 0;
        const name = display(command, prefix);
        const picked = command.id === selected;
        return (
          <div key={command.id} className="mx-row">
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={picked}
              onClick={() => onSelect(command)}
            >
              <span className="mx-mono mx-ellipsis" style={{ fontWeight: 500 }}>
                {name}
              </span>
              <span className="mx-sub">
                {`${t(kindNames[command.trigger])}, ${t('{n, plural, one {used # time} other {used # times}}', { n: uses })}`}
              </span>
            </button>
            <Switch
              order
              checked={command.enabled}
              label={command.enabled ? t('{name} on', { name }) : t('{name} off', { name })}
              onChange={(enabled) => onToggle(command.id, enabled)}
            />
          </div>
        );
      })}
    </Panel>
  );
}

function freshKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function Replies({
  responses,
  onChange,
}: {
  responses: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  const list = responses.length > 0 ? responses : [''];
  const [focus, setFocus] = useState(list.length - 1);
  const [keys, setKeys] = useState<string[]>(() => list.map(freshKey));
  const ids = list.map((_, index) => keys[index] ?? `extra-${index}`);
  const insert = (token: string) => {
    const index = Math.min(focus, list.length - 1);
    onChange(
      list.map((text, i) =>
        i === index
          ? `${text}${text && !text.endsWith(' ') ? ' ' : ''}${token}`.slice(0, 2000)
          : text,
      ),
    );
  };
  return (
    <div className="mx-field" style={{ gap: 8 }}>
      {list.map((text, index) => (
        <div key={ids[index]} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            className="mx-textarea"
            style={{ flex: 1, minWidth: 0 }}
            rows={2}
            maxLength={2000}
            value={text}
            readOnly={readOnly}
            aria-label={t('Reply {number}', { number: index + 1 })}
            onFocus={() => setFocus(index)}
            onChange={(event) =>
              onChange(list.map((entry, i) => (i === index ? event.target.value : entry)))
            }
          />
          {readOnly || list.length === 1 ? null : (
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              aria-label={t('Remove reply {number}', { number: index + 1 })}
              onClick={() => {
                setKeys(ids.filter((_, i) => i !== index));
                setFocus(0);
                onChange(list.filter((_, i) => i !== index));
              }}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      ))}
      {list.length > 1 ? <span className="mx-hint">{t('One is picked at random.')}</span> : null}
      {readOnly ? null : (
        <div className="mx-between">
          <div className="mx-inline" style={{ gap: 6 }}>
            {variables.map((token) => (
              <button
                key={token}
                type="button"
                className="mx-kbd"
                aria-label={t('Insert {token}', { token })}
                style={tokenButton}
                onClick={() => insert(token)}
              >
                {token}
              </button>
            ))}
          </div>
          {list.length < 20 ? (
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              onClick={() => {
                setKeys([...ids, freshKey()]);
                setFocus(list.length);
                onChange([...list, '']);
              }}
            >
              {t('Add reply')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TryIt({
  command,
  prefix,
  me,
}: {
  command: CustomCommand;
  prefix: string;
  me: { id: string; name: string };
}) {
  const { guildId, channels } = useGuild();
  const t = useT();
  const channelName = useChannelName();
  const roleName = useRoleName();
  const readOnly = useReadOnly();
  const poll = usePoll();
  const [text, setText] = useState(sampleText(command, prefix));
  const [result, setResult] = useState<CommandTestResult | null>(null);
  const [tested, setTested] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const [waiting, setWaiting] = useState(false);
  const channelId =
    command.allowedChannels[0] ??
    channels.find(
      (entry) => entry.type === ChannelType.Text || entry.type === ChannelType.Announcement,
    )?.id ??
    null;

  const run = () =>
    start(async () => {
      const requestId = crypto.randomUUID();
      setStatus(null);
      setResult(null);
      const queued = await runAction(guildId, 'commands', 'test', {
        requestId,
        command,
        content: text,
        userId: me.id,
        channelId,
      });
      if (!queued.ok) {
        setStatus({ message: queued.error, error: true });
        return;
      }
      setWaiting(true);
      setTested(text);
      poll(
        async () => {
          const found = await testResult(guildId, requestId);
          if (!found.ok) {
            setWaiting(false);
            setStatus({ message: found.error, error: true });
            return true;
          }
          if (!found.data) return false;
          setWaiting(false);
          setResult(found.data);
          return true;
        },
        () => {
          setWaiting(false);
          setStatus({ message: t('Maxwell did not answer. Try again in a moment.'), error: true });
        },
      );
    });

  const label = waiting
    ? t('Testing')
    : result
      ? result.matched
        ? t('Matches')
        : t(testProblems[result.problem ?? 'no_match'] ?? 'No match')
      : null;
  const extras = [
    result?.addRoles.length
      ? t('gives {roles}', { roles: result.addRoles.map((id) => `@${roleName(id)}`).join(', ') })
      : '',
    result?.removeRoles.length
      ? t('removes {roles}', {
          roles: result.removeRoles.map((id) => `@${roleName(id)}`).join(', '),
        })
      : '',
    command.deleteTrigger ? t('deletes the message') : '',
  ].filter(Boolean);

  return (
    <Panel
      title={t('Try it')}
      id="commands-try"
      actions={
        label ? <span className={result?.matched ? 'mx-sub mx-up' : 'mx-sub'}>{label}</span> : null
      }
    >
      <PanelBody>
        <div className="mx-field">
          <label className="mx-label" htmlFor={`try-${command.id}`}>
            {channelId
              ? t('As {name} in {channel}', { name: me.name, channel: channelName(channelId) })
              : t('As {name}', { name: me.name })}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id={`try-${command.id}`}
              className="mx-input"
              style={{ flex: 1, minWidth: 0 }}
              value={text}
              maxLength={2000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !readOnly && text.trim()) {
                  event.preventDefault();
                  run();
                }
              }}
            />
            <button
              type="button"
              className="mx-btn"
              disabled={readOnly || pending || waiting || !text.trim()}
              onClick={run}
            >
              {t('Try')}
            </button>
          </div>
        </div>
        <StatusText status={status} />
        {result?.matched ? (
          <div className="mx-preview">
            <MessagePreview name={me.name} bot={false} avatarSize={28} content={tested} />
            <MessagePreview avatarSize={28} content={result.embed ? null : result.content}>
              {result.content && result.embed ? (
                <EmbedPreview color={hex(command.color)} description={result.content} />
              ) : null}
              {result.content ? null : <span className="mx-sub">{t('No reply')}</span>}
              {extras.length > 0 ? (
                <span className="mx-sub">{t('Then {what}', { what: t.list(extras) })}</span>
              ) : null}
            </MessagePreview>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function Editor({
  command,
  commands,
  prefix,
  builtins,
  onChange,
  onDelete,
}: {
  command: CustomCommand;
  commands: CustomCommand[];
  prefix: string;
  builtins: string[];
  onChange: (patch: Partial<CustomCommand>) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  const pattern = command.pattern.trim();
  const problem = validatePattern(command.trigger, command.pattern);
  const lower = pattern.toLowerCase();
  const clash =
    command.trigger === 'command' && !problem
      ? builtins.includes(lower)
        ? t('{command} is already a Maxwell command.', { command: `${prefix}${pattern}` })
        : commands.some(
              (other) =>
                other.id !== command.id &&
                other.trigger === 'command' &&
                other.pattern.trim().toLowerCase() === lower,
            )
          ? t('Another custom command has this name.')
          : null
      : null;
  const warning =
    problem && problem !== 'empty'
      ? problem === 'too_long'
        ? t('At most {count} characters.', { count: PATTERN_MAX })
        : t(problemText[problem])
      : clash;
  const cooldown = command.cooldown;

  return (
    <Panel
      title={<span className="mx-mono">{display(command, prefix)}</span>}
      id="commands-edit"
      actions={
        readOnly ? null : (
          <button type="button" className="mx-btn mx-btn-danger" onClick={onDelete}>
            {t('Delete')}
          </button>
        )
      }
    >
      <PanelBody>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
          <div className="mx-field">
            <span className="mx-label">{t('Trigger')}</span>
            <Seg
              label={t('Trigger')}
              value={command.trigger}
              options={kinds.map((kind) => ({ ...kind, label: t(kind.label) }))}
              onChange={(trigger) => onChange({ trigger })}
            />
          </div>
          <div className="mx-field" style={{ flex: '1 1 220px' }}>
            <label className="mx-label" htmlFor={`pattern-${command.id}`}>
              {t(patternLabels[command.trigger])}
            </label>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {command.trigger === 'command' ? (
                <span className="mx-mono mx-muted">{prefix}</span>
              ) : null}
              <input
                id={`pattern-${command.id}`}
                className="mx-input mx-mono"
                style={{ flex: 1, minWidth: 0 }}
                value={command.pattern}
                maxLength={PATTERN_MAX}
                readOnly={readOnly}
                aria-invalid={warning ? true : undefined}
                onChange={(event) => onChange({ pattern: event.target.value })}
              />
            </span>
            {warning ? <span className="mx-field-error">{warning}</span> : null}
          </div>
        </div>
        {command.trigger === 'keyword' ? (
          <Fields>
            <Field label={t('Match')}>
              <Select
                value={command.mode}
                options={modes.map((mode) => ({ ...mode, label: t(mode.label) }))}
                onChange={(mode) => onChange({ mode })}
              />
            </Field>
          </Fields>
        ) : null}
        {command.trigger === 'command' ? null : (
          <ToggleRow
            order
            title={t('Case sensitive')}
            checked={command.caseSensitive}
            onChange={(caseSensitive) => onChange({ caseSensitive })}
          />
        )}
      </PanelBody>

      <Section title={t('Reply')}>
        <Replies
          key={command.id}
          responses={command.responses}
          onChange={(responses) => onChange({ responses })}
        />
        <Fields>
          <ToggleRow
            order
            title={t('Reply to the message')}
            checked={command.reply}
            onChange={(reply) => onChange({ reply })}
          />
          <ToggleRow
            order
            title={t('Delete the trigger message')}
            checked={command.deleteTrigger}
            onChange={(deleteTrigger) => onChange({ deleteTrigger })}
          />
          <div className="mx-toggle-row">
            <div className="mx-row-main">
              <span className="mx-row-title">{t('Send as embed')}</span>
            </div>
            {command.embed ? (
              <input
                type="color"
                aria-label={t('Embed color')}
                value={hex(command.color)}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({ color: Number.parseInt(event.target.value.slice(1), 16) })
                }
              />
            ) : null}
            <Switch
              order
              label={t('Send as embed')}
              checked={command.embed}
              onChange={(embed) => onChange({ embed })}
            />
          </div>
        </Fields>
      </Section>

      <Section title={t('Roles')}>
        <Fields>
          <div className="mx-field">
            <span className="mx-label">{t('Applies to')}</span>
            <Seg
              label={t('Applies to')}
              value={command.roleTarget}
              options={targets.map((target) => ({ ...target, label: t(target.label) }))}
              onChange={(roleTarget) => onChange({ roleTarget })}
            />
            {command.roleTarget === 'mention' ? (
              <span className="mx-hint">
                {command.allowedRoles.length === 0
                  ? t(
                      '{prefix}{name} @member. Without roles under Who can use it, only members who can manage roles can use it.',
                      { prefix, name: command.pattern || 'verify' },
                    )
                  : t('{prefix}{name} @member', { prefix, name: command.pattern || 'verify' })}
              </span>
            ) : null}
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Give')}</span>
            <RoleMulti
              value={command.addRoles}
              onChange={(addRoles) => onChange({ addRoles: addRoles.slice(0, 10) })}
            />
            {readOnly && command.addRoles.length === 0 ? (
              <span className="mx-sub">{t('None')}</span>
            ) : null}
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Take')}</span>
            <RoleMulti
              value={command.removeRoles}
              onChange={(removeRoles) => onChange({ removeRoles: removeRoles.slice(0, 10) })}
            />
            {readOnly && command.removeRoles.length === 0 ? (
              <span className="mx-sub">{t('None')}</span>
            ) : null}
          </div>
        </Fields>
      </Section>

      <Section title={t('Limits')}>
        <Fields>
          <div className="mx-field">
            <span className="mx-label">{t('Who can use it')}</span>
            <RoleMulti
              bots
              value={command.allowedRoles}
              onChange={(allowedRoles) => onChange({ allowedRoles })}
            />
            {command.allowedRoles.length === 0 ? (
              <span className="mx-hint">{t('Everyone')}</span>
            ) : null}
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Where')}</span>
            <ChannelMulti
              value={command.allowedChannels}
              onChange={(allowedChannels) => onChange({ allowedChannels })}
            />
            {command.allowedChannels.length === 0 ? (
              <span className="mx-hint">{t('Every channel')}</span>
            ) : null}
          </div>
          <Field label={t('Cooldown')}>
            <NumberInput
              value={cooldown}
              min={0}
              max={86_400}
              suffix={t('seconds')}
              onChange={(next) =>
                onChange({ cooldown: Math.min(86_400, Math.max(0, Math.round(next))) })
              }
            />
          </Field>
          {cooldown > 0 ? (
            <Field label={t('Counted')}>
              <Select
                value={command.cooldownScope}
                options={scopes.map((scope) => ({ ...scope, label: t(scope.label) }))}
                onChange={(cooldownScope) => onChange({ cooldownScope })}
              />
            </Field>
          ) : null}
        </Fields>
      </Section>
    </Panel>
  );
}

export function CommandsShell({
  shell,
  usage,
  children,
}: {
  shell: ShellProps;
  usage: Record<string, number>;
  children: ReactNode;
}) {
  const { guildId } = useGuild();
  return (
    <ModuleShell
      {...shell}
      onSaved={(saved) => {
        const kept = new Set((saved as CommandsConfig).commands.map((command) => command.id));
        if (Object.keys(usage).some((id) => !kept.has(id))) void forgetDeleted(guildId);
      }}
    >
      {children}
    </ModuleShell>
  );
}

export function CommandsForm({
  prefix,
  me,
  usage,
  builtins,
}: {
  prefix: string;
  me: { id: string; name: string };
  usage: Record<string, number>;
  builtins: string[];
}) {
  const t = useT();
  const { value, update, readOnly } = useDraft<CommandsConfig>();
  const [selected, setSelected] = useState<string | null>(value.commands[0]?.id ?? null);
  const current =
    value.commands.find((command) => command.id === selected) ?? value.commands[0] ?? null;

  const patch = (id: string, change: Partial<CustomCommand>) =>
    update((previous) => ({
      ...previous,
      commands: previous.commands.map((command) =>
        command.id === id ? { ...command, ...change } : command,
      ),
    }));

  const add = () => {
    const taken = value.commands.map((command) => command.id);
    const names = value.commands.map((command) => command.pattern.trim().toLowerCase());
    let name = 'hello';
    for (let n = 2; names.includes(name) || builtins.includes(name); n++) name = `hello${n}`;
    const command: CustomCommand = {
      id: newId(taken),
      trigger: 'command',
      pattern: name,
      mode: 'word',
      caseSensitive: false,
      responses: [t('Hello {user}.')],
      embed: false,
      color: null,
      reply: true,
      deleteTrigger: false,
      addRoles: [],
      removeRoles: [],
      roleTarget: 'author',
      cooldown: 0,
      cooldownScope: 'user',
      allowedRoles: [],
      allowedChannels: [],
      enabled: true,
    };
    update((previous) => ({ ...previous, commands: [...previous.commands, command] }));
    setSelected(command.id);
  };

  const remove = () => {
    if (!current) return;
    const rest = value.commands.filter((command) => command.id !== current.id);
    update((previous) => ({
      ...previous,
      commands: previous.commands.filter((command) => command.id !== current.id),
    }));
    setSelected(rest[0]?.id ?? null);
  };

  if (!current) {
    return (
      <Grid>
        <Panel id="commands-empty">
          <Empty
            mood="sleeping"
            action={
              readOnly ? null : (
                <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                  {t('New command')}
                </button>
              )
            }
          >
            {t('No custom commands yet.')}
          </Empty>
        </Panel>
      </Grid>
    );
  }

  return (
    <Grid>
      <div className="mx-s4 mx-stack" style={{ gap: 16 }}>
        <CommandList
          commands={value.commands}
          selected={current.id}
          usage={usage}
          prefix={prefix}
          onSelect={(command) => setSelected(command.id)}
          onAdd={add}
          onToggle={(id, enabled) => patch(id, { enabled })}
        />
        <TryIt key={current.id} command={current} prefix={prefix} me={me} />
      </div>
      <div className="mx-s8">
        <Editor
          command={current}
          commands={value.commands}
          prefix={prefix}
          builtins={builtins}
          onChange={(change) => patch(current.id, change)}
          onDelete={remove}
        />
      </div>
    </Grid>
  );
}
