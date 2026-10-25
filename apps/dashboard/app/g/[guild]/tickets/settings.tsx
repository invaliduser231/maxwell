'use client';

import type { TicketModmail, TicketsConfig } from '@maxwell/core/modules/tickets';
import { useRef } from 'react';
import {
  ChannelSelect,
  RoleMulti,
  Select,
  Switch,
  TextArea,
  TextInput,
  ToggleRow,
} from '@/components/controls';
import { ChannelType, useGuild } from '@/components/guild';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';

const CATEGORY = [ChannelType.Category];

const idleOptions = [
  { value: '0', label: 'Never' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
  { value: '72', label: '3 days' },
  { value: '168', label: '7 days' },
];

const delayOptions = [
  { value: '0', label: 'Right away' },
  { value: '10', label: '10 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '300', label: '5 minutes' },
];

function withCurrent(options: { value: string; label: string }[], current: number, unit: string) {
  return options.some((option) => option.value === String(current))
    ? options
    : [...options, { value: String(current), label: `${current} ${unit}` }];
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 32);
}

function SwitchRow({
  title,
  sub,
  checked,
  onChange,
}: {
  title: string;
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mx-row">
      <div className="mx-row-main">
        <span className="mx-row-title">{title}</span>
        {sub ? <span className="mx-sub">{sub}</span> : null}
      </div>
      <Switch label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

function Behavior() {
  const { value, set } = useDraft<TicketsConfig>();
  const modmail = (patch: Partial<TicketModmail>) =>
    set({ modmail: { ...value.modmail, ...patch } });
  return (
    <Panel title="Behavior" span={7} id="t-behavior">
      <SwitchRow
        title="Modmail"
        sub="DMs to Maxwell open a ticket"
        checked={value.modmail.enabled}
        onChange={(enabled) => modmail({ enabled })}
      />
      <SwitchRow
        title="Web transcripts"
        sub="A private link to the full conversation"
        checked={value.transcripts}
        onChange={(transcripts) => set({ transcripts })}
      />
      <SwitchRow
        title="Ask for a rating"
        sub="After a ticket closes"
        checked={value.ratingEnabled}
        onChange={(ratingEnabled) => set({ ratingEnabled })}
      />
      <SwitchRow
        title="Members can close their own ticket"
        checked={value.openerCanClose}
        onChange={(openerCanClose) => set({ openerCanClose })}
      />
      <SwitchRow
        title="Delete the channel after closing"
        checked={value.deleteOnClose}
        onChange={(deleteOnClose) => set({ deleteOnClose })}
      />
      <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
        <Fields>
          <Field label="Close after inactivity">
            <Select
              value={String(value.autoCloseHours)}
              options={withCurrent(idleOptions, value.autoCloseHours, 'hours')}
              onChange={(next) => set({ autoCloseHours: Number(next) })}
            />
          </Field>
          <Field label={value.deleteOnClose ? 'Delete after closing' : 'Archive after closing'}>
            <Select
              value={String(value.closeDelaySeconds)}
              options={withCurrent(delayOptions, value.closeDelaySeconds, 'seconds')}
              onChange={(next) => set({ closeDelaySeconds: Number(next) })}
            />
          </Field>
          <Field label="Ticket log">
            <ChannelSelect
              value={value.logChannelId}
              onChange={(logChannelId) => set({ logChannelId })}
            />
          </Field>
          <Field label="Saved reply prefix">
            <TextInput
              value={value.cannedPrefix}
              maxLength={3}
              mono
              onChange={(cannedPrefix) => set({ cannedPrefix: cannedPrefix.trim() })}
            />
          </Field>
        </Fields>
      </div>
    </Panel>
  );
}

function Modmail() {
  const { value, set } = useDraft<TicketsConfig>();
  const { guildName } = useGuild();
  const modmail = value.modmail;
  const patch = (next: Partial<TicketModmail>) => set({ modmail: { ...modmail, ...next } });
  return (
    <Panel
      title="Modmail"
      span={5}
      id="t-modmail"
      actions={<span className="mx-sub">{modmail.enabled ? 'DM to Maxwell' : 'Off'}</span>}
    >
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview
            name="Noor"
            bot={false}
            avatarSize={30}
            content="Someone keeps sending me weird links after I joined"
          />
          <MessagePreview
            content="Sent to the **{server}** team. Replies show up here."
            vars={{ server: guildName }}
          />
        </div>
        <Fields>
          <Field label="Ticket category">
            <ChannelSelect
              value={modmail.categoryId}
              kinds={CATEGORY}
              none="No category"
              onChange={(categoryId) => patch({ categoryId })}
            />
          </Field>
          <Field label="Internal note marker">
            <TextInput
              value={modmail.internalMarker}
              maxLength={5}
              mono
              onChange={(internalMarker) => patch({ internalMarker: internalMarker.trim() })}
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">Team roles</span>
          <RoleMulti
            value={modmail.teamRoleIds}
            onChange={(teamRoleIds) => patch({ teamRoleIds: teamRoleIds.slice(0, 10) })}
          />
        </div>
        <ToggleRow
          title="Ping the team"
          checked={modmail.pingTeam}
          onChange={(pingTeam) => patch({ pingTeam })}
        />
        <ToggleRow
          title="Hide staff names"
          sub="Replies come from the team"
          checked={modmail.anonymous}
          onChange={(anonymous) => patch({ anonymous })}
        />
        <Field label="First message in the ticket">
          <TextArea
            value={modmail.openMessage}
            rows={2}
            maxLength={2000}
            placeholder="New modmail. Messages here go to the member by DM."
            onChange={(openMessage) => patch({ openMessage })}
          />
        </Field>
      </PanelBody>
    </Panel>
  );
}

function SavedReplies() {
  const { value, set, readOnly } = useDraft<TicketsConfig>();
  const replies = value.cannedReplies;
  const names = replies.map((reply) => reply.name);
  const keys = useRef<string[]>([]);
  while (keys.current.length < replies.length) {
    keys.current.push(Math.random().toString(36).slice(2, 10));
  }
  if (keys.current.length > replies.length) keys.current.length = replies.length;
  const patch = (index: number, next: Partial<(typeof replies)[number]>) =>
    set({
      cannedReplies: replies.map((reply, at) => (at === index ? { ...reply, ...next } : reply)),
    });
  const add = () => {
    let n = replies.length + 1;
    while (names.includes(`reply-${n}`)) n++;
    set({ cannedReplies: [...replies, { name: `reply-${n}`, content: '' }] });
  };
  return (
    <Panel
      title="Saved replies"
      span={12}
      id="t-replies"
      actions={
        readOnly ? null : (
          <button type="button" className="mx-btn" disabled={replies.length >= 50} onClick={add}>
            Add reply
          </button>
        )
      }
    >
      {replies.length === 0 ? (
        <Empty>No saved replies yet.</Empty>
      ) : (
        replies.map((reply, index) => {
          const duplicate = names.indexOf(reply.name) !== index;
          return (
            <div className="mx-row" key={keys.current[index]} style={{ alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 180,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <input
                  className="mx-input mx-mono"
                  aria-label={`Name of reply ${index + 1}`}
                  value={reply.name}
                  maxLength={32}
                  readOnly={readOnly}
                  onChange={(event) => patch(index, { name: slug(event.target.value) })}
                />
                <span className={duplicate ? 'mx-status mx-status-error' : 'mx-hint'}>
                  {duplicate ? 'Name taken' : `${value.cannedPrefix}${reply.name}`}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextArea
                  value={reply.content}
                  rows={2}
                  maxLength={2000}
                  label={`Text of ${reply.name}`}
                  placeholder="Hi {user}, ..."
                  onChange={(content) => patch(index, { content })}
                />
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  aria-label={`Remove ${reply.name}`}
                  onClick={() => {
                    keys.current.splice(index, 1);
                    set({ cannedReplies: replies.filter((_, at) => at !== index) });
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })
      )}
    </Panel>
  );
}

export function SettingsTab() {
  return (
    <Grid>
      <Behavior />
      <Modmail />
      <SavedReplies />
    </Grid>
  );
}
