'use client';

import type { TicketPanel, TicketPanelKind, TicketsConfig } from '@maxwell/core/modules/tickets';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  ChannelSelect,
  RoleMulti,
  Seg,
  Select,
  TextArea,
  TextInput,
  ToggleRow,
} from '@/components/controls';
import { ChannelType, useChannelName, useGuild } from '@/components/guild';
import { EmbedPreview, Markdown, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import {
  Callout,
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
import { padNumber } from './format';

export interface Published {
  panelId: string;
  channelId: string;
}

const kinds: { value: TicketPanelKind; label: string }[] = [
  { value: 'support', label: 'Support' },
  { value: 'report', label: 'Report' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'custom', label: 'Custom' },
];

const panelDefaults: Record<TicketPanelKind, string> = {
  support: 'Need help? React with {emoji} to open a ticket.',
  report: 'Something wrong in here? React with {emoji}. Only the team sees your ticket.',
  appeal: 'Want a decision looked at again? React with {emoji} to open an appeal.',
  custom: 'React with {emoji} to open a ticket.',
};

const openDefaults: Record<TicketPanelKind, string> = {
  support: 'Tell us what you need. The team will be with you shortly.',
  report: 'Tell us what happened and who was involved. Message links help.',
  appeal: 'Tell us which decision you want reviewed and why.',
  custom: 'The team will be with you shortly.',
};

const limits = [1, 2, 3, 5, 10].map((n) => ({
  value: String(n),
  label: n === 1 ? '1 open ticket' : `${n} open tickets`,
}));

const CATEGORY = [ChannelType.Category];

function slug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function freshId(name: string, taken: string[]): string {
  const base = slug(name) || 'panel';
  if (!taken.includes(base) && base !== 'modmail') return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

function newPanel(name: string, panels: TicketPanel[]): TicketPanel {
  return {
    id: freshId(
      name,
      panels.map((panel) => panel.id),
    ),
    kind: 'support',
    name,
    channelId: null,
    categoryId: null,
    teamRoleIds: [],
    pingTeam: true,
    emoji: '',
    title: '',
    description: '',
    openMessage: '',
    channelName: '{panel}-{number}',
    maxOpenPerMember: 1,
  };
}

function cleanName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 90);
}

export function channelPreview(template: string, panelName: string, user: string): string {
  const filled = template
    .replaceAll('{panel}', cleanName(panelName))
    .replaceAll('{number}', padNumber(219))
    .replaceAll('{user}', user);
  return cleanName(filled) || 'ticket-0219';
}

function EnvelopeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-label="Envelope" role="img">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2.5"
        fill="none"
        stroke="#C9CCD2"
        strokeWidth="2"
      />
      <path d="M4 7l8 6 8-6" fill="none" stroke="#C9CCD2" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Lock" role="img">
      <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="#C9CCD2" strokeWidth="2.2" />
      <rect x="5" y="11" width="14" height="10" rx="2.5" fill="#C9CCD2" />
    </svg>
  );
}

function emojiMarkup(emoji: string): string {
  const trimmed = emoji.trim();
  const bare = /^:?([\w~-]+):(\d+):?$/.exec(trimmed);
  return bare ? `<:${bare[1]}:${bare[2]}>` : trimmed;
}

function EmojiMark({ emoji }: { emoji: string }) {
  if (!emoji.trim()) return <EnvelopeIcon />;
  return <Markdown text={emojiMarkup(emoji)} as="span" />;
}

function PanelList({
  selected,
  onSelect,
  published,
}: {
  selected: number;
  onSelect: (index: number) => void;
  published: Published[];
}) {
  const { value, update, readOnly } = useDraft<TicketsConfig>();
  const { roles } = useGuild();
  const channelName = useChannelName();

  const add = () => {
    const panel = newPanel(value.panels.length === 0 ? 'Support' : 'New panel', value.panels);
    update((previous) => ({ ...previous, panels: [...previous.panels, panel] }));
    onSelect(value.panels.length);
  };

  return (
    <Panel
      title="Panels"
      span={7}
      id="t-panels"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn mx-btn-primary"
            disabled={value.panels.length >= 10}
            onClick={add}
          >
            New panel
          </button>
        )
      }
    >
      {value.panels.map((panel, index) => {
        const team = roles.find((role) => role.id === panel.teamRoleIds[0]);
        const live = published.find((entry) => entry.panelId === panel.id);
        const detail = [
          panel.channelId ? channelName(panel.channelId) : 'No channel',
          panel.categoryId ? channelName(panel.categoryId).replace(/^#/, '') : 'No category',
          live ? 'posted' : 'not posted',
        ].join(', ');
        return (
          <div key={panel.id} className="mx-row">
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={index === selected}
              onClick={() => onSelect(index)}
            >
              <span className="mx-row-title mx-ellipsis">{panel.name}</span>
              <span className="mx-sub mx-ellipsis">{detail}</span>
            </button>
            {team ? (
              <span className="mx-chip">
                <span className="mx-dot" style={{ background: roleColor(team.color) }} />
                {team.name}
                {panel.teamRoleIds.length > 1 ? ` +${panel.teamRoleIds.length - 1}` : ''}
              </span>
            ) : (
              <span className="mx-sub">No team role</span>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function usePanel(index: number) {
  const { value, update, readOnly } = useDraft<TicketsConfig>();
  const panel = value.panels[index];
  const patch = (next: Partial<TicketPanel>) =>
    update((previous) => ({
      ...previous,
      panels: previous.panels.map((entry, position) =>
        position === index ? { ...entry, ...next } : entry,
      ),
    }));
  return { panel, patch, readOnly, update };
}

function PanelSetup({
  index,
  saved,
  published,
}: {
  index: number;
  saved: TicketsConfig;
  published: Published[];
}) {
  const { panel, patch, readOnly } = usePanel(index);
  const { guildId } = useGuild();
  const channelName = useChannelName();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!status || status.error) return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [status, router]);

  if (!panel) {
    return (
      <Panel title="Panel" span={5} id="t-setup">
        <Empty>Pick a panel.</Empty>
      </Panel>
    );
  }

  const where = panel.channelId ? channelName(panel.channelId) : 'No channel';
  const live = published.find((entry) => entry.panelId === panel.id);
  const stored = saved.panels.find((entry) => entry.id === panel.id);
  const unsaved = !stored || JSON.stringify(stored) !== JSON.stringify(panel);
  const description = panel.description || panelDefaults[panel.kind];

  const run = (action: 'panel.publish' | 'panel.remove', done: string) =>
    start(async () => {
      const result = await runAction(guildId, 'tickets', action, { panelId: panel.id });
      setStatus(
        result.ok ? { message: done, error: false } : { message: result.error, error: true },
      );
    });

  return (
    <Panel
      title={panel.name}
      span={5}
      id="t-setup"
      actions={<span className="mx-sub">in {where}</span>}
    >
      <PanelBody>
        <Fields>
          <Field label="Channel">
            <ChannelSelect value={panel.channelId} onChange={(channelId) => patch({ channelId })} />
          </Field>
          <Field label="Ticket category">
            <ChannelSelect
              value={panel.categoryId}
              kinds={CATEGORY}
              none="No category"
              onChange={(categoryId) => patch({ categoryId })}
            />
          </Field>
          <Field label="Limit per member">
            <Select
              value={String(panel.maxOpenPerMember)}
              options={
                limits.some((entry) => entry.value === String(panel.maxOpenPerMember))
                  ? limits
                  : [
                      ...limits,
                      {
                        value: String(panel.maxOpenPerMember),
                        label: `${panel.maxOpenPerMember} open tickets`,
                      },
                    ]
              }
              onChange={(next) => patch({ maxOpenPerMember: Number(next) })}
            />
          </Field>
          <Field label="Emoji">
            <TextInput
              value={panel.emoji}
              maxLength={80}
              placeholder="Envelope"
              onChange={(emoji) => patch({ emoji: emoji.trim() })}
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">Team roles</span>
          <RoleMulti
            value={panel.teamRoleIds}
            onChange={(teamRoleIds) => patch({ teamRoleIds: teamRoleIds.slice(0, 10) })}
          />
        </div>
        <ToggleRow
          title="Ping the team"
          sub="When a ticket opens"
          checked={panel.pingTeam}
          onChange={(pingTeam) => patch({ pingTeam })}
        />
        <div className="mx-preview">
          <MessagePreview>
            <EmbedPreview
              color="#F26B3A"
              title={panel.title || panel.name}
              description={description}
              vars={panel.emoji.trim() ? { emoji: emojiMarkup(panel.emoji) } : undefined}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="mx-chip">
                <EmojiMark emoji={panel.emoji} /> 1
              </span>
            </div>
          </MessagePreview>
        </div>
        {readOnly ? null : (
          <div className="mx-inline">
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              disabled={pending || unsaved || !panel.channelId}
              onClick={() => run('panel.publish', live ? 'Updating.' : 'Posting.')}
            >
              {live && live.channelId === panel.channelId ? 'Update post' : `Post to ${where}`}
            </button>
            {live ? (
              <TwoStep
                label="Remove post"
                danger
                disabled={pending}
                run={() => run('panel.remove', 'Removing.')}
              />
            ) : null}
            {unsaved && !status ? <span className="mx-sub">Save to post</span> : null}
            <StatusText status={status} />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function PanelText({ index, onRemoved }: { index: number; onRemoved: () => void }) {
  const { panel, patch, readOnly, update } = usePanel(index);
  if (!panel) return null;
  return (
    <Panel
      title="Text"
      span={7}
      id="t-text"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            onClick={() => {
              update((previous) => ({
                ...previous,
                panels: previous.panels.filter((_, position) => position !== index),
              }));
              onRemoved();
            }}
          >
            Delete panel
          </button>
        )
      }
    >
      <PanelBody>
        <Fields>
          <Field label="Name">
            <TextInput value={panel.name} maxLength={80} onChange={(name) => patch({ name })} />
          </Field>
          <Field label="Title">
            <TextInput
              value={panel.title}
              maxLength={256}
              placeholder={panel.name}
              onChange={(title) => patch({ title })}
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">Kind</span>
          <Seg
            label="Kind"
            value={panel.kind}
            options={kinds}
            onChange={(kind) => patch({ kind })}
          />
        </div>
        <Field label="Panel text">
          <TextArea
            value={panel.description}
            rows={2}
            maxLength={2000}
            placeholder={panelDefaults[panel.kind]}
            onChange={(description) => patch({ description })}
          />
        </Field>
        <Field label="First message in the ticket" hint="{user} {server} {number}">
          <TextArea
            value={panel.openMessage}
            rows={2}
            maxLength={2000}
            placeholder={openDefaults[panel.kind]}
            onChange={(openMessage) => patch({ openMessage })}
          />
        </Field>
        <Field
          label="Channel name"
          hint={
            <>
              Preview:{' '}
              <span className="mx-mono">
                {channelPreview(panel.channelName, panel.name, 'noor')}
              </span>
            </>
          }
        >
          <TextInput
            value={panel.channelName}
            maxLength={90}
            mono
            onChange={(channelName) => patch({ channelName })}
          />
        </Field>
      </PanelBody>
    </Panel>
  );
}

const NOOR = { user: '@Noor', number: '219' };

function OpeningPreview({ index }: { index: number }) {
  const { panel } = usePanel(index);
  const { roles } = useGuild();
  if (!panel) return null;
  const pings = panel.pingTeam
    ? panel.teamRoleIds
        .map((id) => roles.find((role) => role.id === id))
        .filter((role) => role !== undefined)
    : [];
  return (
    <Panel
      title="New ticket"
      span={5}
      id="t-opening"
      actions={
        <span className="mx-sub">#{channelPreview(panel.channelName, panel.name, 'noor')}</span>
      }
    >
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview
            content={['{user}', ...pings.map((role) => `<@&${role.id}>`)].join(' ')}
            vars={NOOR}
          >
            <EmbedPreview
              color="#F26B3A"
              title={`${panel.name} #${padNumber(219)}`}
              description={panel.openMessage || openDefaults[panel.kind]}
              vars={NOOR}
            >
              <span
                className="mx-sub"
                style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
              >
                React with <LockIcon /> to close.
              </span>
            </EmbedPreview>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="mx-chip">
                <LockIcon /> 1
              </span>
            </div>
          </MessagePreview>
        </div>
        {panel.teamRoleIds.length === 0 ? (
          <Callout tone="warn">No team role yet. Only admins will see these tickets.</Callout>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function FirstPanel() {
  const { value, update, readOnly } = useDraft<TicketsConfig>();
  const add = () => {
    const panel = newPanel('Support', value.panels);
    update((previous) => ({ ...previous, panels: [...previous.panels, panel] }));
  };
  return (
    <Panel id="t-panels">
      <Empty mood="thinking">
        <div className="mx-stack" style={{ alignItems: 'center' }}>
          <span>No panels yet. Members open tickets from one.</span>
          {readOnly ? null : (
            <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
              New panel
            </button>
          )}
        </div>
      </Empty>
    </Panel>
  );
}

export function PanelsTab({ saved, published }: { saved: TicketsConfig; published: Published[] }) {
  const { value } = useDraft<TicketsConfig>();
  const [selected, setSelected] = useState(0);
  if (value.panels.length === 0) return <FirstPanel />;
  return (
    <Grid>
      <Column span={7}>
        <PanelList selected={selected} onSelect={setSelected} published={published} />
        <PanelText index={selected} onRemoved={() => setSelected(0)} />
      </Column>
      <Column span={5}>
        <PanelSetup index={selected} saved={saved} published={published} />
        <OpeningPreview index={selected} />
      </Column>
    </Grid>
  );
}
