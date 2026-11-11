'use client';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { ChannelType, useGuild } from './guild';
import { useT } from './i18n';
import { Listbox, type ListOption } from './listbox';
import { useReadOnly } from './module-shell';
import { CloseIcon, roleColor } from './ui';

export function rangeFill(value: number, min: number, max: number, color?: string): CSSProperties {
  const share = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return {
    '--value': `${Math.min(100, Math.max(0, share))}%`,
    ...(color ? { '--fill': color } : {}),
  } as CSSProperties;
}

export function Switch({
  checked,
  onChange,
  label,
  order = false,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  order?: boolean;
  disabled?: boolean;
}) {
  const readOnly = useReadOnly();
  return (
    <button
      type="button"
      className={order ? 'mx-switch mx-order' : 'mx-switch'}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || readOnly}
      onClick={() => onChange(!checked)}
    />
  );
}

export function ToggleRow({
  title,
  sub,
  checked,
  onChange,
  order,
}: {
  title: string;
  sub?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  order?: boolean;
}) {
  return (
    <div className="mx-toggle-row">
      <div className="mx-row-main">
        <span className="mx-row-title">{title}</span>
        {sub ? <span className="mx-sub">{sub}</span> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} order={order} />
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  view = false,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
  view?: boolean;
  disabled?: boolean;
}) {
  const readOnly = useReadOnly();
  return (
    <div className="mx-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled || (readOnly && !view)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
  view = true,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
  view?: boolean;
}) {
  const readOnly = useReadOnly();
  return (
    <div className="mx-tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="mx-tab"
          aria-selected={option.value === value}
          disabled={readOnly && !view}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  mono,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  mono?: boolean;
  label?: string;
}) {
  const readOnly = useReadOnly();
  return (
    <input
      className={mono ? 'mx-input mx-mono' : 'mx-input'}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label={label}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label?: string;
  style?: CSSProperties;
}) {
  const t = useT();
  return (
    <div className="mx-search" style={style}>
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        className="mx-input"
        type="text"
        role="searchbox"
        value={value}
        placeholder={placeholder ?? t('Search')}
        aria-label={label ?? t('Search')}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) onChange('');
        }}
      />
      {value ? (
        <button
          type="button"
          className="mx-chip-x"
          aria-label={t('Clear search')}
          onClick={() => onChange('')}
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  maxLength,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  label?: string;
}) {
  const readOnly = useReadOnly();
  return (
    <textarea
      className="mx-textarea"
      rows={rows}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  suffix?: string;
}) {
  const readOnly = useReadOnly();
  const shown = Number.isFinite(value) ? String(value) : '';
  const [draft, setDraft] = useState(shown);
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    if (Number(draft) !== value || draft === '') setDraft(shown);
  }
  const input = (
    <input
      className="mx-input"
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      readOnly={readOnly}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = Number(event.target.value);
        if (event.target.value === '' || Number.isNaN(next)) return;
        onChange(next);
      }}
      onBlur={() => {
        if (draft === '' || Number.isNaN(Number(draft))) setDraft(shown);
      }}
    />
  );
  if (!suffix) return input;
  return (
    <div className="mx-suffixed">
      {input}
      <span className="mx-suffix">{suffix}</span>
    </div>
  );
}

export function OptionalNumber({
  value,
  onChange,
  label,
  placeholder,
  min,
  max,
  integer,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  label: string;
  placeholder?: string;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const readOnly = useReadOnly();
  const floor = min ?? (integer ? 0 : undefined);
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === '' ? null : Number(current);
      return parsed === value ? current : value === null ? '' : String(value);
    });
  }, [value]);
  return (
    <input
      className="mx-input"
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={text}
      min={floor}
      max={max}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === '') {
          onChange(null);
          return;
        }
        const parsed = integer ? Math.trunc(Number(next)) : Number(next);
        if (!Number.isFinite(parsed)) return;
        onChange(floor === undefined ? parsed : Math.max(floor, parsed));
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder,
  searchable,
  disabled,
  style,
}: {
  value: T;
  options: readonly { value: T; label: string; hint?: string; color?: string; group?: string }[];
  onChange: (next: T) => void;
  label?: string;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const readOnly = useReadOnly();
  return (
    <Listbox
      value={value}
      options={options}
      onChange={(next) => onChange(next as T)}
      label={label}
      placeholder={placeholder}
      searchable={searchable}
      disabled={disabled || readOnly}
      style={style}
    />
  );
}

const TEXT_KINDS: number[] = [ChannelType.Text, ChannelType.Announcement];

export function useChannelOptions(kinds: number[] = TEXT_KINDS): ListOption[] {
  const { channels } = useGuild();
  const categories = new Map(
    channels
      .filter((channel) => channel.type === ChannelType.Category)
      .map((channel) => [channel.id, channel]),
  );
  const rank = (parentId: string | null) =>
    parentId ? (categories.get(parentId)?.position ?? 0) + 1 : 0;
  return channels
    .filter((channel) => kinds.includes(channel.type))
    .sort((a, b) => rank(a.parentId) - rank(b.parentId))
    .map((channel) => ({
      value: channel.id,
      label: channel.type === ChannelType.Category ? channel.name : `#${channel.name}`,
      group:
        channel.type !== ChannelType.Category && channel.parentId
          ? categories.get(channel.parentId)?.name
          : undefined,
    }));
}

export function useRoleOptions({ bots = false }: { bots?: boolean } = {}): ListOption[] {
  const { roles, guildId } = useGuild();
  return roles
    .filter((role) => role.id !== guildId && (bots || !role.managed))
    .map((role) => ({ value: role.id, label: role.name, color: roleColor(role.color) }));
}

export function ChannelSelect({
  value,
  onChange,
  kinds = TEXT_KINDS,
  none,
  label,
  placeholder,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  kinds?: number[];
  none?: string | null;
  label?: string;
  placeholder?: string;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  const options = useChannelOptions(kinds);
  const empty = none === undefined ? t('No channel') : none;
  const missing = value !== null && value !== '' && !options.some((o) => o.value === value);
  const all: ListOption[] = [
    ...(empty !== null ? [{ value: '', label: empty, muted: true }] : []),
    ...(missing ? [{ value, label: t('Deleted channel'), muted: true }] : []),
    ...options,
  ];
  return (
    <Listbox
      value={value ?? ''}
      options={all}
      onChange={(next) => onChange(next || null)}
      label={label}
      placeholder={placeholder ?? t('Pick a channel')}
      disabled={readOnly}
    />
  );
}

export function RoleSelect({
  value,
  onChange,
  none,
  label,
  placeholder,
  bots,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  none?: string | null;
  label?: string;
  placeholder?: string;
  bots?: boolean;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  const { roles } = useGuild();
  const options = useRoleOptions({ bots });
  const empty = none === undefined ? t('No role') : none;
  const missing = value !== null && value !== '' && !options.some((o) => o.value === value);
  const saved = missing ? roles.find((role) => role.id === value) : undefined;
  const all: ListOption[] = [
    ...(empty !== null ? [{ value: '', label: empty, muted: true }] : []),
    ...(missing
      ? [
          saved
            ? { value, label: saved.name, color: roleColor(saved.color), muted: true }
            : { value, label: t('Deleted role'), muted: true },
        ]
      : []),
    ...options,
  ];
  return (
    <Listbox
      value={value ?? ''}
      options={all}
      onChange={(next) => onChange(next || null)}
      label={label}
      placeholder={placeholder ?? t('Pick a role')}
      disabled={readOnly}
    />
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AddPicker({
  options,
  onPick,
  label,
}: {
  options: readonly ListOption[];
  onPick: (value: string) => void;
  label: string;
}) {
  return (
    <Listbox
      value=""
      options={options}
      onChange={onPick}
      label={label}
      compact
      trigger={
        <span className="mx-add-trigger">
          <PlusIcon />
          {label}
        </span>
      }
    />
  );
}

function ChipPicker({
  items,
  options,
  onChange,
  addLabel,
  render,
}: {
  items: string[];
  options: ListOption[];
  onChange: (next: string[]) => void;
  addLabel: string;
  render: (id: string) => ReactNode;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  const available = options.filter((option) => !items.includes(option.value));
  return (
    <div className="mx-chips">
      {items.map((item) => (
        <span key={item} className="mx-chip">
          {render(item)}
          {readOnly ? null : (
            <button
              type="button"
              className="mx-chip-x"
              aria-label={t('Remove {name}', {
                name: options.find((option) => option.value === item)?.label ?? item,
              })}
              onClick={() => onChange(items.filter((entry) => entry !== item))}
            >
              <CloseIcon />
            </button>
          )}
        </span>
      ))}
      {readOnly || available.length === 0 ? null : (
        <AddPicker
          options={available}
          label={addLabel}
          onPick={(next) => onChange([...items, next])}
        />
      )}
    </div>
  );
}

export function ChannelMulti({
  value,
  onChange,
  kinds = TEXT_KINDS,
  addLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  kinds?: number[];
  addLabel?: string;
}) {
  const t = useT();
  const options = useChannelOptions(kinds);
  return (
    <ChipPicker
      items={value}
      options={options}
      onChange={onChange}
      addLabel={addLabel ?? t('Add channel')}
      render={(id) => options.find((option) => option.value === id)?.label ?? t('Deleted channel')}
    />
  );
}

export function RoleMulti({
  value,
  onChange,
  addLabel,
  bots,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  addLabel?: string;
  bots?: boolean;
}) {
  const t = useT();
  const { roles } = useGuild();
  const options = useRoleOptions({ bots });
  return (
    <ChipPicker
      items={value}
      options={options}
      onChange={onChange}
      addLabel={addLabel ?? t('Add role')}
      render={(id) => {
        const role = roles.find((entry) => entry.id === id);
        return (
          <>
            <span className="mx-dot" style={{ background: roleColor(role?.color ?? 0) }} />
            {role?.name ?? t('Deleted role')}
          </>
        );
      }}
    />
  );
}

export function WordList({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  return (
    <div className="mx-chips">
      {value.map((word) => (
        <span key={word} className="mx-chip">
          <span className={mono ? 'mx-mono' : undefined}>{word}</span>
          {readOnly ? null : (
            <button
              type="button"
              className="mx-chip-x"
              aria-label={t('Remove {name}', { name: word })}
              onClick={() => onChange(value.filter((entry) => entry !== word))}
            >
              <CloseIcon />
            </button>
          )}
        </span>
      ))}
      {readOnly ? null : (
        <input
          className={mono ? 'mx-input mx-input-inline mx-mono' : 'mx-input mx-input-inline'}
          placeholder={placeholder ?? t('Add and press Enter')}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const word = event.currentTarget.value.trim();
            if (word && !value.includes(word)) onChange([...value, word]);
            event.currentTarget.value = '';
          }}
        />
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const readOnly = useReadOnly();
  return (
    <label className="mx-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || readOnly}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

type TimezoneProps =
  | { value: string; onChange: (next: string) => void; label?: string; none?: undefined }
  | {
      value: string | null;
      onChange: (next: string | null) => void;
      label?: string;
      none: string;
    };

export function TimezoneSelect(props: TimezoneProps) {
  const { timezones } = useGuild();
  const t = useT();
  const { value } = props;
  const label = props.label ?? t('Timezone');
  const list = !value || timezones.includes(value) ? timezones : [value, ...timezones];
  const options = list.map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  }));
  return (
    <Select
      value={value ?? ''}
      label={label}
      searchable
      options={props.none === undefined ? options : [{ value: '', label: props.none }, ...options]}
      onChange={(next) => {
        if (props.none === undefined) props.onChange(next);
        else props.onChange(next || null);
      }}
    />
  );
}
