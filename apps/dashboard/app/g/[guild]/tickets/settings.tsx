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
import { useT } from '@/components/i18n';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import type { Translator } from '@/lib/i18n';

const CATEGORY = [ChannelType.Category];

const idleHours = [0, 24, 48, 72, 168];
const delaySeconds = [0, 10, 30, 60, 300];

function idleLabel(t: Translator, hours: number): string {
  if (hours === 0) return t('Never');
  if (hours % 24 === 0 && hours > 48)
    return t('{n, plural, one {# day} other {# days}}', { n: hours / 24 });
  return t('{n, plural, one {# hour} other {# hours}}', { n: hours });
}

function delayLabel(t: Translator, seconds: number): string {
  if (seconds === 0) return t('Right away');
  if (seconds % 60 === 0)
    return t('{n, plural, one {# minute} other {# minutes}}', { n: seconds / 60 });
  return t('{n, plural, one {# second} other {# seconds}}', { n: seconds });
}

function withCurrent(
  t: Translator,
  values: number[],
  current: number,
  label: (t: Translator, value: number) => string,
) {
  const list = values.includes(current) ? values : [...values, current];
  return list.map((value) => ({ value: String(value), label: label(t, value) }));
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
  const t = useT();
  const { guildId } = useGuild();
  const { value, set } = useDraft<TicketsConfig>();
  const modmail = (patch: Partial<TicketModmail>) =>
    set({ modmail: { ...value.modmail, ...patch } });
  return (
    <Panel title={t('Behavior')} span={7} id="t-behavior">
      <SwitchRow
        title="Modmail"
        sub={t('DMs to Maxwell open a ticket')}
        checked={value.modmail.enabled}
        onChange={(enabled) => modmail({ enabled })}
      />
      <SwitchRow
        title={t('Web form')}
        sub={value.webForm ? `/support/${guildId}` : t('Members open tickets on a web page')}
        checked={value.webForm}
        onChange={(webForm) => set({ webForm })}
      />
      <SwitchRow
        title={t('Web transcripts')}
        sub={t('A private link to the full conversation')}
        checked={value.transcripts}
        onChange={(transcripts) => set({ transcripts })}
      />
      <SwitchRow
        title={t('Ask for a rating')}
        sub={t('After a ticket closes')}
        checked={value.ratingEnabled}
        onChange={(ratingEnabled) => set({ ratingEnabled })}
      />
      <SwitchRow
        title={t('Members can close their own ticket')}
        checked={value.openerCanClose}
        onChange={(openerCanClose) => set({ openerCanClose })}
      />
      <SwitchRow
        title={t('Delete the channel after closing')}
        checked={value.deleteOnClose}
        onChange={(deleteOnClose) => set({ deleteOnClose })}
      />
      <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
        <Fields>
          <Field label={t('Close after inactivity')}>
            <Select
              value={String(value.autoCloseHours)}
              options={withCurrent(t, idleHours, value.autoCloseHours, idleLabel)}
              onChange={(next) => set({ autoCloseHours: Number(next) })}
            />
          </Field>
          <Field
            label={value.deleteOnClose ? t('Delete after closing') : t('Archive after closing')}
          >
            <Select
              value={String(value.closeDelaySeconds)}
              options={withCurrent(t, delaySeconds, value.closeDelaySeconds, delayLabel)}
              onChange={(next) => set({ closeDelaySeconds: Number(next) })}
            />
          </Field>
          <Field label={t('Ticket log')}>
            <ChannelSelect
              value={value.logChannelId}
              onChange={(logChannelId) => set({ logChannelId })}
            />
          </Field>
          <Field label={t('Saved reply prefix')}>
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
  const t = useT();
  const { value, set } = useDraft<TicketsConfig>();
  const { guildName } = useGuild();
  const modmail = value.modmail;
  const patch = (next: Partial<TicketModmail>) => set({ modmail: { ...modmail, ...next } });
  return (
    <Panel
      title="Modmail"
      span={5}
      id="t-modmail"
      actions={<span className="mx-sub">{modmail.enabled ? t('DM to Maxwell') : t('Off')}</span>}
    >
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview
            name="Noor"
            bot={false}
            avatarSize={30}
            content={t('Someone keeps sending me weird links after I joined')}
          />
          <MessagePreview
            content={t('Sent to the **{server}** team. Replies show up here.')}
            vars={{ server: guildName }}
          />
        </div>
        <Fields>
          <Field label={t('Ticket category')}>
            <ChannelSelect
              value={modmail.categoryId}
              kinds={CATEGORY}
              none={t('No category')}
              onChange={(categoryId) => patch({ categoryId })}
            />
          </Field>
          <Field label={t('Internal note marker')}>
            <TextInput
              value={modmail.internalMarker}
              maxLength={5}
              mono
              onChange={(internalMarker) => patch({ internalMarker: internalMarker.trim() })}
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">{t('Team roles')}</span>
          <RoleMulti
            bots
            value={modmail.teamRoleIds}
            onChange={(teamRoleIds) => patch({ teamRoleIds: teamRoleIds.slice(0, 10) })}
          />
        </div>
        <ToggleRow
          title={t('Ping the team')}
          checked={modmail.pingTeam}
          onChange={(pingTeam) => patch({ pingTeam })}
        />
        <ToggleRow
          title={t('Hide staff names')}
          sub={t('Replies come from the team')}
          checked={modmail.anonymous}
          onChange={(anonymous) => patch({ anonymous })}
        />
        <Field label={t('First message in the ticket')}>
          <TextArea
            value={modmail.openMessage}
            rows={2}
            maxLength={2000}
            placeholder={t('New modmail. Messages here go to the member by DM.')}
            onChange={(openMessage) => patch({ openMessage })}
          />
        </Field>
      </PanelBody>
    </Panel>
  );
}

function SavedReplies() {
  const t = useT();
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
      title={t('Saved replies')}
      span={12}
      id="t-replies"
      actions={
        readOnly ? null : (
          <button type="button" className="mx-btn" disabled={replies.length >= 50} onClick={add}>
            {t('Add reply')}
          </button>
        )
      }
    >
      {replies.length === 0 ? (
        <Empty>{t('No saved replies yet.')}</Empty>
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
                  aria-label={t('Name of reply {number}', { number: index + 1 })}
                  value={reply.name}
                  maxLength={32}
                  readOnly={readOnly}
                  onChange={(event) => patch(index, { name: slug(event.target.value) })}
                />
                <span className={duplicate ? 'mx-status mx-status-error' : 'mx-hint'}>
                  {duplicate ? t('Name taken') : `${value.cannedPrefix}${reply.name}`}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextArea
                  value={reply.content}
                  rows={2}
                  maxLength={2000}
                  label={t('Text of {name}', { name: reply.name })}
                  placeholder={t('Hi {user}, ...')}
                  onChange={(content) => patch(index, { content })}
                />
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  aria-label={t('Remove {name}', { name: reply.name })}
                  onClick={() => {
                    keys.current.splice(index, 1);
                    set({ cannedReplies: replies.filter((_, at) => at !== index) });
                  }}
                >
                  {t('Remove')}
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
