'use client';

import { type LogEvent, type LogsConfig, logEventNames } from '@maxwell/core/modules/logs';
import { type CSSProperties, useState, useTransition } from 'react';
import {
  ChannelMulti,
  ChannelSelect,
  RoleMulti,
  Switch,
  ToggleRow,
  useChannelOptions,
} from '@/components/controls';
import { ChannelType, useChannelName, useGuild } from '@/components/guild';
import { Listbox, type ListOption } from '@/components/listbox';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { Callout, Grid, Panel, PanelBody } from '@/components/ui';
import { runAction } from '@/lib/actions';
import { clock } from '@/lib/time';

const groups: { name: string; events: LogEvent[] }[] = [
  { name: 'Messages', events: ['messageDelete', 'messageEdit', 'messageBulkDelete'] },
  {
    name: 'Members',
    events: ['memberJoin', 'memberLeave', 'nicknames', 'memberRoles', 'timeouts', 'bans', 'kicks'],
  },
  { name: 'Server', events: ['channels', 'roles', 'invites'] },
  { name: 'Voice', events: ['voice'] },
];

const RED = '#EC5B78';
const BLUE = '#3A9EEA';
const GREEN = '#2EB67D';
const YELLOW = '#F2C14E';
const GREY = '#8A8F98';

const ignoreKinds: number[] = [
  ChannelType.Text,
  ChannelType.Announcement,
  ChannelType.Forum,
  ChannelType.Voice,
  ChannelType.Category,
];

interface Preview {
  title: string;
  color: string;
  author: string;
  lines: string[];
  footer: string;
}

function previewOf(
  event: LogEvent,
  viewer: { id: string; name: string; handle: string },
  channel: string,
  role: string,
): Preview {
  const author = `${viewer.name} (@${viewer.handle})`;
  const user = `User ${viewer.id}`;
  switch (event) {
    case 'messageDelete':
      return {
        title: 'Message deleted',
        color: RED,
        author,
        lines: ['see you all tomorrow', `in ${channel}, sent 2 minutes ago`],
        footer: `${user} / Message 1520884113`,
      };
    case 'messageEdit':
      return {
        title: 'Message edited',
        color: BLUE,
        author,
        lines: ['Before: back in 5', 'After: back in 10', `in ${channel}`],
        footer: `${user} / Message 1520771902`,
      };
    case 'messageBulkDelete':
      return {
        title: 'Messages deleted in bulk',
        color: RED,
        author: channel,
        lines: [`48 messages in ${channel}`, 'The text of all of them is attached.'],
        footer: 'deleted-messages.txt',
      };
    case 'memberJoin':
      return {
        title: 'Member joined',
        color: GREEN,
        author,
        lines: ['Account created 2 years ago'],
        footer: `Member #1,205 / ${user}`,
      };
    case 'memberLeave':
      return {
        title: 'Member left',
        color: GREY,
        author,
        lines: ['Account created 2 years ago'],
        footer: user,
      };
    case 'nicknames':
      return {
        title: 'Nickname changed',
        color: BLUE,
        author,
        lines: [`Before: ${viewer.handle}`, `After: ${viewer.name}`],
        footer: user,
      };
    case 'memberRoles':
      return {
        title: 'Roles changed',
        color: BLUE,
        author,
        lines: [`Added ${role}`],
        footer: user,
      };
    case 'timeouts':
      return {
        title: 'Member timed out',
        color: YELLOW,
        author,
        lines: ['Until in 1 hour', 'Reason: Spam'],
        footer: user,
      };
    case 'bans':
      return {
        title: 'Member banned',
        color: RED,
        author,
        lines: ['By Maxwell', 'Reason: Raid account'],
        footer: user,
      };
    case 'kicks':
      return {
        title: 'Member kicked',
        color: RED,
        author,
        lines: ['By Maxwell', 'Reason: Alt account'],
        footer: user,
      };
    case 'channels':
      return {
        title: 'Channel updated',
        color: BLUE,
        author,
        lines: [`${channel}`, 'Slowmode: off to 5 seconds'],
        footer: 'Channel 1427120055',
      };
    case 'roles':
      return {
        title: 'Role updated',
        color: BLUE,
        author,
        lines: [role, 'Added Manage Messages'],
        footer: 'Role 1427112004',
      };
    case 'invites':
      return {
        title: 'Invite created',
        color: BLUE,
        author,
        lines: [`k8Rt2Lmq for ${channel}`],
        footer: user,
      };
    case 'voice':
      return {
        title: 'Joined voice',
        color: GREY,
        author,
        lines: [`${viewer.name} joined Lounge.`],
        footer: user,
      };
  }
}

function sameRoutes(a: LogsConfig, b: LogsConfig): boolean {
  return (
    JSON.stringify([a.routes, a.defaultChannelId]) ===
    JSON.stringify([b.routes, b.defaultChannelId])
  );
}

const nameButton: CSSProperties = {
  font: 'inherit',
  fontWeight: 500,
  color: 'inherit',
  background: 'none',
  border: 0,
  padding: '4px 0',
  cursor: 'pointer',
  textAlign: 'left',
  flex: 1,
  minWidth: 0,
};

function SmallChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M7 10l5 5 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChannelOverride({
  name,
  value,
  fallback,
  muted,
  disabled,
  onChange,
}: {
  name: string;
  value: string | null;
  fallback: string | null;
  muted: boolean;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const options = useChannelOptions();
  const channelName = useChannelName();
  const missing = value !== null && !options.some((option) => option.value === value);
  const all: ListOption[] = [
    {
      value: '',
      label: fallback ? `Default (${channelName(fallback)})` : 'Default',
      muted: true,
    },
    ...(missing && value ? [{ value, label: 'Deleted channel', muted: true }] : []),
    ...options,
  ];
  const text = value ? channelName(value) : fallback ? channelName(fallback) : 'Not set';
  const quiet = !value;
  return (
    <Listbox
      compact
      value={value ?? ''}
      options={all}
      label={`Channel for ${name}`}
      disabled={disabled}
      onChange={(next) => onChange(next || null)}
      style={
        quiet
          ? { background: 'transparent', color: muted ? 'var(--mx-faint)' : 'var(--mx-muted)' }
          : muted
            ? { color: 'var(--mx-faint)' }
            : undefined
      }
      trigger={
        <span className="mx-add-trigger" style={{ maxWidth: 200 }}>
          <span className="mx-ellipsis">{text}</span>
          {disabled ? null : <SmallChevron />}
        </span>
      }
    />
  );
}

export function LogsForm({
  saved,
  viewer,
  now,
}: {
  saved: LogsConfig;
  viewer: { id: string; name: string; handle: string };
  now: string;
}) {
  const { guildId, channels, roles, timezone } = useGuild();
  const channelName = useChannelName();
  const { value, set, update, readOnly } = useDraft<LogsConfig>();
  const [selected, setSelected] = useState<LogEvent>('messageDelete');
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const routeChannel = (event: LogEvent) =>
    value.routes[event]?.channelId ?? value.defaultChannelId;
  const firstText = channels.find((channel) => channel.type === ChannelType.Text);
  const sampleChannel = firstText ? `#${firstText.name}` : '#general';
  const sampleRole = roles.find((role) => role.id !== guildId && !role.managed)?.name ?? 'Regular';
  const preview = previewOf(selected, viewer, sampleChannel, sampleRole);
  const target = routeChannel(selected);
  const savedTarget = saved.routes[selected]?.enabled
    ? (saved.routes[selected]?.channelId ?? saved.defaultChannelId)
    : null;
  const dirtyRoutes = !sameRoutes(value, saved);

  return (
    <Grid>
      <Panel
        title="Events"
        span={8}
        id="events"
        actions={
          <div style={{ width: 220 }}>
            <ChannelSelect
              label="Default channel"
              none="Choose a default channel"
              placeholder="Default channel"
              value={value.defaultChannelId}
              onChange={(defaultChannelId) =>
                update((previous) => ({
                  ...previous,
                  defaultChannelId,
                  routes: Object.fromEntries(
                    Object.entries(previous.routes).map(([key, route]) => [
                      key,
                      { ...route, channelId: null },
                    ]),
                  ) as LogsConfig['routes'],
                }))
              }
            />
          </div>
        }
      >
        {value.defaultChannelId ? null : (
          <PanelBody>
            <Callout>Pick a default channel to start.</Callout>
          </PanelBody>
        )}
        <div style={{ paddingBottom: 8 }}>
          {groups.map((group) => (
            <div key={group.name} role="group" aria-labelledby={`group-${group.name}`}>
              <div
                id={`group-${group.name}`}
                className="mx-label"
                style={{ padding: '14px 16px 2px', color: 'var(--mx-faint)' }}
              >
                {group.name}
              </div>
              <div>
                {group.events.map((event) => {
                  const route = value.routes[event];
                  const on = route?.enabled ?? true;
                  const name = logEventNames[event];
                  const current = event === selected;
                  return (
                    <div key={event} className="mx-row" style={{ padding: '5px 16px' }}>
                      <button
                        type="button"
                        className="mx-pick"
                        aria-pressed={current}
                        aria-label={`Preview ${name}`}
                        onClick={() => {
                          setSelected(event);
                          setStatus(null);
                        }}
                        style={{
                          ...nameButton,
                          color: on ? 'var(--mx-text)' : 'var(--mx-muted)',
                        }}
                      >
                        {name}
                      </button>
                      <ChannelOverride
                        name={name}
                        value={route?.channelId ?? null}
                        fallback={value.defaultChannelId}
                        muted={!on}
                        disabled={readOnly}
                        onChange={(channelId) =>
                          set({
                            routes: { ...value.routes, [event]: { enabled: on, channelId } },
                          })
                        }
                      />
                      <Switch
                        order
                        checked={on}
                        label={`${name} ${on ? 'on' : 'off'}`}
                        onChange={(enabled) =>
                          set({
                            routes: {
                              ...value.routes,
                              [event]: { enabled, channelId: route?.channelId ?? null },
                            },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mx-s4 mx-stack" style={{ gap: 16, minWidth: 0 }}>
        <Panel title={`Preview: ${logEventNames[selected]}`} id="preview">
          <PanelBody>
            <div className="mx-preview">
              <div className="mx-sub">{target ? channelName(target) : 'No channel yet'}</div>
              <MessagePreview avatarSize={32} time={clock(now, timezone)}>
                <EmbedPreview
                  color={preview.color}
                  author={preview.author}
                  title={preview.title}
                  description={preview.lines.join('\n')}
                  footer={preview.footer}
                />
              </MessagePreview>
            </div>
            {readOnly ? null : (
              <div className="mx-inline">
                <button
                  type="button"
                  className="mx-btn"
                  disabled={pending || !savedTarget || dirtyRoutes}
                  onClick={() =>
                    start(async () => {
                      const result = await runAction(guildId, 'logs', 'test', { event: selected });
                      setStatus(
                        result.ok
                          ? { message: `Sent to ${channelName(savedTarget)}.`, error: false }
                          : { message: result.error, error: true },
                      );
                    })
                  }
                >
                  Send a test
                </button>
                {dirtyRoutes ? (
                  <span className="mx-sub">Save first</span>
                ) : !savedTarget ? (
                  <span className="mx-sub">
                    {saved.routes[selected]?.enabled ? 'Pick a channel' : 'This event is off'}
                  </span>
                ) : null}
                <StatusText status={status} />
              </div>
            )}
          </PanelBody>
        </Panel>

        <Panel title="Ignore" id="ignore">
          <PanelBody>
            <div className="mx-field">
              <span className="mx-label">Channels</span>
              <ChannelMulti
                kinds={ignoreKinds}
                value={value.ignoredChannelIds}
                onChange={(ignoredChannelIds) =>
                  set({ ignoredChannelIds: ignoredChannelIds.slice(0, 100) })
                }
              />
            </div>
            <div className="mx-field">
              <span className="mx-label">Roles</span>
              <RoleMulti
                value={value.ignoredRoleIds}
                onChange={(ignoredRoleIds) => set({ ignoredRoleIds: ignoredRoleIds.slice(0, 50) })}
              />
            </div>
            <ToggleRow
              order
              title="Ignore bots"
              checked={value.ignoreBots}
              onChange={(ignoreBots) => set({ ignoreBots })}
            />
          </PanelBody>
        </Panel>
      </div>
    </Grid>
  );
}
