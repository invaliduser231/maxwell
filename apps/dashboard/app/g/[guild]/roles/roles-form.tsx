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
import { EmojiGlyph, EmojiPicker } from '@/components/emoji-picker';
import { useChannelName, useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { outcome, type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import {
  Avatar,
  Chip,
  CloseIcon,
  Column,
  Empty,
  Field,
  Fields,
  Grid,
  Panel,
  PanelBody,
  roleColor,
} from '@/components/ui';
import { runAction } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';
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

const tabs: { value: Tab; label: Key }[] = [
  { value: 'menus', label: 'Role menus' },
  { value: 'auto', label: 'Autoroles' },
  { value: 'time', label: 'Roles after time' },
  { value: 'sticky', label: 'Sticky roles' },
];

const typeLabels: Record<MenuType, Key> = {
  normal: 'Normal',
  unique: 'One of many',
  add: 'Add only',
  temporary: 'Temporary',
};

const durations = [60, 1440, 10080, 43200];
const autoDelays = [0, 5, 10, 60, 1440];
const palette = [
  '🔴',
  '🟠',
  '🟡',
  '🟢',
  '🔵',
  '🟣',
  '🟤',
  '⚫',
  '⚪',
  '🟥',
  '🟧',
  '🟨',
  '🟩',
  '🟦',
  '🟪',
  '🟫',
  '⬛',
  '⬜',
  '🔶',
  '🔷',
];

function delayLabel(t: Translator, minutes: number): string {
  return minutes === 0 ? t('Right away') : t('After {span}', { span: minutesLabel(t, minutes) });
}

function typeNote(t: Translator, menu: RoleMenu): string | null {
  switch (menu.type) {
    case 'unique':
      return t('One role at a time.');
    case 'add':
      return t('Roles stay when you remove the reaction.');
    case 'temporary':
      return t('Roles last {span}.', { span: minutesLabel(t, menu.durationMinutes) });
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

function nextEmoji(menu: RoleMenu): string {
  return palette.find((emoji) => !menu.entries.some((entry) => entry.emoji === emoji)) ?? '';
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="mx-btn mx-btn-ghost"
      aria-label={label}
      title={t('Remove')}
      style={{ width: 32, padding: 0, flexShrink: 0, display: 'grid', placeItems: 'center' }}
      onClick={onClick}
    >
      <CloseIcon />
    </button>
  );
}

function useAddMenu(onSelect: (index: number) => void) {
  const t = useT();
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
          title: t('Pick your roles'),
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
  const t = useT();
  const { value, readOnly } = useDraft<RolesConfig>();
  const channelName = useChannelName();
  const add = useAddMenu(onSelect);

  return (
    <Panel
      title={t('Menus')}
      id="r-menus"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn"
            disabled={value.menus.length >= 25}
            onClick={add}
          >
            {t('New menu')}
          </button>
        )
      }
    >
      {value.menus.map((menu, index) => {
        const live = posted.some((entry) => entry.menuId === menu.id);
        const count = t.plural(menu.entries.length, '{n} role', '{n} roles');
        return (
          <div key={menu.id} className="mx-row">
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={index === selected}
              onClick={() => onSelect(index)}
            >
              <span className="mx-row-title mx-ellipsis">{menu.title || t('Untitled menu')}</span>
              <span className="mx-sub mx-ellipsis">
                {menu.channelId ? `${channelName(menu.channelId)}, ${count}` : count}
              </span>
            </button>
            {live ? <Chip>{t('Posted')}</Chip> : null}
          </div>
        );
      })}
    </Panel>
  );
}

function MenuEditor({ index, onRemoved }: { index: number; onRemoved: () => void }) {
  const t = useT();
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
  const lengths = durations.includes(menu.durationMinutes)
    ? durations
    : [...durations, menu.durationMinutes].sort((a, b) => a - b);

  return (
    <Panel
      title={menu.title || t('Untitled menu')}
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
            {t('Delete menu')}
          </button>
        )
      }
    >
      <PanelBody>
        <Field label={t('Title')}>
          <TextInput value={menu.title} maxLength={256} onChange={(title) => patch({ title })} />
        </Field>
        <Field label={t('Description')}>
          <TextArea
            value={menu.description}
            rows={2}
            maxLength={2000}
            onChange={(description) => patch({ description })}
          />
        </Field>
        <div className="mx-field">
          <span className="mx-label">{t('Mode')}</span>
          <div className="mx-when">
            <Seg
              label={t('Mode')}
              value={menu.type}
              options={(Object.keys(typeLabels) as MenuType[]).map((type) => ({
                value: type,
                label: t(typeLabels[type]),
              }))}
              onChange={(type) => patch({ type })}
            />
            {menu.type === 'temporary' ? (
              <Select
                label={t('Roles last')}
                value={String(menu.durationMinutes)}
                options={lengths.map((minutes) => ({
                  value: String(minutes),
                  label: minutesLabel(t, minutes),
                }))}
                onChange={(next) => patch({ durationMinutes: Number(next) })}
              />
            ) : null}
          </div>
        </div>
        <div className="mx-field">
          <span className="mx-label">{t('Roles')}</span>
          {menu.entries.length > 0 ? (
            <div className="mx-role-entries">
              {menu.entries.map((entry, position) => {
                const role = roles.find((candidate) => candidate.id === entry.roleId);
                const name = role?.name ?? t('Deleted role');
                return (
                  <div key={entry.roleId} className="mx-role-entry" data-readonly={readOnly}>
                    <EmojiPicker
                      value={entry.emoji || null}
                      label={t('Emoji for {name}', { name })}
                      disabled={readOnly}
                      onChange={(emoji) => setEntry(position, { emoji: emoji ?? '' })}
                    />
                    <RoleSelect
                      value={entry.roleId}
                      none={null}
                      label={t('Role {number}', { number: position + 1 })}
                      onChange={(roleId) => {
                        if (roleId && !menu.entries.some((other) => other.roleId === roleId)) {
                          setEntry(position, { roleId });
                        }
                      }}
                    />
                    <input
                      className="mx-input"
                      aria-label={t('Label for {name}', { name })}
                      placeholder={t('Label, optional')}
                      value={entry.label}
                      maxLength={100}
                      readOnly={readOnly}
                      onChange={(event) => setEntry(position, { label: event.target.value })}
                    />
                    {readOnly ? null : (
                      <RemoveButton
                        label={t('Remove {name}', { name })}
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
            <span className="mx-sub">{t('No roles yet')}</span>
          ) : null}
          {readOnly || available.length === 0 || menu.entries.length >= 20 ? null : (
            <div>
              <AddPicker
                label={t('Add role')}
                options={available}
                onPick={(roleId) =>
                  patch({
                    entries: [...menu.entries, { emoji: nextEmoji(menu), roleId, label: '' }],
                  })
                }
              />
            </div>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

function MenuPost({ index, posted }: { index: number; posted: Posted[] }) {
  const t = useT();
  const { value, update, readOnly, dirty, save } = useDraft<RolesConfig>();
  const { roles, guildId } = useGuild();
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

  const live = posted.find((entry) => entry.menuId === menu.id);
  const missingEmoji = menu.entries.some((entry) => !entry.emoji);
  const note = typeNote(t, menu);
  const roleOf = (id: string) => roles.find((role) => role.id === id);

  const run = (action: 'menu.publish' | 'menu.remove', done: string) =>
    start(async () => {
      if (dirty && !(await save())) return;
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
    <Panel title={t('Post')} id="r-post">
      <PanelBody>
        <Field label={t('Channel')}>
          <ChannelSelect
            value={menu.channelId}
            onChange={(channelId) =>
              update((previous) => ({
                ...previous,
                menus: previous.menus.map((entry, position) =>
                  position === index ? { ...entry, channelId } : entry,
                ),
              }))
            }
          />
        </Field>
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
                    <EmojiGlyph value={entry.emoji} size={18} />
                    <span style={{ color: roleColor(role?.color ?? 0) }}>
                      @{role?.name ?? t('Deleted role')}
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
                    <EmojiGlyph value={entry.emoji} size={16} />
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
                disabled={pending || !menu.channelId || menu.entries.length === 0}
                onClick={publish}
              >
                {live && live.channelId === menu.channelId ? t('Update post') : t('Post')}
              </button>
              {live ? (
                <TwoStep
                  label={t('Remove post')}
                  danger
                  disabled={pending}
                  run={() => run('menu.remove', 'Removing.')}
                />
              ) : null}
              <StatusText status={status} />
            </div>
            {tried && missingEmoji ? (
              <span className="mx-field-error">{t('Every role needs an emoji.')}</span>
            ) : null}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function Menus({ posted }: { posted: Posted[] }) {
  const t = useT();
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
              <span>{t('No role menus yet.')}</span>
              {readOnly ? null : (
                <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                  {t('New menu')}
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
      <Column span={7}>
        <MenuList selected={index} onSelect={setSelected} posted={posted} />
        <MenuEditor index={index} onRemoved={() => setSelected(Math.max(index - 1, 0))} />
      </Column>
      <Column span={5}>
        <MenuPost index={index} posted={posted} />
      </Column>
    </Grid>
  );
}

function Autoroles() {
  const t = useT();
  const { value, set } = useDraft<RolesConfig>();
  const delay = value.autoroles.delayMinutes;
  const options = (autoDelays.includes(delay) ? autoDelays : [...autoDelays, delay]).map(
    (minutes) => ({ value: String(minutes), label: delayLabel(t, minutes) }),
  );
  const setAuto = (patch: Partial<RolesConfig['autoroles']>) =>
    set({ autoroles: { ...value.autoroles, ...patch } });

  return (
    <Grid>
      <Panel span={7} id="r-auto">
        <PanelBody>
          <div className="mx-field">
            <span className="mx-label">{t('Every new member')}</span>
            <RoleMulti
              value={value.autoroles.roleIds}
              onChange={(roleIds) => setAuto({ roleIds })}
            />
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Bots')}</span>
            <RoleMulti
              value={value.autoroles.botRoleIds}
              onChange={(botRoleIds) => setAuto({ botRoleIds })}
            />
          </div>
          <Fields>
            <Field label={t('Give roles')}>
              <Select
                label={t('Give roles')}
                value={String(delay)}
                options={options}
                onChange={(next) => setAuto({ delayMinutes: Number(next) })}
              />
            </Field>
          </Fields>
        </PanelBody>
      </Panel>
    </Grid>
  );
}

function TimeRoles({ holders }: { holders: Record<string, number> }) {
  const t = useT();
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
        label={t('Add step')}
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
      <Grid>
        <Panel id="r-time">
          <Empty mood="sleeping">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>{t('No steps yet.')}</span>
              {picker}
            </div>
          </Empty>
        </Panel>
      </Grid>
    );
  }

  return (
    <Grid>
      <Panel title={t('Steps')} id="r-time" actions={picker}>
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">{t('After')}</th>
                <th scope="col">{t('Role')}</th>
                <th scope="col">{t('Members now')}</th>
                <th scope="col">
                  <span className="mx-sr">{t('Remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {value.timeRoles.map((step, index) => {
                const role = roles.find((entry) => entry.id === step.roleId);
                const name = role?.name ?? t('Deleted role');
                return (
                  <tr key={step.roleId}>
                    <td style={{ width: 200 }}>
                      <NumberInput
                        label={t('Days before {name}', { name })}
                        value={step.days}
                        min={1}
                        max={3650}
                        suffix={step.days === 1 ? t('day') : t('days')}
                        onChange={(days) => setStep(index, { days })}
                      />
                    </td>
                    <td>
                      <Chip color={roleColor(role?.color ?? 0)}>{name}</Chip>
                    </td>
                    <td>{t.count(holders[step.roleId] ?? 0)}</td>
                    <td style={{ width: 48, textAlign: 'right' }}>
                      {readOnly ? null : (
                        <RemoveButton
                          label={t('Remove {name}', { name })}
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
    </Grid>
  );
}

function Sticky({ kept }: { kept: Kept[] }) {
  const t = useT();
  const { value, set } = useDraft<RolesConfig>();
  const { roles } = useGuild();
  const sticky = value.sticky;
  const setSticky = (patch: Partial<RolesConfig['sticky']>) =>
    set({ sticky: { ...sticky, ...patch } });
  const names = (ids: string[]) =>
    t.list(ids.map((id) => roles.find((role) => role.id === id)?.name ?? t('Deleted role')));

  return (
    <Grid>
      <Panel
        title={t('Give back on rejoin')}
        span={6}
        id="r-sticky"
        actions={
          <Switch
            label={t('Give back on rejoin')}
            checked={sticky.enabled}
            onChange={(enabled) => setSticky({ enabled })}
          />
        }
      >
        <PanelBody>
          <div className="mx-field">
            <span className="mx-label">{t('Give back')}</span>
            <div>
              <Seg
                label={t('Give back')}
                value={sticky.mode}
                options={[
                  { value: 'all', label: t('All roles') },
                  { value: 'listed', label: t('Only these') },
                ]}
                onChange={(mode) => setSticky({ mode })}
              />
            </div>
          </div>
          {sticky.mode === 'listed' ? (
            <div className="mx-field">
              <span className="mx-label">{t('Roles to give back')}</span>
              <RoleMulti value={sticky.roleIds} onChange={(roleIds) => setSticky({ roleIds })} />
            </div>
          ) : null}
          <div className="mx-field">
            <span className="mx-label">{t('Never given back')}</span>
            <RoleMulti
              value={sticky.ignoredRoleIds}
              onChange={(ignoredRoleIds) => setSticky({ ignoredRoleIds })}
            />
          </div>
          <Fields>
            <Field label={t('Remember for')}>
              <NumberInput
                label={t('Remember for')}
                value={sticky.retentionDays}
                min={1}
                max={3650}
                suffix={t('days')}
                onChange={(retentionDays) => setSticky({ retentionDays })}
              />
            </Field>
          </Fields>
        </PanelBody>
      </Panel>
      <Panel title={t('Waiting for a rejoin')} span={6} id="r-rejoin">
        {kept.length === 0 ? (
          <Empty mood="sleeping">{t('Nobody yet.')}</Empty>
        ) : (
          kept.map((member) => (
            <div key={member.userId} className="mx-row">
              <Avatar src={member.avatarUrl} name={member.name} size={26} />
              <div className="mx-row-main">
                <span className="mx-row-title">{member.name}</span>
                <span className="mx-sub">
                  {t('Gets back {roles}', { roles: names(member.roleIds) })}
                </span>
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
  posted,
  holders,
  kept,
}: {
  posted: Posted[];
  holders: Record<string, number>;
  kept: Kept[];
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('menus');

  return (
    <>
      <Tabs
        label={t('Role tools')}
        value={tab}
        options={tabs.map((option) => ({ ...option, label: t(option.label) }))}
        onChange={setTab}
      />
      {tab === 'menus' ? <Menus posted={posted} /> : null}
      {tab === 'auto' ? <Autoroles /> : null}
      {tab === 'time' ? <TimeRoles holders={holders} /> : null}
      {tab === 'sticky' ? <Sticky kept={kept} /> : null}
    </>
  );
}
