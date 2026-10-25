'use client';

import type { VoiceConfig, VoiceLobby } from '@maxwell/core/modules/voice';
import { useState } from 'react';
import { ChannelSelect, NumberInput, Switch, TextInput } from '@/components/controls';
import { ChannelType, useGuild } from '@/components/guild';
import { useDraft } from '@/components/module-shell';
import { Chip, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';

export interface OpenRoom {
  channelId: string;
  lobbyId: string;
  owner: string;
  members: number;
  locked: boolean;
  openFor: string;
}

function Speaker({ size = 18, color = '#3A9EEA' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M4 9h3l4-3v12l-4-3H4zM15 9a4 4 0 0 1 0 6"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function roomName(template: string, vars: { name: string; username: string; n: number }): string {
  const values: Record<string, string> = {
    name: vars.name,
    username: vars.username,
    n: String(vars.n),
  };
  const text = template
    .replace(/\{([a-z]+)\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
  return [...(text || 'Voice room')].slice(0, 100).join('');
}

export function VoiceForm({
  rooms,
  prefix,
  viewer,
}: {
  rooms: OpenRoom[];
  prefix: string;
  viewer: { name: string; username: string };
}) {
  const { channels } = useGuild();
  const { value, set, update, readOnly } = useDraft<VoiceConfig>();
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(value.lobbies.length - 1, 0));
  const lobby = value.lobbies[index] ?? null;

  const channelOf = (id: string | null | undefined) =>
    id ? channels.find((channel) => channel.id === id) : undefined;
  const nameOf = (id: string | null | undefined) =>
    id ? (channelOf(id)?.name ?? 'Deleted channel') : '';
  const categoryOf = (entry: VoiceLobby) => {
    const id = entry.categoryId ?? channelOf(entry.channelId)?.parentId ?? null;
    return id ? nameOf(id) : 'No category';
  };
  const voiceChannels = channels.filter((channel) => channel.type === ChannelType.Voice);
  const free = voiceChannels.find(
    (channel) => !value.lobbies.some((entry) => entry.channelId === channel.id),
  );
  const openIn = (id: string) => rooms.filter((room) => room.lobbyId === id).length;

  const patch = (next: Partial<VoiceLobby>) =>
    update((previous) => ({
      ...previous,
      lobbies: previous.lobbies.map((entry, position) =>
        position === index ? { ...entry, ...next } : entry,
      ),
    }));

  const add = () => {
    if (!free) return;
    update((previous) => ({
      ...previous,
      lobbies: [
        ...previous.lobbies,
        { channelId: free.id, categoryId: null, nameTemplate: "{name}'s room", userLimit: 0 },
      ],
    }));
    setSelected(value.lobbies.length);
  };

  const remove = () => {
    update((previous) => ({
      ...previous,
      lobbies: previous.lobbies.filter((_, position) => position !== index),
    }));
    setSelected(Math.max(index - 1, 0));
  };

  const preview = lobby
    ? roomName(lobby.nameTemplate, { name: viewer.name, username: viewer.username, n: 1 })
    : '';

  const commands = [
    { cmd: 'room', what: 'show the owner' },
    { cmd: 'room name Late night', what: 'rename' },
    { cmd: 'room limit 4', what: 'set a limit' },
    { cmd: 'room lock', what: 'lock' },
    { cmd: 'room unlock', what: 'unlock' },
    { cmd: 'room transfer @member', what: 'hand over' },
  ];

  const owners = (
    <Panel title="Owners" span={4} id="vc-cmd">
      <Row title="Owner manages the room">
        <Switch
          order
          label="Owner manages the room"
          checked={value.ownerPermissions}
          onChange={(ownerPermissions) => set({ ownerPermissions })}
        />
      </Row>
      <Row title="Hand over when the owner leaves">
        <Switch
          order
          label="Hand over when the owner leaves"
          checked={value.transferOnLeave}
          onChange={(transferOnLeave) => set({ transferOnLeave })}
        />
      </Row>
      <Row title="Rooms at once">
        <div style={{ width: 96 }}>
          <NumberInput
            label="Rooms at once"
            value={value.maxRooms}
            min={1}
            max={200}
            onChange={(maxRooms) => set({ maxRooms })}
          />
        </div>
      </Row>
      <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
        <span className="mx-label">Commands</span>
        <div
          className="mx-inset"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: '8px 12px',
            padding: '12px 14px',
            alignItems: 'baseline',
          }}
        >
          {commands.map((command) => (
            <div key={command.cmd} style={{ display: 'contents' }}>
              <span className="mx-mono mx-ellipsis" style={{ fontSize: 13 }}>
                {prefix}
                {command.cmd}
              </span>
              <span className="mx-sub">{command.what}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );

  if (value.lobbies.length === 0 && rooms.length === 0) {
    return (
      <Grid>
        <Panel span={8} id="vc-hubs">
          <Empty mood="sleeping">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>No create channels yet.</span>
              {readOnly ? null : (
                <button
                  type="button"
                  className="mx-btn mx-btn-primary"
                  disabled={!free}
                  onClick={add}
                >
                  Add create channel
                </button>
              )}
              {!readOnly && !free ? (
                <span className="mx-sub">Make a voice channel first</span>
              ) : null}
            </div>
          </Empty>
        </Panel>
        {owners}
      </Grid>
    );
  }

  return (
    <Grid>
      <Panel
        title="Create channels"
        span={5}
        id="vc-hubs"
        actions={
          readOnly ? null : (
            <button type="button" className="mx-btn" disabled={!free} onClick={add}>
              Add
            </button>
          )
        }
      >
        {value.lobbies.length === 0 ? (
          <Empty mood="sleeping">No create channels yet.</Empty>
        ) : (
          value.lobbies.map((entry, position) => (
            <div key={entry.channelId} className="mx-row">
              <Speaker />
              <button
                type="button"
                className="mx-pick mx-row-main"
                aria-pressed={position === index}
                onClick={() => setSelected(position)}
              >
                <span className="mx-row-title">{nameOf(entry.channelId)}</span>
                <span className="mx-sub">
                  into {categoryOf(entry)}, {openIn(entry.channelId)} open now
                </span>
              </button>
            </div>
          ))
        )}
      </Panel>

      {lobby ? (
        <Panel
          title={nameOf(lobby.channelId)}
          span={7}
          id="vc-edit"
          actions={
            readOnly ? null : (
              <button type="button" className="mx-btn mx-btn-ghost" onClick={remove}>
                Remove
              </button>
            )
          }
        >
          <PanelBody>
            <Fields>
              <Field label="Join channel">
                <ChannelSelect
                  value={lobby.channelId}
                  kinds={[ChannelType.Voice]}
                  none={null}
                  onChange={(channelId) => {
                    if (
                      channelId &&
                      !value.lobbies.some((entry) => entry.channelId === channelId)
                    ) {
                      patch({ channelId });
                    }
                  }}
                />
              </Field>
              <Field label="Create rooms in">
                <ChannelSelect
                  value={lobby.categoryId}
                  kinds={[ChannelType.Category]}
                  none="Same as the join channel"
                  onChange={(categoryId) => patch({ categoryId })}
                />
              </Field>
              <Field label="Name" hint="{name}, {username}, {n}">
                <TextInput
                  value={lobby.nameTemplate}
                  maxLength={100}
                  onChange={(nameTemplate) => patch({ nameTemplate })}
                />
              </Field>
              <Field label="Member limit" hint="0 for no limit">
                <NumberInput
                  value={lobby.userLimit}
                  min={0}
                  max={99}
                  onChange={(userLimit) => patch({ userLimit })}
                />
              </Field>
            </Fields>
            <div className="mx-preview" role="group" aria-label="Preview of a new room">
              <div className="mx-sub">{categoryOf(lobby)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <Speaker size={16} color="#9A9EA6" />
                <span style={{ flex: 1, minWidth: 0 }} className="mx-ellipsis">
                  {preview}
                </span>
                <span className="mx-sub">
                  {lobby.userLimit > 0 ? `0 / ${lobby.userLimit}` : 'No limit'}
                </span>
              </div>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel
        title="Open rooms"
        span={8}
        id="vc-open"
        actions={rooms.length > 0 ? <span className="mx-sub">{rooms.length} right now</span> : null}
      >
        {rooms.length === 0 ? (
          <Empty mood="sleeping">Nobody is in a room right now.</Empty>
        ) : (
          <div className="mx-scroll">
            <table className="mx-table">
              <thead>
                <tr>
                  <th scope="col">Room</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Members</th>
                  <th scope="col">Open for</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.channelId}>
                    <td>{nameOf(room.channelId)}</td>
                    <td>{room.owner}</td>
                    <td>{room.members}</td>
                    <td className="mx-muted">{room.openFor}</td>
                    <td>
                      <Chip>{room.locked ? 'Locked' : 'Open'}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {owners}
    </Grid>
  );
}
