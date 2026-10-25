'use client';

import {
  type LevelCurve,
  type LevelsConfig,
  levelFromXp,
  totalXpForLevel,
} from '@maxwell/core/modules/levels';
import { useState, useTransition } from 'react';
import { type CardLook, LevelUpCard } from '@/components/card-preview';
import {
  AddPicker,
  ChannelSelect,
  NumberInput,
  RoleSelect,
  Seg,
  Select,
  Switch,
  Tabs,
  TextInput,
  ToggleRow,
  useChannelOptions,
  useRoleOptions,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, roleColor } from '@/components/ui';
import type { Person } from '@/lib/people';
import { count, date } from '@/lib/time';
import { importLevels } from './actions';

interface Leader {
  rank: number;
  xp: number;
  person: Person;
}

type ImportMode = 'replace' | 'add' | 'max';

type ImportRow = { id: string; xp: number } | { id: string; level: number };

type Tab = 'setup' | 'message' | 'leaderboard';

const tabs = [
  { value: 'setup', label: 'XP and rewards' },
  { value: 'message', label: 'Level-up message' },
  { value: 'leaderboard', label: 'Leaderboard' },
] as const;

const curves = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'standard', label: 'Standard' },
  { value: 'linear', label: 'Linear' },
] as const;

const cooldowns = [
  { value: '0', label: 'No cooldown' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '60 seconds' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
];

const factors = ['none', '0.5', '1.5', '2', '3'];

const announceOptions = [
  { value: 'current', label: 'Same channel' },
  { value: 'channel', label: 'A set channel' },
  { value: 'dm', label: 'Direct message' },
  { value: 'off', label: 'Off' },
] as const;

const importModes = [
  { value: 'max', label: 'Keep higher' },
  { value: 'replace', label: 'Replace' },
  { value: 'add', label: 'Add' },
] as const;

const CHUNK = 20_000;

function factorLabel(value: string): string {
  return value === 'none' ? 'No XP' : `${value}x`;
}

function rowsOf(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of ['players', 'members', 'users', 'entries', 'data']) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : null;
}

function readRecord(record: Record<string, unknown>): ImportRow | null {
  const id = String(record.id ?? record.user_id ?? record.userId ?? record.userid ?? '').trim();
  if (!/^\d{15,21}$/.test(id)) return null;
  const xp = toNumber(record.xp ?? record.exp ?? record.experience);
  if (xp !== null) return { id, xp: Math.min(xp, 1_000_000_000_000) };
  const level = toNumber(record.level ?? record.lvl);
  if (level !== null) return { id, level: Math.min(level, 1000) };
  return null;
}

function parseCsv(text: string): Record<string, unknown>[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0]
    ?.split(/[,;\t]/)
    .map((cell) => cell.trim().replace(/^"|"$/g, '').toLowerCase());
  if (!header?.some((cell) => ['id', 'user_id', 'userid'].includes(cell))) return null;
  return lines.slice(1).map((line) => {
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));
  });
}

function parseImportFile(text: string): { rows: ImportRow[]; skipped: number } | null {
  let records: unknown[] | null = null;
  try {
    records = rowsOf(JSON.parse(text));
  } catch {
    records = parseCsv(text);
  }
  if (!records) return null;
  const seen = new Map<string, ImportRow>();
  let skipped = 0;
  for (const item of records) {
    const row =
      item && typeof item === 'object' ? readRecord(item as Record<string, unknown>) : null;
    if (!row) {
      skipped++;
      continue;
    }
    seen.set(row.id, row);
  }
  return { rows: [...seen.values()], skipped };
}

function XpPanel() {
  const { value, set } = useDraft<LevelsConfig>();
  const cooldownOptions = cooldowns.some((entry) => Number(entry.value) === value.cooldownSeconds)
    ? cooldowns
    : [
        ...cooldowns,
        { value: String(value.cooldownSeconds), label: `${value.cooldownSeconds} seconds` },
      ];
  return (
    <Panel
      title="XP"
      actions={
        <Seg
          label="Level curve"
          value={value.curve}
          options={curves}
          onChange={(curve) => set({ curve })}
        />
      }
    >
      <PanelBody>
        <Fields>
          <Field label="XP per message, lowest">
            <NumberInput
              value={value.xpMin}
              min={0}
              max={500}
              onChange={(xpMin) => set({ xpMin })}
            />
          </Field>
          <Field label="XP per message, highest">
            <NumberInput
              value={value.xpMax}
              min={0}
              max={500}
              onChange={(xpMax) => set({ xpMax })}
            />
          </Field>
          <Field label="Cooldown">
            <Select
              value={String(value.cooldownSeconds)}
              options={cooldownOptions}
              onChange={(next) => set({ cooldownSeconds: Number(next) })}
            />
          </Field>
        </Fields>
        <span className="mx-hint">
          Level 10 needs {count(totalXpForLevel(10, value.curve))} XP, level 50 needs{' '}
          {count(totalXpForLevel(50, value.curve))} XP
        </span>
      </PanelBody>
    </Panel>
  );
}

interface MultiplierRow {
  kind: 'channel' | 'role';
  id: string;
  factor: string;
}

function multiplierRows(config: LevelsConfig): MultiplierRow[] {
  return [
    ...config.channelMultipliers.map((entry) => ({
      kind: 'channel' as const,
      id: entry.channelId,
      factor: String(entry.multiplier),
    })),
    ...config.excludedChannels.map((id) => ({ kind: 'channel' as const, id, factor: 'none' })),
    ...config.roleMultipliers.map((entry) => ({
      kind: 'role' as const,
      id: entry.roleId,
      factor: String(entry.multiplier),
    })),
    ...config.excludedRoles.map((id) => ({ kind: 'role' as const, id, factor: 'none' })),
  ];
}

function withFactor(
  config: LevelsConfig,
  kind: 'channel' | 'role',
  id: string,
  factor: string | null,
): Partial<LevelsConfig> {
  const multiplier = factor === null || factor === 'none' ? null : Number(factor);
  if (kind === 'channel') {
    const known = config.channelMultipliers.some((entry) => entry.channelId === id);
    const channelMultipliers =
      multiplier === null
        ? config.channelMultipliers.filter((entry) => entry.channelId !== id)
        : known
          ? config.channelMultipliers.map((entry) =>
              entry.channelId === id ? { ...entry, multiplier } : entry,
            )
          : [...config.channelMultipliers, { channelId: id, multiplier }];
    const rest = config.excludedChannels.filter((entry) => entry !== id);
    return {
      channelMultipliers,
      excludedChannels: factor === 'none' ? [...rest, id] : rest,
    };
  }
  const known = config.roleMultipliers.some((entry) => entry.roleId === id);
  const roleMultipliers =
    multiplier === null
      ? config.roleMultipliers.filter((entry) => entry.roleId !== id)
      : known
        ? config.roleMultipliers.map((entry) =>
            entry.roleId === id ? { ...entry, multiplier } : entry,
          )
        : [...config.roleMultipliers, { roleId: id, multiplier }];
  const rest = config.excludedRoles.filter((entry) => entry !== id);
  return { roleMultipliers, excludedRoles: factor === 'none' ? [...rest, id] : rest };
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mx-btn mx-btn-ghost" aria-label={label} onClick={onClick}>
      Remove
    </button>
  );
}

function MultipliersPanel() {
  const { value, set, readOnly } = useDraft<LevelsConfig>();
  const { channels, roles } = useGuild();
  const rows = multiplierRows(value);
  const taken = new Set(rows.map((row) => `${row.kind}:${row.id}`));
  const channelOptions = useChannelOptions().filter(
    (option) => !taken.has(`channel:${option.value}`),
  );
  const roleOptions = useRoleOptions().filter((option) => !taken.has(`role:${option.value}`));

  const nameOf = (row: MultiplierRow) => {
    if (row.kind === 'channel') {
      const channel = channels.find((entry) => entry.id === row.id);
      return { label: channel ? `#${channel.name}` : 'Deleted channel', color: '#9A9EA6' };
    }
    const role = roles.find((entry) => entry.id === row.id);
    return { label: role?.name ?? 'Deleted role', color: roleColor(role?.color ?? 0) };
  };

  return (
    <Panel
      title="Multipliers"
      span={6}
      actions={
        readOnly ? null : (
          <>
            {channelOptions.length > 0 ? (
              <AddPicker
                label="Add channel"
                options={channelOptions}
                onPick={(id) => set(withFactor(value, 'channel', id, '2'))}
              />
            ) : null}
            {roleOptions.length > 0 ? (
              <AddPicker
                label="Add role"
                options={roleOptions}
                onPick={(id) => set(withFactor(value, 'role', id, '2'))}
              />
            ) : null}
          </>
        )
      }
    >
      {rows.length === 0 ? <Empty>Every channel and role earns normal XP.</Empty> : null}
      {rows.map((row) => {
        const name = nameOf(row);
        const options = (factors.includes(row.factor) ? factors : [...factors, row.factor]).map(
          (entry) => ({ value: entry, label: factorLabel(entry) }),
        );
        return (
          <div className="mx-row" key={`${row.kind}:${row.id}`}>
            {row.kind === 'role' ? (
              <span className="mx-dot" style={{ background: name.color }} />
            ) : null}
            <div className="mx-row-main">
              <span className="mx-row-title mx-ellipsis">{name.label}</span>
              <span className="mx-sub">{row.kind === 'channel' ? 'Channel' : 'Role'}</span>
            </div>
            <div style={{ width: 120, flexShrink: 0 }}>
              <Select
                value={row.factor}
                label={`Multiplier for ${name.label}`}
                options={options}
                onChange={(next) => set(withFactor(value, row.kind, row.id, next))}
              />
            </div>
            {readOnly ? null : (
              <RemoveButton
                label={`Remove multiplier for ${name.label}`}
                onClick={() => set(withFactor(value, row.kind, row.id, null))}
              />
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function RewardsPanel({
  counts,
  ranked,
}: {
  counts: Record<LevelCurve, Record<number, number>>;
  ranked: number;
}) {
  const { value, set, readOnly } = useDraft<LevelsConfig>();
  const { roles } = useGuild();
  const [level, setLevel] = useState(10);
  const [roleId, setRoleId] = useState<string | null>(null);
  const histogram = counts[value.curve] ?? {};
  const reached = (at: number) =>
    Object.entries(histogram).reduce(
      (sum, [entry, count]) => (Number(entry) >= at ? sum + count : sum),
      0,
    );
  const rewards = [...value.rewards].sort((a, b) => a.level - b.level);

  return (
    <Panel title="Rewards" span={6}>
      {rewards.length === 0 && readOnly ? <Empty>No reward roles yet.</Empty> : null}
      {rewards.map((reward) => {
        const role = roles.find((entry) => entry.id === reward.roleId);
        const name = role?.name ?? 'Deleted role';
        const members = reached(reward.level);
        const share = ranked > 0 ? Math.round((members / ranked) * 100) : 0;
        return (
          <div className="mx-row" key={`${reward.level}:${reward.roleId}`}>
            <span className="mx-row-title" style={{ width: 64, flexShrink: 0 }}>
              Level {reward.level}
            </span>
            <div className="mx-row-main">
              <span className="mx-ellipsis" style={{ display: 'inline-flex', gap: 6 }}>
                <span
                  className="mx-dot"
                  style={{ background: roleColor(role?.color ?? 0), alignSelf: 'center' }}
                />
                {name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="mx-bar" style={{ flex: 1, maxWidth: 160 }}>
                  <span style={{ width: `${share}%` }} />
                </div>
                <span className="mx-sub">
                  {members === 1 ? '1 member' : `${count(members)} members`}
                </span>
              </div>
            </div>
            {readOnly ? null : (
              <RemoveButton
                label={`Remove reward ${name}`}
                onClick={() =>
                  set({
                    rewards: value.rewards.filter(
                      (entry) => !(entry.level === reward.level && entry.roleId === reward.roleId),
                    ),
                  })
                }
              />
            )}
          </div>
        );
      })}
      {readOnly ? null : (
        <div className="mx-row">
          <div style={{ width: 96, flexShrink: 0 }}>
            <NumberInput value={level} min={1} max={1000} label="Level" onChange={setLevel} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RoleSelect
              value={roleId}
              none={null}
              placeholder="Reward role"
              label="Reward role"
              onChange={setRoleId}
            />
          </div>
          <button
            type="button"
            className="mx-btn"
            disabled={!roleId || level < 1}
            onClick={() => {
              if (!roleId) return;
              set({
                rewards: [
                  ...value.rewards.filter(
                    (entry) => !(entry.level === level && entry.roleId === roleId),
                  ),
                  { level, roleId },
                ],
              });
              setRoleId(null);
            }}
          >
            Add
          </button>
        </div>
      )}
      <div className="mx-row">
        <div className="mx-row-main">
          <span className="mx-row-title">Keep earlier rewards</span>
        </div>
        <Switch
          label="Keep earlier rewards"
          checked={!value.removePreviousRewards}
          onChange={(keep) => set({ removePreviousRewards: !keep })}
        />
      </div>
    </Panel>
  );
}

function MessagePanel() {
  const { value, set } = useDraft<LevelsConfig>();
  return (
    <Panel title="Level-up message" span={value.announce === 'off' ? 12 : 7}>
      <PanelBody>
        <Fields>
          <Field label="Where">
            <Select
              value={value.announce}
              options={announceOptions}
              onChange={(announce) => set({ announce })}
            />
          </Field>
          {value.announce === 'channel' ? (
            <Field label="Channel">
              <ChannelSelect
                value={value.announceChannelId}
                none={null}
                onChange={(announceChannelId) => set({ announceChannelId })}
              />
            </Field>
          ) : null}
        </Fields>
        {value.announce === 'off' ? null : (
          <>
            <ToggleRow
              title="Level-up card"
              checked={value.card}
              onChange={(card) => set({ card })}
            />
            <Field label="Message" aside={`${value.message.length} / 1000`}>
              <TextInput
                value={value.message}
                maxLength={1000}
                onChange={(message) => set({ message })}
              />
            </Field>
            <Field label="Message with a reward" aside={`${value.rewardMessage.length} / 1000`}>
              <TextInput
                value={value.rewardMessage}
                maxLength={1000}
                onChange={(rewardMessage) => set({ rewardMessage })}
              />
            </Field>
            <span className="mx-hint">
              <span className="mx-mono">{'{user}'}</span> pings,{' '}
              <span className="mx-mono">{'{name}'}</span> does not. Also{' '}
              <span className="mx-mono">{'{level}'}</span>,{' '}
              <span className="mx-mono">{'{role}'}</span> and{' '}
              <span className="mx-mono">{'{server}'}</span>
            </span>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

const previewKinds = [
  { value: 'level', label: 'Level up' },
  { value: 'reward', label: 'Reward' },
] as const;

function PreviewPanel({
  sample,
  look,
}: {
  sample: { name: string; avatarUrl: string | null };
  look: CardLook;
}) {
  const { value } = useDraft<LevelsConfig>();
  const { roles, channels, guildName } = useGuild();
  const [withReward, setWithReward] = useState(false);
  const announceChannel = channels.find((entry) => entry.id === value.announceChannelId);
  const channelName = !value.announceChannelId
    ? 'No channel'
    : announceChannel
      ? `#${announceChannel.name}`
      : 'Deleted channel';
  const reward = [...value.rewards].sort((a, b) => a.level - b.level)[0];
  const rewardRole = reward ? roles.find((role) => role.id === reward.roleId) : undefined;
  const showReward = withReward && reward !== undefined;
  const level = showReward ? reward.level : 5;
  const text = showReward ? value.rewardMessage : value.message;
  const vars = {
    user: `@${sample.name}`,
    name: sample.name,
    level: String(level),
    role: rewardRole?.name ?? 'Deleted role',
    server: guildName,
  };
  const where =
    value.announce === 'channel'
      ? channelName
      : (announceOptions.find((entry) => entry.value === value.announce)?.label ?? '');

  if (value.announce === 'off') return null;

  return (
    <Panel
      title="Preview"
      span={5}
      actions={
        <>
          {reward ? (
            <Seg
              label="Preview message"
              value={withReward ? 'reward' : 'level'}
              options={previewKinds}
              onChange={(next) => setWithReward(next === 'reward')}
              view
            />
          ) : null}
          <span className="mx-sub">{where}</span>
        </>
      }
    >
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview content={text} vars={vars}>
            {value.card ? (
              <div style={{ maxWidth: 420 }}>
                <LevelUpCard
                  look={look}
                  name={sample.name}
                  avatarUrl={sample.avatarUrl}
                  level={level}
                  reward={
                    showReward
                      ? {
                          name: rewardRole?.name ?? 'Deleted role',
                          color: rewardRole?.color ? roleColor(rewardRole.color) : '#F4F4F2',
                        }
                      : null
                  }
                />
              </div>
            ) : null}
          </MessagePreview>
        </div>
      </PanelBody>
    </Panel>
  );
}

function LeaderboardPanel({ leaders, prefix }: { leaders: Leader[]; prefix: string }) {
  const { value } = useDraft<LevelsConfig>();
  return (
    <Panel
      title="Leaderboard"
      span={7}
      actions={<span className="mx-sub mx-mono">{`${prefix}levels`}</span>}
    >
      {leaders.length === 0 ? <Empty mood="sleeping">Nobody has XP yet.</Empty> : null}
      {leaders.map((leader) => (
        <div className="mx-row" key={leader.person.id}>
          <span className="mx-mono mx-muted" style={{ width: 22 }}>
            {leader.rank}
          </span>
          <Avatar src={leader.person.avatar} name={leader.person.name} size={26} />
          <div className="mx-row-main">
            <span className="mx-row-title">{leader.person.name}</span>
            <span className="mx-sub">{count(leader.xp)} XP</span>
          </div>
          <span className="mx-stat-value" style={{ fontSize: 17 }}>
            {levelFromXp(leader.xp, value.curve).level}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function ImportPanel({ lastImport }: { lastImport: { rows: number; at: string } | null }) {
  const { guildId } = useGuild();
  const { readOnly } = useDraft<LevelsConfig>();
  const [mode, setMode] = useState<ImportMode>('max');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      if (!file) return;
      if (file.size > 25_000_000) {
        setStatus({ text: 'Use a file under 25 MB.', error: true });
        return;
      }
      const parsed = parseImportFile(await file.text());
      if (!parsed) {
        setStatus({ text: 'I cannot read that file.', error: true });
        return;
      }
      if (parsed.rows.length === 0) {
        setStatus({ text: 'No members with XP or a level in that file.', error: true });
        return;
      }
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const result = await importLevels(guildId, parsed.rows.slice(i, i + CHUNK), mode);
        if (!result.ok) {
          setStatus({ text: result.error, error: true });
          return;
        }
      }
      setFile(null);
      setStatus({
        text:
          parsed.skipped > 0
            ? `Importing ${count(parsed.rows.length)} members, ${count(parsed.skipped)} rows skipped.`
            : `Importing ${count(parsed.rows.length)} members.`,
        error: false,
      });
    });

  return (
    <Panel title="Import levels" span={5}>
      <PanelBody>
        {readOnly ? null : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label
                className="mx-btn"
                style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start' }}
              >
                <span className="mx-ellipsis">{file ? file.name : 'Choose a file'}</span>
                <input
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  className="mx-sr"
                  disabled={pending}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setStatus(null);
                    event.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                className="mx-btn mx-btn-primary"
                disabled={!file || pending}
                onClick={run}
              >
                Import
              </button>
            </div>
            <span className="mx-hint">MEE6 JSON, or a CSV with id and xp or level columns</span>
            <div className="mx-field">
              <span className="mx-label">When a member already has XP</span>
              <Seg
                label="When a member already has XP"
                value={mode}
                options={importModes}
                onChange={setMode}
              />
            </div>
          </>
        )}
        {status ? (
          <div
            className={status.error ? 'mx-callout mx-callout-warn' : 'mx-callout mx-callout-info'}
          >
            <span role="status">{status.text}</span>
          </div>
        ) : null}
        <span className="mx-sub">
          {lastImport
            ? `Last import: ${count(lastImport.rows)} members on ${date(lastImport.at, 'UTC')}`
            : 'Nothing imported yet'}
        </span>
      </PanelBody>
    </Panel>
  );
}

export function LevelsForm({
  leaders,
  ranked,
  counts,
  lastImport,
  prefix,
  sample,
  look,
}: {
  leaders: Leader[];
  ranked: number;
  counts: Record<string, Record<number, number>>;
  lastImport: { rows: number; at: string } | null;
  prefix: string;
  sample: { name: string; avatarUrl: string | null };
  look: CardLook;
}) {
  const [tab, setTab] = useState<Tab>('setup');
  return (
    <>
      <Tabs label="Levels" value={tab} options={tabs} onChange={setTab} />
      {tab === 'setup' ? (
        <Grid>
          <XpPanel />
          <MultipliersPanel />
          <RewardsPanel
            counts={counts as Record<LevelCurve, Record<number, number>>}
            ranked={ranked}
          />
        </Grid>
      ) : null}
      {tab === 'message' ? (
        <Grid>
          <MessagePanel />
          <PreviewPanel sample={sample} look={look} />
        </Grid>
      ) : null}
      {tab === 'leaderboard' ? (
        <Grid>
          <LeaderboardPanel leaders={leaders} prefix={prefix} />
          <ImportPanel lastImport={lastImport} />
        </Grid>
      ) : null}
    </>
  );
}
