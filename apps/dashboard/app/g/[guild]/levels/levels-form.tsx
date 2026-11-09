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
import { useT } from '@/components/i18n';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, roleColor } from '@/components/ui';
import type { Key, Translator } from '@/lib/i18n';
import type { Person } from '@/lib/people';
import { date } from '@/lib/time';
import { importFromPluuty, importLevels } from './actions';

interface Leader {
  rank: number;
  xp: number;
  person: Person;
}

type ImportMode = 'replace' | 'add' | 'max';

type ImportRow = { id: string; xp: number } | { id: string; level: number };

type Tab = 'setup' | 'message' | 'leaderboard';

type Announce = LevelsConfig['announce'];

const tabs: { value: Tab; label: Key }[] = [
  { value: 'setup', label: 'XP and rewards' },
  { value: 'message', label: 'Level-up message' },
  { value: 'leaderboard', label: 'Leaderboard' },
];

const curves: { value: LevelCurve; label: Key }[] = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'standard', label: 'Standard' },
  { value: 'linear', label: 'Linear' },
];

const cooldowns = [0, 30, 60, 120, 300];

const factors = ['none', '0.5', '1.5', '2', '3'];

const announceOptions: { value: Announce; label: Key }[] = [
  { value: 'current', label: 'Same channel' },
  { value: 'channel', label: 'A set channel' },
  { value: 'dm', label: 'Direct message' },
  { value: 'off', label: 'Off' },
];

const importModes: { value: ImportMode; label: Key }[] = [
  { value: 'max', label: 'Keep higher' },
  { value: 'replace', label: 'Replace' },
  { value: 'add', label: 'Add' },
];

const keepOptions: { value: 'level' | 'xp'; label: Key }[] = [
  { value: 'level', label: 'Levels' },
  { value: 'xp', label: 'XP' },
];

const CHUNK = 20_000;

function cooldownLabel(t: Translator, seconds: number): string {
  if (seconds === 0) return t('No cooldown');
  if (seconds > 60 && seconds % 60 === 0) {
    return t.plural(seconds / 60, '{n} minute', '{n} minutes');
  }
  return t.plural(seconds, '{n} second', '{n} seconds');
}

function factorLabel(t: Translator, value: string): string {
  return value === 'none'
    ? t('No XP')
    : `${Number(value).toLocaleString(t.locale, { maximumFractionDigits: 2 })}x`;
}

const SNOWFLAKE = /^\d{15,21}$/;
const ID_KEYS = ['id', 'user_id', 'userid', 'userId', 'member_id', 'memberId', 'memberid', 'user'];
const XP_KEYS = ['xp', 'exp', 'experience', 'totalXp', 'total_xp', 'totalxp', 'totalExp'];
const LEVEL_KEYS = ['level', 'lvl'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function idOf(record: Record<string, unknown>): string {
  for (const key of ID_KEYS) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (isRecord(value) && (typeof value.id === 'string' || typeof value.id === 'number')) {
      return String(value.id).trim();
    }
  }
  return '';
}

function keyedRows(record: Record<string, unknown>, parent: string): unknown[] | null {
  const entries = Object.entries(record);
  if (entries.length === 0 || !entries.every(([key]) => SNOWFLAKE.test(key))) return null;
  const numbersAreXp = /xp|exp|level/i.test(parent);
  return entries.map(([id, value]) =>
    isRecord(value) ? { ...value, id } : numbersAreXp ? { id, xp: value } : { id },
  );
}

function candidates(input: unknown, depth = 0, out: unknown[][] = [], parent = ''): unknown[][] {
  if (depth > 4) return out;
  if (Array.isArray(input)) {
    out.push(input);
    for (const item of input.slice(0, 5)) {
      if (Array.isArray(item) || (isRecord(item) && !idOf(item))) {
        candidates(item, depth + 1, out, parent);
      }
    }
    return out;
  }
  if (!isRecord(input)) return out;
  const keyed = keyedRows(input, parent);
  if (keyed) {
    out.push(keyed);
    return out;
  }
  for (const [key, value] of Object.entries(input)) candidates(value, depth + 1, out, key);
  return out;
}

function bestList(lists: unknown[][], guildId: string | null): unknown[] | null {
  let best: unknown[] | null = null;
  let bestCount = 0;
  for (const list of lists) {
    const count = list.filter((item) => isRecord(item) && readRecord(item, guildId)).length;
    if (count > bestCount) {
      best = list;
      bestCount = count;
    }
  }
  return best;
}

function rowsOf(input: unknown, guildId: string): unknown[] | null {
  const lists = candidates(input);
  return bestList(lists, guildId) ?? bestList(lists, null) ?? (Array.isArray(input) ? input : null);
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : null;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function guildOf(record: Record<string, unknown>): string | null {
  const value = record.guildId ?? record.guild_id ?? record.guildid ?? record.guild;
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : null;
}

function readRecord(record: Record<string, unknown>, guildId: string | null): ImportRow | null {
  const id = idOf(record);
  if (!SNOWFLAKE.test(id)) return null;
  const guild = guildOf(record);
  if (guildId !== null && guild !== null && guild !== guildId) return null;
  const xp = firstNumber(record, XP_KEYS);
  if (xp !== null) return { id, xp: Math.min(xp, 1_000_000_000_000) };
  const level = firstNumber(record, LEVEL_KEYS);
  if (level !== null) return { id, level: Math.min(level, 1000) };
  return null;
}

function parseCsv(text: string): Record<string, unknown>[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0]?.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const ids = ID_KEYS.map((key) => key.toLowerCase());
  if (!header?.some((cell) => ids.includes(cell.toLowerCase()))) return null;
  return lines.slice(1).map((line) => {
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));
  });
}

interface ParsedImport {
  rows: ImportRow[];
  skipped: number;
  otherGuilds: number;
  personal: boolean;
}

function isPersonalExport(input: unknown): boolean {
  return isRecord(input) && isRecord(input.data) && isRecord(input.data.account);
}

function parseImportFile(file: string, guildId: string): ParsedImport | null {
  const text = file.charCodeAt(0) === 0xfeff ? file.slice(1) : file;
  let records: unknown[] | null = null;
  let personal = false;
  try {
    const json: unknown = JSON.parse(text);
    personal = isPersonalExport(json);
    records = rowsOf(json, guildId);
  } catch {
    records = parseCsv(text);
  }
  if (!records) return null;
  const seen = new Map<string, ImportRow>();
  let skipped = 0;
  let otherGuilds = 0;
  for (const item of records) {
    const row = isRecord(item) ? readRecord(item, guildId) : null;
    if (!row) {
      if (isRecord(item) && guildOf(item) !== null && guildOf(item) !== guildId) otherGuilds++;
      else skipped++;
      continue;
    }
    seen.set(row.id, row);
  }
  return { rows: [...seen.values()], skipped, otherGuilds, personal };
}

function XpPanel() {
  const t = useT();
  const { value, set } = useDraft<LevelsConfig>();
  const cooldownOptions = (
    cooldowns.includes(value.cooldownSeconds) ? cooldowns : [...cooldowns, value.cooldownSeconds]
  ).map((seconds) => ({ value: String(seconds), label: cooldownLabel(t, seconds) }));
  return (
    <Panel
      title="XP"
      actions={
        <Seg
          label={t('Level curve')}
          value={value.curve}
          options={curves.map((option) => ({ ...option, label: t(option.label) }))}
          onChange={(curve) => set({ curve })}
        />
      }
    >
      <PanelBody>
        <Fields>
          <Field label={t('XP per message, lowest')}>
            <NumberInput
              value={value.xpMin}
              min={0}
              max={500}
              onChange={(xpMin) => set({ xpMin })}
            />
          </Field>
          <Field label={t('XP per message, highest')}>
            <NumberInput
              value={value.xpMax}
              min={0}
              max={500}
              onChange={(xpMax) => set({ xpMax })}
            />
          </Field>
          <Field label={t('Cooldown')}>
            <Select
              value={String(value.cooldownSeconds)}
              options={cooldownOptions}
              onChange={(next) => set({ cooldownSeconds: Number(next) })}
            />
          </Field>
        </Fields>
        <span className="mx-hint">
          {t('Level 10 needs {low} XP, level 50 needs {high} XP', {
            low: totalXpForLevel(10, value.curve),
            high: totalXpForLevel(50, value.curve),
          })}
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
  const t = useT();
  return (
    <button type="button" className="mx-btn mx-btn-ghost" aria-label={label} onClick={onClick}>
      {t('Remove')}
    </button>
  );
}

function MultipliersPanel() {
  const t = useT();
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
      return { label: channel ? `#${channel.name}` : t('Deleted channel'), color: '#9A9EA6' };
    }
    const role = roles.find((entry) => entry.id === row.id);
    return { label: role?.name ?? t('Deleted role'), color: roleColor(role?.color ?? 0) };
  };

  return (
    <Panel
      title={t('Multipliers')}
      span={6}
      actions={
        readOnly ? null : (
          <>
            {channelOptions.length > 0 ? (
              <AddPicker
                label={t('Add channel')}
                options={channelOptions}
                onPick={(id) => set(withFactor(value, 'channel', id, '2'))}
              />
            ) : null}
            {roleOptions.length > 0 ? (
              <AddPicker
                label={t('Add role')}
                options={roleOptions}
                onPick={(id) => set(withFactor(value, 'role', id, '2'))}
              />
            ) : null}
          </>
        )
      }
    >
      {rows.length === 0 ? <Empty>{t('Every channel and role earns normal XP.')}</Empty> : null}
      {rows.map((row) => {
        const name = nameOf(row);
        const options = (factors.includes(row.factor) ? factors : [...factors, row.factor]).map(
          (entry) => ({ value: entry, label: factorLabel(t, entry) }),
        );
        return (
          <div className="mx-row" key={`${row.kind}:${row.id}`}>
            {row.kind === 'role' ? (
              <span className="mx-dot" style={{ background: name.color }} />
            ) : null}
            <div className="mx-row-main">
              <span className="mx-row-title mx-ellipsis">{name.label}</span>
              <span className="mx-sub">{row.kind === 'channel' ? t('Channel') : t('Role')}</span>
            </div>
            <div style={{ width: 120, flexShrink: 0 }}>
              <Select
                value={row.factor}
                label={t('Multiplier for {name}', { name: name.label })}
                options={options}
                onChange={(next) => set(withFactor(value, row.kind, row.id, next))}
              />
            </div>
            {readOnly ? null : (
              <RemoveButton
                label={t('Remove multiplier for {name}', { name: name.label })}
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
  const t = useT();
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
    <Panel title={t('Rewards')} span={6}>
      {rewards.length === 0 && readOnly ? <Empty>{t('No reward roles yet.')}</Empty> : null}
      {rewards.map((reward) => {
        const role = roles.find((entry) => entry.id === reward.roleId);
        const name = role?.name ?? t('Deleted role');
        const members = reached(reward.level);
        const share = ranked > 0 ? Math.round((members / ranked) * 100) : 0;
        return (
          <div className="mx-row" key={`${reward.level}:${reward.roleId}`}>
            <span className="mx-row-title" style={{ width: 64, flexShrink: 0 }}>
              {t('Level {level}', { level: reward.level })}
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
                <span className="mx-sub">{t.plural(members, '{n} member', '{n} members')}</span>
              </div>
            </div>
            {readOnly ? null : (
              <RemoveButton
                label={t('Remove reward {name}', { name })}
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
            <NumberInput value={level} min={1} max={1000} label={t('Level')} onChange={setLevel} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RoleSelect
              value={roleId}
              none={null}
              placeholder={t('Reward role')}
              label={t('Reward role')}
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
            {t('Add')}
          </button>
        </div>
      )}
      <div className="mx-row">
        <div className="mx-row-main">
          <span className="mx-row-title">{t('Keep earlier rewards')}</span>
        </div>
        <Switch
          label={t('Keep earlier rewards')}
          checked={!value.removePreviousRewards}
          onChange={(keep) => set({ removePreviousRewards: !keep })}
        />
      </div>
    </Panel>
  );
}

function MessagePanel() {
  const t = useT();
  const { value, set } = useDraft<LevelsConfig>();
  return (
    <Panel title={t('Level-up message')} span={value.announce === 'off' ? 12 : 7}>
      <PanelBody>
        <Fields>
          <Field label={t('Where')}>
            <Select
              value={value.announce}
              options={announceOptions.map((option) => ({ ...option, label: t(option.label) }))}
              onChange={(announce) => set({ announce })}
            />
          </Field>
          {value.announce === 'channel' ? (
            <Field label={t('Channel')}>
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
              title={t('Level-up card')}
              checked={value.card}
              onChange={(card) => set({ card })}
            />
            <Field label={t('Message')} aside={`${value.message.length} / 1000`}>
              <TextInput
                value={value.message}
                maxLength={1000}
                onChange={(message) => set({ message })}
              />
            </Field>
            <Field
              label={t('Message with a reward')}
              aside={`${value.rewardMessage.length} / 1000`}
            >
              <TextInput
                value={value.rewardMessage}
                maxLength={1000}
                onChange={(rewardMessage) => set({ rewardMessage })}
              />
            </Field>
            <span className="mx-hint">
              <span className="mx-mono">{'{user}'}</span> {t('pings,')}{' '}
              <span className="mx-mono">{'{name}'}</span> {t('does not. Also')}{' '}
              <span className="mx-mono">{'{level}'}</span>,{' '}
              <span className="mx-mono">{'{role}'}</span> {t('and')}{' '}
              <span className="mx-mono">{'{server}'}</span>
            </span>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

const previewKinds: { value: 'level' | 'reward'; label: Key }[] = [
  { value: 'level', label: 'Level up' },
  { value: 'reward', label: 'Reward' },
];

function PreviewPanel({
  sample,
  look,
}: {
  sample: { name: string; avatarUrl: string | null };
  look: CardLook;
}) {
  const t = useT();
  const { value } = useDraft<LevelsConfig>();
  const { roles, channels, guildName } = useGuild();
  const [withReward, setWithReward] = useState(false);
  const announceChannel = channels.find((entry) => entry.id === value.announceChannelId);
  const channelName = !value.announceChannelId
    ? t('No channel')
    : announceChannel
      ? `#${announceChannel.name}`
      : t('Deleted channel');
  const reward = [...value.rewards].sort((a, b) => a.level - b.level)[0];
  const rewardRole = reward ? roles.find((role) => role.id === reward.roleId) : undefined;
  const showReward = withReward && reward !== undefined;
  const level = showReward ? reward.level : 5;
  const text = showReward ? value.rewardMessage : value.message;
  const vars = {
    user: `@${sample.name}`,
    name: sample.name,
    level: String(level),
    role: rewardRole?.name ?? t('Deleted role'),
    server: guildName,
  };
  const announce = announceOptions.find((entry) => entry.value === value.announce);
  const where = value.announce === 'channel' ? channelName : announce ? t(announce.label) : '';

  if (value.announce === 'off') return null;

  return (
    <Panel
      title={t('Preview')}
      span={5}
      actions={
        <>
          {reward ? (
            <Seg
              label={t('Preview message')}
              value={withReward ? 'reward' : 'level'}
              options={previewKinds.map((option) => ({ ...option, label: t(option.label) }))}
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
                          name: rewardRole?.name ?? t('Deleted role'),
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
  const t = useT();
  const { value } = useDraft<LevelsConfig>();
  return (
    <Panel
      title={t('Leaderboard')}
      span={7}
      actions={<span className="mx-sub mx-mono">{`${prefix}levels`}</span>}
    >
      {leaders.length === 0 ? <Empty mood="sleeping">{t('Nobody has XP yet.')}</Empty> : null}
      {leaders.map((leader) => (
        <div className="mx-row" key={leader.person.id}>
          <span className="mx-mono mx-muted" style={{ width: 22 }}>
            {leader.rank}
          </span>
          <Avatar src={leader.person.avatar} name={leader.person.name} size={26} />
          <div className="mx-row-main">
            <span className="mx-row-title">{leader.person.name}</span>
            <span className="mx-sub">{t.count(leader.xp)} XP</span>
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
  const t = useT();
  const { guildId } = useGuild();
  const { readOnly } = useDraft<LevelsConfig>();
  const [mode, setMode] = useState<ImportMode>('max');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();

  const [keep, setKeep] = useState<'level' | 'xp'>('level');

  const fromPluuty = () =>
    start(async () => {
      setStatus(null);
      const result = await importFromPluuty(guildId, mode, keep);
      setStatus(
        result.ok
          ? {
              text: t('Importing {count} members.', { count: result.data?.count ?? 0 }),
              error: false,
            }
          : { text: t.raw(result.error), error: true },
      );
    });

  const run = () =>
    start(async () => {
      if (!file) return;
      if (file.size > 25_000_000) {
        setStatus({ text: t('Use a file under 25 MB.'), error: true });
        return;
      }
      const parsed = parseImportFile(await file.text(), guildId);
      if (!parsed) {
        setStatus({ text: t('I cannot read that file.'), error: true });
        return;
      }
      if (parsed.personal) {
        setStatus({
          text: t(
            'That is a personal data export. It only holds the XP of whoever downloaded it. Use a leaderboard export of the whole community.',
          ),
          error: true,
        });
        return;
      }
      if (parsed.rows.length === 0) {
        setStatus({
          text:
            parsed.otherGuilds > 0
              ? t('That file only has levels from other communities.')
              : t('No members with XP or a level in that file.'),
          error: true,
        });
        return;
      }
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const result = await importLevels(guildId, parsed.rows.slice(i, i + CHUNK), mode);
        if (!result.ok) {
          setStatus({ text: t.raw(result.error), error: true });
          return;
        }
      }
      setFile(null);
      setStatus({
        text:
          parsed.skipped > 0
            ? t('Importing {count} members, {skipped} rows skipped.', {
                count: parsed.rows.length,
                skipped: parsed.skipped,
              })
            : t('Importing {count} members.', { count: parsed.rows.length }),
        error: false,
      });
    });

  return (
    <Panel title={t('Import levels')} span={5}>
      <PanelBody>
        {readOnly ? null : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label
                className="mx-btn"
                style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start' }}
              >
                <span className="mx-ellipsis">{file ? file.name : t('Choose a file')}</span>
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
                {t('Import')}
              </button>
            </div>
            <span className="mx-hint">{t('JSON or CSV with id and xp or level columns')}</span>
            <div className="mx-field">
              <span className="mx-label">{t('From Pluuty')}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Seg
                  label={t('Import as')}
                  value={keep}
                  options={keepOptions.map((option) => ({ ...option, label: t(option.label) }))}
                  onChange={setKeep}
                />
                <button type="button" className="mx-btn" disabled={pending} onClick={fromPluuty}>
                  {t('Import from Pluuty')}
                </button>
              </div>
              <span className="mx-hint">
                {keep === 'level'
                  ? t(
                      'Reads the public Pluuty leaderboard of this community. Members keep their level.',
                    )
                  : t(
                      'Reads the public Pluuty leaderboard of this community. Levels follow the curve here.',
                    )}
              </span>
            </div>
            <div className="mx-field">
              <span className="mx-label">{t('When a member already has XP')}</span>
              <Seg
                label={t('When a member already has XP')}
                value={mode}
                options={importModes.map((option) => ({ ...option, label: t(option.label) }))}
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
            ? t('Last import: {count} members on {date}', {
                count: lastImport.rows,
                date: date(t, lastImport.at, 'UTC'),
              })
            : t('Nothing imported yet')}
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
  const t = useT();
  const [tab, setTab] = useState<Tab>('setup');
  return (
    <>
      <Tabs
        label={t('Levels')}
        value={tab}
        options={tabs.map((option) => ({ ...option, label: t(option.label) }))}
        onChange={setTab}
      />
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
