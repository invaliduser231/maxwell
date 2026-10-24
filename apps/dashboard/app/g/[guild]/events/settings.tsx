'use client';

import type { EventsConfig } from '@maxwell/core/modules/events';
import {
  ChannelSelect,
  NumberInput,
  Select,
  TextInput,
  TimezoneSelect,
  ToggleRow,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useDraft } from '@/components/module-shell';
import { Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { minutesLabel } from '@/lib/time';

const lengths = [30, 60, 90, 120, 180, 240, 1440];

const reminders = [
  { value: '0', label: 'Off' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

const pollLengths = [
  { value: '60', label: '1 hour' },
  { value: '1440', label: '24 hours' },
  { value: '4320', label: '3 days' },
  { value: '10080', label: '7 days' },
  { value: '43200', label: '30 days' },
  { value: '0', label: 'No end' },
];

function withCurrent(
  options: { value: string; label: string }[],
  value: string,
  label: string,
): { value: string; label: string }[] {
  return options.some((option) => option.value === value)
    ? options
    : [...options, { value, label }];
}

export function SettingsTab() {
  const { value, set } = useDraft<EventsConfig>();
  const { timezone } = useGuild();
  const length = String(value.defaultDurationMinutes);
  const reminder = String(value.reminderMinutes);
  const pollLength = String(value.pollDurationMinutes);

  return (
    <Grid>
      <Panel title="Events" span={6} id="events-settings">
        <PanelBody>
          <Fields>
            <Field label="Announce in">
              <ChannelSelect
                value={value.channelId}
                none="Pick a channel"
                onChange={(channelId) => set({ channelId })}
              />
            </Field>
            <Field label="Timezone">
              <TimezoneSelect
                value={value.timezone}
                none={`Same as General (${timezone.replaceAll('_', ' ')})`}
                onChange={(next) => set({ timezone: next })}
              />
            </Field>
            <Field label="Default length">
              <Select
                value={length}
                options={withCurrent(
                  lengths.map((minutes) => ({
                    value: String(minutes),
                    label: minutesLabel(minutes),
                  })),
                  length,
                  minutesLabel(value.defaultDurationMinutes),
                )}
                onChange={(next) => set({ defaultDurationMinutes: Number(next) })}
              />
            </Field>
            <Field label="Reminder DM">
              <Select
                value={reminder}
                options={withCurrent(reminders, reminder, `${reminder} minutes before`)}
                onChange={(next) => set({ reminderMinutes: Number(next) })}
              />
            </Field>
          </Fields>
          <div className="mx-field">
            <span className="mx-label">RSVP reactions</span>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}
            >
              <TextInput
                label="Going reaction"
                value={value.rsvp.going}
                maxLength={80}
                onChange={(going) => set({ rsvp: { ...value.rsvp, going } })}
              />
              <TextInput
                label="Maybe reaction"
                value={value.rsvp.maybe}
                maxLength={80}
                onChange={(maybe) => set({ rsvp: { ...value.rsvp, maybe } })}
              />
              <TextInput
                label="Can't reaction"
                value={value.rsvp.no}
                maxLength={80}
                onChange={(no) => set({ rsvp: { ...value.rsvp, no } })}
              />
            </div>
          </div>
          <Field label="Reward for everyone going">
            <NumberInput
              value={value.rewardAmount}
              min={0}
              max={1_000_000}
              onChange={(next) =>
                set({ rewardAmount: Math.min(1_000_000, Math.max(0, Math.round(next))) })
              }
            />
          </Field>
        </PanelBody>
      </Panel>
      <Panel title="Polls" span={6} id="polls-settings">
        <PanelBody>
          <Fields>
            <Field label="Post polls in">
              <ChannelSelect
                value={value.pollChannelId}
                none="Same as events"
                onChange={(pollChannelId) => set({ pollChannelId })}
              />
            </Field>
            <Field label="Default length">
              <Select
                value={pollLength}
                options={withCurrent(pollLengths, pollLength, `${pollLength} minutes`)}
                onChange={(next) => set({ pollDurationMinutes: Number(next) })}
              />
            </Field>
          </Fields>
          <ToggleRow
            title="Result image when a poll ends"
            checked={value.pollResultImage}
            onChange={(pollResultImage) => set({ pollResultImage })}
          />
          <ToggleRow
            title="Vote receipts by DM"
            sub="For anonymous polls"
            checked={value.voteReceipts}
            onChange={(voteReceipts) => set({ voteReceipts })}
          />
        </PanelBody>
      </Panel>
    </Grid>
  );
}
