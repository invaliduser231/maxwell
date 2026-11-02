'use client';

import {
  COUNTER_LIMIT,
  type Counter,
  type CountersConfig,
  type CounterType,
  counterName,
  counterTypes,
} from '@maxwell/core/modules/counters';
import {
  AddPicker,
  NumberInput,
  Select,
  TextInput,
  useChannelOptions,
} from '@/components/controls';
import { ChannelType, useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { CloseIcon, Empty, Grid, Panel } from '@/components/ui';
import type { Key } from '@/lib/i18n';

const KINDS = [ChannelType.Voice, ChannelType.Category, ChannelType.Text];

const labels: Record<CounterType, Key> = {
  members: 'Members',
  online: 'Online',
  goal: 'Member goal',
  voice: 'In voice',
  channels: 'Channels',
  roles: 'Roles',
  countdown: 'Countdown',
};

const templates: Record<CounterType, string> = {
  members: 'Members: {count}',
  online: 'Online: {count}',
  goal: 'Goal: {count} / {goal}',
  voice: 'In voice: {count}',
  channels: 'Channels: {count}',
  roles: 'Roles: {count}',
  countdown: '{count} days to go',
};

const sample = {
  members: 1234,
  online: 87,
  voice: 6,
  channels: 24,
  roles: 12,
};

function inMonth(): string {
  const date = new Date(Date.now() + 30 * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function retype(item: Counter, type: CounterType): Counter {
  const template = item.template === templates[item.type] ? templates[type] : item.template;
  return {
    ...item,
    type,
    template,
    goal: type === 'goal' ? (item.goal ?? 1000) : null,
    until: type === 'countdown' ? (item.until ?? inMonth()) : null,
  };
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

export function CountersForm() {
  const t = useT();
  const { value, update, readOnly } = useDraft<CountersConfig>();
  const { channels, timezone } = useGuild();
  const channelOptions = useChannelOptions(KINDS);
  const available = channelOptions.filter(
    (option) => !value.counters.some((item) => item.channelId === option.value),
  );
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  const typeOptions = counterTypes.map((type) => ({ value: type, label: t(labels[type]) }));

  const setItem = (index: number, next: Counter) =>
    update((previous) => ({
      ...previous,
      counters: previous.counters.map((item, at) => (at === index ? next : item)),
    }));

  const picker =
    readOnly || available.length === 0 || value.counters.length >= COUNTER_LIMIT ? null : (
      <AddPicker
        label={t('Add counter')}
        options={available}
        onPick={(channelId) =>
          update((previous) => ({
            ...previous,
            counters: [
              ...previous.counters,
              {
                channelId,
                type: 'members',
                template: templates.members,
                goal: null,
                until: null,
              },
            ],
          }))
        }
      />
    );

  if (value.counters.length === 0) {
    return (
      <Grid>
        <Panel id="c-list">
          <Empty mood="sleeping">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>{t('No counters yet.')}</span>
              <span className="mx-sub">
                {t('{command} creates a locked voice channel for one.', {
                  command: 'm!counter add members',
                })}
              </span>
              {picker}
            </div>
          </Empty>
        </Panel>
      </Grid>
    );
  }

  return (
    <Grid>
      <Panel title={t('Counters')} id="c-list" actions={picker}>
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">{t('Channel')}</th>
                <th scope="col">{t('Counts')}</th>
                <th scope="col">{t('Name')}</th>
                <th scope="col">{t('Preview')}</th>
                <th scope="col">
                  <span className="mx-sr">{t('Remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {value.counters.map((item, index) => {
                const channel = channels.find((entry) => entry.id === item.channelId);
                const name = channel?.name ?? t('Deleted channel');
                const preview = counterName(item, { ...sample, today }) ?? '';
                return (
                  <tr key={item.channelId}>
                    <td>{name}</td>
                    <td style={{ minWidth: 180 }}>
                      <div className="mx-stack">
                        <Select
                          label={t('What {name} counts', { name })}
                          value={item.type}
                          options={typeOptions}
                          onChange={(type) => setItem(index, retype(item, type))}
                        />
                        {item.type === 'goal' ? (
                          <NumberInput
                            label={t('Goal')}
                            value={item.goal ?? 1000}
                            min={1}
                            max={100_000_000}
                            onChange={(goal) => setItem(index, { ...item, goal })}
                          />
                        ) : null}
                        {item.type === 'countdown' ? (
                          <input
                            className="mx-input"
                            type="date"
                            aria-label={t('Date')}
                            value={item.until ?? ''}
                            readOnly={readOnly}
                            onChange={(event) =>
                              setItem(index, { ...item, until: event.target.value || null })
                            }
                          />
                        ) : null}
                      </div>
                    </td>
                    <td style={{ minWidth: 200 }}>
                      <TextInput
                        label={t('Name of {name}', { name })}
                        value={item.template}
                        maxLength={100}
                        onChange={(template) => setItem(index, { ...item, template })}
                      />
                    </td>
                    <td className="mx-sub">{preview}</td>
                    <td style={{ width: 48, textAlign: 'right' }}>
                      {readOnly ? null : (
                        <RemoveButton
                          label={t('Remove {name}', { name })}
                          onClick={() =>
                            update((previous) => ({
                              ...previous,
                              counters: previous.counters.filter((_, at) => at !== index),
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
        <p className="mx-sub" style={{ padding: '0 20px 16px' }}>
          {t('Use {count} for the number. Goals also know {goal} and {left}.')}
        </p>
      </Panel>
    </Grid>
  );
}
