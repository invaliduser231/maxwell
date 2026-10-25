'use client';

import type { MenuType, RoleMenu, RolesConfig } from '@maxwell/core/modules/roles';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  AddPicker,
  ChannelSelect,
  NumberInput,
  RoleMulti,
  RoleSelect,
  Seg,
  Select,
  Switch,
  Tabs,
  TextArea,
  TextInput,
  useRoleOptions,
} from '@/components/controls';
import { useChannelName, useGuild } from '@/components/guild';
import { EmbedPreview, Markdown, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { outcome, type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import {
  Avatar,
  Chip,
  CloseIcon,
  Empty,
  Field,
  Fields,
  Grid,
  Panel,
  PanelBody,
  roleColor,
} from '@/components/ui';
import { runAction } from '@/lib/actions';
import { minutesLabel } from '@/lib/time';

export interface Posted {
  menuId: string;
  channelId: string;
}

export interface Kept {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleIds: string[];
  left: string;
}

type Tab = 'menus' | 'auto' | 'time' | 'sticky';

const tabs = [
  { value: 'menus', label: 'Role menus' },
  { value: 'auto', label: 'Autoroles' },
  { value: 'time', label: 'Roles after time' },
  { value: 'sticky', label: 'Sticky roles' },
] as const;

const typeLabels: Record<MenuType, string> = {
  normal: 'Normal',
  unique: 'One of many',
  add: 'Add only',
  temporary: 'Temporary',
};

const durations = [
  { value: '60', label: '1 hour' },
  { value: '1440', label: '1 day' },
  { value: '10080', label: '7 days' },
  { value: '43200', label: '30 days' },
];

const autoDelays = [
  { value: '0', label: 'Right away' },
  { value: '5', label: 'After 5 minutes' },
  { value: '10', label: 'After 10 minutes' },
  { value: '60', label: 'After 1 hour' },
  { value: '1440', label: 'After 1 day' },
];

function after(days: number): string {
  if (days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`;
  return days === 1 ? '1 day' : `${days} days`;
}

function typeNote(menu: RoleMenu): string | null {
  switch (menu.type) {
    case 'unique':
      return 'One role at a time.';
    case 'add':
      return 'Roles stay when you remove the reaction.';
    case 'temporary':
      return `Roles last ${minutesLabel(menu.durationMinutes)}.`;
    default:
      return null;
  }
}

function newId(taken: string[]): string {
  for (;;) {
    const id = `menu-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.includes(id)) return id;
  }
}

function emojiMarkup(emoji: string): string {
  const bare = /^([\w~-]+):(\d+)$/.exec(emoji);
  return bare ? `<:${bare[1]}:${bare[2]}>` : emoji;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="mx-btn mx-btn-ghost"
      aria-label={label}
      title="Remove"
      style={{ width: 32, padding: 0, flexShrink: 0, display: 'grid', placeItems: 'center' }}
      onClick={onClick}
    >
      <CloseIcon />
    </button>
  );
}

function useAddMenu(onSelect: (index: number) => void) {
  const { value, update } = useDraft<RolesConfig>();
  return () => {
    const id = newId(value.menus.map((menu) => menu.id));
    update((previous) => ({
      ...previous,
      menus: [
        ...previous.menus,
        {
          id,
          channelId: null,
          title: 'Pick your roles',
          description: '',
          type: 'normal',
          durationMinutes: 1440,
          entries: [],
        },
      ],
    }));
    onSelect(value.menus.length);
  };
}

function MenuList({
  selected,
  onSelect,
  posted,
}: {
  selected: number;
  onSelect: (index: number) => void;
  posted: Posted[];
}) {
  const { value, readOnly } = useDraft<RolesConfig>();
  const channelName = useChannelName();
  const add = useAddMenu(onSelect);

  return (
    <Panel
      title="Role menus"
      span={3}
      id="r-menus"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn"
            disabled={value.menus.length >= 25}
            onClick={add}
          >
            New menu
          </button>
        )
      }
    >
      {value.menus.map((menu, index) => {
        const live = posted.some((entry) => entry.menuId === menu.id);
        return (
          <div key={menu.id} className="mx-row">
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={index === selected}
              onClick={() => onSelect(index)}
            >
              <span className="mx-row-title mx-ellipsis">{menu.title || 'Untitled menu'}</span>
              <span className="mx-sub mx-ellipsis">
                {menu.channelId ? channelName(menu.channelId) : 'No channel'},{' '}
                {menu.entries.length === 1 ? '1 role' : `${menu.entries.length} roles`}
              </span>
            </button>
            {live ? <Chip>Posted</Chip> : null}
          </div>
        );
      })}
    </Panel>
  );
}

function MenuEditor({ index, onRemoved }: { index: number; onRemoved: () => void }) {
  const { value, update, readOnly } = useDraft<RolesConfig>();
  const { roles } = useGuild();
  const roleOptions = useRoleOptions();
  const menu = value.menus[index];
  if (!menu) return null;

  const patch = (next: Partial<RoleMenu>) =>
    update((previous) => ({
      ...previous,
      menus: previous.menus.map((entry, position) =>
        position === index ? { ...entry, ...next } : entry,
      ),
    }));
  const setEntry = (position: number, next: Partial<RoleMenu['entries'][number]>) =>
    patch({
      entries: menu.entries.map((entry, at) => (at === position ? { ...entry, ...next } : entry)),
    });
  const available = roleOptions.filter(
    (option) => !menu.entries.some((entry) => entry.roleId === option.value),
  );
  const expiry = menu.type === 'temporary' ? String(menu.durationMinutes) : 'never';
  const expiryOptions = [
    { value: 'never', label: 'Never' },
    ...durations,
    ...(menu.type === 'temporary' &&
    !durations.some((entry) => entry.value === String(menu.durationMinutes))
      ? [{ value: String(menu.durationMinutes), label: minutesLabel(menu.durationMinutes) }]
      : []),
  ];

  return (
    <Panel
      title="Edit menu"
      span={5}
      id="r-edit"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            onClick={() => {
              update((previous) => ({
                ...previous,
                menus: previous.menus.filter((_, position) => position !== index),
              }));
              onRemoved();
            }}
          >
            Delete menu
          </button>
        )
      }
    >
      <PanelBody>
        <Field label="Title">
          <TextInput value={menu.title} maxLength={256} onChange={(title) => patch({ title })} />
        </Field>
        <Fields>
          <Field label="Channel">
            <ChannelSelect value={menu.channelId} onChange={(channelId) => patch({ channelId })} />
          </Field>
          <Field label="Remove after">
            <Select
              value={expiry}
              options={expiryOptions}
              onChange={(next) =>
                next === 'never'
                  ? patch({ type: menu.type === 'temporary' ? 'normal' : menu.type })
                  : patch({ type: 'temporary', durationMinutes: Number(next) })
              }
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">Type</span>
          <div>
            <Seg
              label="Menu type"
              value={menu.type}
              options={(Object.keys(typeLabels) as MenuType[]).map((type) => ({
                value: type,
                label: typeLabels[type],
              }))}
              onChange={(type) => patch({ type })}
            />
          </div>
        </div>
        <Field label="Description">
          <TextArea
            value={menu.description}
            rows={2}
            maxLength={2000}
            onChange={(description) => patch({ description })}
          />
        </Field>
        <div className="mx-field">
          <span className="mx-label">Roles</span>
          {menu.entries.length > 0 ? (
            <div className="mx-inset mx-stack" style={{ gap: 8, padding: 10 }}>
              {menu.entries.map((entry, position) => {
                const role = roles.find((candidate) => candidate.id === entry.roleId);
                return (
                  <div
                    key={entry.roleId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: readOnly
                        ? '64px minmax(0, 1fr) minmax(0, 1fr)'
                        : '64px minmax(0, 1fr) minmax(0, 1fr) 32px',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <input
                      className="mx-input mx-mono"
                      aria-label={`Emoji for ${role?.name ?? 'role'}`}
                      placeholder="Emoji"
                      value={entry.emoji}
                      maxLength={80}
                      readOnly={readOnly}
                      style={{ width: '100%', textAlign: 'center' }}
                      onChange={(event) => setEntry(position, { emoji: event.target.value.trim() })}
                    />
                    <RoleSelect
                      value={entry.roleId}
                      none={null}
                      label={`Role ${position + 1}`}
                      onChange={(roleId) => {
                        if (roleId && !menu.entries.some((other) => other.roleId === roleId)) {
                          setEntry(position, { roleId });
                        }
                      }}
                    />
                    <input
                      className="mx-input"
                      aria-label={`Label for ${role?.name ?? 'role'}`}
                      placeholder="Label"
                      value={entry.label}
                      maxLength={100}
                      readOnly={readOnly}
                      style={{ width: '100%' }}
                      onChange={(event) => setEntry(position, { label: event.target.value })}
                    />
                    {readOnly ? null : (
                      <RemoveButton
                        label={`Remove ${role?.name ?? 'role'}`}
                        onClick={() =>
                          patch({ entries: menu.entries.filter((_, at) => at !== position) })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : readOnly ? (
            <span className="mx-sub">No roles yet</span>
          ) : null}
          {readOnly || available.length === 0 || menu.entries.length >= 20 ? null : (
            <div>
              <AddPicker
                label="Add role"
                options={available}
                onPick={(roleId) =>
                  patch({ entries: [...menu.entries, { emoji: '', roleId, label: '' }] })
                }
              />
            </div>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

function MenuPreview({
  index,
  saved,
  posted,
}: {
  index: number;
  saved: RolesConfig;
  posted: Posted[];
}) {
  const { value, readOnly } = useDraft<RolesConfig>();
  const { roles, guildId } = useGuild();
  const channelName = useChannelName();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const menu = value.menus[index];

  useEffect(() => {
    if (!status || status.error) return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [status, router]);

  if (!menu) return null;

  const where = menu.channelId ? channelName(menu.channelId) : 'No channel';
  const live = posted.find((entry) => entry.menuId === menu.id);
  const stored = saved.menus.find((entry) => entry.id === menu.id);
  const unsaved = !stored || JSON.stringify(stored) !== JSON.stringify(menu);
  const missingEmoji = menu.entries.some((entry) => !entry.emoji);
  const note = typeNote(menu);
  const roleOf = (id: string) => roles.find((role) => role.id === id);

  const run = (action: 'menu.publish' | 'menu.remove', done: string) =>
    start(async () => {
      const result = await runAction(guildId, 'roles', action, { menuId: menu.id });
      setStatus(outcome(result, done));
    });

  const publish = () => {
    if (missingEmoji) {
      setTried(true);
      return;
    }
    setTried(false);
    run('menu.publish', live ? 'Updating.' : 'Posting.');
  };

  return (
    <Panel title="Preview" span={4} id="r-prev" actions={<span className="mx-sub">{where}</span>}>
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview>
            <EmbedPreview
              color="#F26B3A"
              title={menu.title || null}
              description={menu.description}
              footer={note}
            >
              {menu.entries.map((entry) => {
                const role = roleOf(entry.roleId);
                return (
                  <span
                    key={entry.roleId}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span style={{ minWidth: 20 }}>
                      <Markdown text={emojiMarkup(entry.emoji)} as="span" />
                    </span>
                    <span style={{ color: roleColor(role?.color ?? 0) }}>
                      @{role?.name ?? 'Deleted role'}
                    </span>
                    {entry.label ? <span>{entry.label}</span> : null}
                  </span>
                );
              })}
            </EmbedPreview>
            {menu.entries.length > 0 ? (
              <div className="mx-chips">
                {menu.entries.map((entry) => (
                  <Chip key={entry.roleId}>
                    <Markdown text={emojiMarkup(entry.emoji) || '?'} as="span" />
                  </Chip>
                ))}
              </div>
            ) : null}
          </MessagePreview>
        </div>
        {readOnly ? null : (
          <div className="mx-stack" style={{ gap: 6 }}>
            <div className="mx-inline">
              <button
                type="button"
                className="mx-btn mx-btn-primary"
                disabled={pending || unsaved || !menu.channelId || menu.entries.length === 0}
                onClick={publish}
              >
                {live && live.channelId === menu.channelId ? 'Update post' : `Post to ${where}`}
              </button>
              {live ? (
                <TwoStep
                  label="Remove post"
                  danger
                  disabled={pending}
                  run={() => run('menu.remove', 'Removing.')}
                />
              ) : null}
              {unsaved && !status ? <span className="mx-sub">Save to post</span> : null}
              <StatusText status={status} />
            </div>
            {tried && missingEmoji ? (
              <span className="mx-field-error">Every role needs an emoji.</span>
            ) : null}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function Menus({ saved, posted }: { saved: RolesConfig; posted: Posted[] }) {
  const [selected, setSelected] = useState(0);
  const { value, readOnly } = useDraft<RolesConfig>();
  const add = useAddMenu(setSelected);
  const index = Math.min(selected, Math.max(value.menus.length - 1, 0));

  if (value.menus.length === 0) {
    return (
      <Grid>
        <Panel id="r-menus">
          <Empty mood="thinking">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>No role menus yet.</span>
              {readOnly ? null : (
                <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                  New menu
                </button>
              )}
            </div>
          </Empty>
        </Panel>
      </Grid>
    );
  }

  return (
    <Grid>
      <MenuList selected={index} onSelect={setSelected} posted={posted} />
      <MenuEditor index={index} onRemoved={() => setSelected(Math.max(index - 1, 0))} />
      <MenuPreview index={index} saved={saved} posted={posted} />
    </Grid>
  );
}

function Autoroles() {
  const { value, set } = useDraft<RolesConfig>();
  const delay = value.autoroles.delayMinutes;
  const options = autoDelays.some((entry) => entry.value === String(delay))
    ? autoDelays
    : [...autoDelays, { value: String(delay), label: `After ${minutesLabel(delay)}` }];
  const setAuto = (patch: Partial<RolesConfig['autoroles']>) =>
    set({ autoroles: { ...value.autoroles, ...patch } });

  return (
    <Panel title="Autoroles" id="r-auto">
      <PanelBody>
        <div className="mx-field">
          <span className="mx-label">Every new member</span>
          <RoleMulti value={value.autoroles.roleIds} onChange={(roleIds) => setAuto({ roleIds })} />
        </div>
        <div className="mx-field">
          <span className="mx-label">Bots</span>
          <RoleMulti
            value={value.autoroles.botRoleIds}
            onChange={(botRoleIds) => setAuto({ botRoleIds })}
          />
        </div>
        <Fields>
          <Field label="Give roles">
            <Select
              label="Give roles"
              value={String(delay)}
              options={options}
              onChange={(next) => setAuto({ delayMinutes: Number(next) })}
            />
          </Field>
        </Fields>
      </PanelBody>
    </Panel>
  );
}

function TimeRoles({ holders }: { holders: Record<string, number> }) {
  const { value, update, readOnly } = useDraft<RolesConfig>();
  const { roles } = useGuild();
  const roleOptions = useRoleOptions();
  const available = roleOptions.filter(
    (option) => !value.timeRoles.some((step) => step.roleId === option.value),
  );
  const setStep = (index: number, patch: Partial<RolesConfig['timeRoles'][number]>) =>
    update((previous) => ({
      ...previous,
      timeRoles: previous.timeRoles.map((step, at) =>
        at === index ? { ...step, ...patch } : step,
      ),
    }));
  const picker =
    readOnly || available.length === 0 || value.timeRoles.length >= 10 ? null : (
      <AddPicker
        label="Add step"
        options={available}
        onPick={(roleId) =>
          update((previous) => ({
            ...previous,
            timeRoles: [...previous.timeRoles, { roleId, days: 7 }],
          }))
        }
      />
    );

  if (value.timeRoles.length === 0) {
    return (
      <Panel title="Roles after time" id="r-time">
        <Empty mood="sleeping">
          <div className="mx-stack" style={{ alignItems: 'center' }}>
            <span>No steps yet.</span>
            {picker}
          </div>
        </Empty>
      </Panel>
    );
  }

  return (
    <Panel title="Roles after time" id="r-time" actions={picker}>
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">After</th>
              <th scope="col">Role</th>
              <th scope="col">Members now</th>
              <th scope="col">
                <span className="mx-sr">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {value.timeRoles.map((step, index) => {
              const role = roles.find((entry) => entry.id === step.roleId);
              return (
                <tr key={step.roleId}>
                  <td style={{ width: 200 }}>
                    <NumberInput
                      label={`Days before ${role?.name ?? 'this role'}`}
                      value={step.days}
                      min={1}
                      max={3650}
                      suffix={step.days === 1 ? 'day' : 'days'}
                      onChange={(days) => setStep(index, { days })}
                    />
                  </td>
                  <td>
                    <Chip color={roleColor(role?.color ?? 0)}>{role?.name ?? 'Deleted role'}</Chip>
                  </td>
                  <td>{(holders[step.roleId] ?? 0).toLocaleString('en-US')}</td>
                  <td style={{ width: 48, textAlign: 'right' }}>
                    {readOnly ? null : (
                      <RemoveButton
                        label={`Remove step ${role?.name ?? after(step.days)}`}
                        onClick={() =>
                          update((previous) => ({
                            ...previous,
                            timeRoles: previous.timeRoles.filter((_, at) => at !== index),
                          }))
                        }
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Sticky({ kept }: { kept: Kept[] }) {
  const { value, set } = useDraft<RolesConfig>();
  const { roles } = useGuild();
  const sticky = value.sticky;
  const setSticky = (patch: Partial<RolesConfig['sticky']>) =>
    set({ sticky: { ...sticky, ...patch } });
  const names = (ids: string[]) => {
    const list = ids.map((id) => roles.find((role) => role.id === id)?.name ?? 'Deleted role');
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  };

  return (
    <Grid>
      <Panel
        title="Sticky roles"
        span={6}
        id="r-sticky"
        actions={
          <Switch
            label="Sticky roles"
            checked={sticky.enabled}
            onChange={(enabled) => setSticky({ enabled })}
          />
        }
      >
        <PanelBody>
          <div className="mx-field">
            <span className="mx-label">Give back</span>
            <div>
              <Seg
                label="Give back"
                value={sticky.mode}
                options={[
                  { value: 'all', label: 'All roles' },
                  { value: 'listed', label: 'Only these' },
                ]}
                onChange={(mode) => setSticky({ mode })}
              />
            </div>
          </div>
          {sticky.mode === 'listed' ? (
            <div className="mx-field">
              <span className="mx-label">Roles to give back</span>
              <RoleMulti value={sticky.roleIds} onChange={(roleIds) => setSticky({ roleIds })} />
            </div>
          ) : null}
          <div className="mx-field">
            <span className="mx-label">Never given back</span>
            <RoleMulti
              value={sticky.ignoredRoleIds}
              onChange={(ignoredRoleIds) => setSticky({ ignoredRoleIds })}
            />
          </div>
          <Fields>
            <Field label="Remember for">
              <NumberInput
                label="Remember for"
                value={sticky.retentionDays}
                min={1}
                max={3650}
                suffix="days"
                onChange={(retentionDays) => setSticky({ retentionDays })}
              />
            </Field>
          </Fields>
        </PanelBody>
      </Panel>
      <Panel title="Waiting for a rejoin" span={6} id="r-rejoin">
        {kept.length === 0 ? (
          <Empty mood="sleeping">Nobody yet.</Empty>
        ) : (
          kept.map((member) => (
            <div key={member.userId} className="mx-row">
              <Avatar src={member.avatarUrl} name={member.name} size={26} />
              <div className="mx-row-main">
                <span className="mx-row-title">{member.name}</span>
                <span className="mx-sub">Gets back {names(member.roleIds)}</span>
              </div>
              <span className="mx-sub">{member.left}</span>
            </div>
          ))
        )}
      </Panel>
    </Grid>
  );
}

export function RolesForm({
  saved,
  posted,
  holders,
  kept,
}: {
  saved: RolesConfig;
  posted: Posted[];
  holders: Record<string, number>;
  kept: Kept[];
}) {
  const [tab, setTab] = useState<Tab>('menus');

  return (
    <>
      <Tabs label="Role tools" value={tab} options={tabs} onChange={setTab} />
      {tab === 'menus' ? <Menus saved={saved} posted={posted} /> : null}
      {tab === 'auto' ? <Autoroles /> : null}
      {tab === 'time' ? <TimeRoles holders={holders} /> : null}
      {tab === 'sticky' ? <Sticky kept={kept} /> : null}
    </>
  );
}
