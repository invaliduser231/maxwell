'use client';

import type { EventsConfig } from '@maxwell/core/modules/events';
import { POLL_OPTION_LIMIT } from '@maxwell/core/stores/events';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ChannelSelect, Select, ToggleRow } from '@/components/controls';
import { useChannelName, useGuild } from '@/components/guild';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { CloseIcon, Empty, Field, Fields, Panel, PanelBody } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import { runAction } from '@/lib/actions';
import { createPoll, deleteDraftPoll, pollStatus } from './actions';
import type { PollView } from './events-view';

const SAMPLE = [41, 63, 88, 29, 12, 7, 18, 9, 22, 5];

const durations = [
  { value: '60', label: '1 hour' },
  { value: '1440', label: '24 hours' },
  { value: '4320', label: '3 days' },
  { value: '10080', label: '7 days' },
  { value: '43200', label: '30 days' },
  { value: '0', label: 'No end' },
];

const stateLabels: Record<PollView['status'], string> = {
  draft: 'Not posted',
  open: 'Running',
  closed: 'Ended',
  cancelled: 'Cancelled',
};

interface Option {
  key: string;
  text: string;
}

function freshKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function blank(count: number): Option[] {
  return Array.from({ length: count }, () => ({ key: freshKey(), text: '' }));
}

function durationText(minutes: number): string {
  if (minutes === 0) return 'no end';
  const match = durations.find((entry) => entry.value === String(minutes));
  if (match) return `ends in ${match.label}`;
  if (minutes % 1440 === 0) return `ends in ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `ends in ${minutes / 60} hours`;
  return `ends in ${minutes} minutes`;
}

function percents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((value) => (value / total) * 100);
  const floored = raw.map(Math.floor);
  let left = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floored[index] = (floored[index] ?? 0) + 1;
    left--;
  }
  return floored;
}

function ResultCard({
  question,
  options,
  anonymous,
  multiple,
  minutes,
}: {
  question: string;
  options: Option[];
  anonymous: boolean;
  multiple: boolean;
  minutes: number;
}) {
  const votes = options.map((_, index) => SAMPLE[index] ?? 5);
  const total = votes.reduce((sum, value) => sum + value, 0);
  const max = Math.max(0, ...votes);
  const shares = percents(votes);
  return (
    <Panel
      title="Result card"
      id="polls-card"
      actions={<span className="mx-sub">Sample votes</span>}
    >
      <PanelBody>
        <div
          className="mx-inset"
          style={{
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 20,
                overflowWrap: 'anywhere',
              }}
            >
              {question.trim() || 'Your question'}
            </span>
            <span className="mx-sub" style={{ whiteSpace: 'nowrap' }}>
              {`${total} votes`}
            </span>
          </div>
          {options.map(({ key, text }, index) => {
            const top = votes[index] === max;
            return (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ fontWeight: top ? 600 : 400, overflowWrap: 'anywhere' }}>
                    {text.trim() || `Option ${index + 1}`}
                  </span>
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                    {`${shares[index] ?? 0}%`}
                  </span>
                </div>
                <div className="mx-bar" style={{ height: 10 }}>
                  <span
                    style={{
                      width: `${shares[index] ?? 0}%`,
                      background: top ? '#F26B3A' : '#4A4A55',
                    }}
                  />
                </div>
              </div>
            );
          })}
          <span className="mx-sub">
            {`${anonymous ? 'Anonymous' : 'Public'} poll, ${multiple ? 'multiple choice' : 'one choice'}, ${durationText(minutes)}`}
          </span>
        </div>
      </PanelBody>
    </Panel>
  );
}

function Recent({ polls }: { polls: PollView[] }) {
  const { guildId } = useGuild();
  const readOnly = useReadOnly();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const act = (run: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const result = await run();
      if (!result.ok) {
        setStatus({ message: result.error ?? 'That did not work.', error: true });
        return;
      }
      setStatus({ message: done, error: false });
      setTimeout(() => router.refresh(), 2000);
    });

  return (
    <Panel title="Recent polls" id="polls-recent" actions={<StatusText status={status} />}>
      {polls.length === 0 ? (
        <Empty mood="sleeping">No polls yet.</Empty>
      ) : (
        polls.map((poll) => {
          const votes = poll.counts.reduce((sum, value) => sum + value, 0);
          const max = Math.max(0, ...poll.counts);
          const leaders = poll.options.filter((_, index) => poll.counts[index] === max);
          const detail =
            poll.status === 'draft'
              ? 'Not posted'
              : poll.status === 'open'
                ? `${votes} ${votes === 1 ? 'vote' : 'votes'} so far`
                : votes === 0
                  ? 'No votes'
                  : leaders.length === 1
                    ? `${votes} ${votes === 1 ? 'vote' : 'votes'}, ${leaders[0]} ${poll.status === 'closed' ? 'won' : 'led'}`
                    : `${votes} votes, a tie`;
          return (
            <div key={poll.id} className="mx-row">
              <div className="mx-row-main">
                <span className="mx-row-title" style={{ overflowWrap: 'anywhere' }}>
                  <span className="mx-mono mx-muted">#{poll.number}</span> {poll.question}
                </span>
                <span className="mx-sub">{detail}</span>
              </div>
              <span className="mx-chip">{stateLabels[poll.status]}</span>
              {readOnly ? null : poll.status === 'open' ? (
                <TwoStep
                  ghost
                  label="End now"
                  disabled={pending}
                  run={() =>
                    act(
                      () => runAction(guildId, 'events', 'poll.close', { pollId: poll.id }),
                      'Ending the poll.',
                    )
                  }
                />
              ) : poll.status === 'draft' ? (
                <TwoStep
                  ghost
                  label="Delete"
                  disabled={pending}
                  run={() => act(() => deleteDraftPoll(guildId, poll.id), 'Deleted.')}
                />
              ) : null}
            </div>
          );
        })
      )}
    </Panel>
  );
}

export function PollsTab({ polls, enabled }: { polls: PollView[]; enabled: boolean }) {
  const { guildId } = useGuild();
  const { value: config } = useDraft<EventsConfig>();
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  const router = useRouter();
  const poll = usePoll();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<Option[]>(() => blank(2));
  const [channelId, setChannelId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(config.pollDurationMinutes);
  const [anonymous, setAnonymous] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [waiting, setWaiting] = useState(false);
  const [pending, start] = useTransition();
  const fallback = config.pollChannelId ?? config.channelId;
  const minuteValue = String(minutes);
  const ready =
    question.trim() !== '' &&
    options.length >= 2 &&
    options.every((option) => option.text.trim() !== '') &&
    Boolean(channelId ?? fallback);

  const post = () =>
    start(async () => {
      setStatus(null);
      const result = await createPoll(guildId, {
        question,
        options: options.map((option) => option.text),
        anonymous,
        multiple,
        channelId,
        durationMinutes: minutes,
      });
      if (!result.ok || !result.data) {
        setStatus({ message: result.ok ? 'That did not work.' : result.error, error: true });
        return;
      }
      const id = result.data.id;
      setWaiting(true);
      setStatus({ message: 'Posting.', error: false });
      poll(
        async () => {
          const found = await pollStatus(guildId, id);
          if (!found.ok) {
            setWaiting(false);
            setStatus({ message: found.error, error: true });
            return true;
          }
          if (found.data === 'draft') return false;
          setWaiting(false);
          setStatus({ message: 'Posted.', error: false });
          setQuestion('');
          setOptions(blank(2));
          router.refresh();
          return true;
        },
        () => {
          setWaiting(false);
          setStatus({
            message: enabled
              ? 'Not posted. Check the channel and my permissions there.'
              : 'Not posted while Events and polls is off.',
            error: true,
          });
          router.refresh();
        },
      );
    });

  return (
    <div className="mx-grid">
      <Panel
        title="New poll"
        span={6}
        id="polls-new"
        actions={
          readOnly ? null : (
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              disabled={!ready || pending || waiting}
              onClick={post}
            >
              Post
            </button>
          )
        }
      >
        <PanelBody>
          <Field label="Question" aside={`${question.length} / 250`}>
            <input
              className="mx-input"
              value={question}
              maxLength={250}
              readOnly={readOnly}
              placeholder="What should the next theme be?"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </Field>
          <div className="mx-field">
            <span className="mx-label">Options</span>
            {options.map((option, index) => (
              <div key={option.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="mx-mono mx-muted" style={{ width: 16 }}>
                  {index + 1}
                </span>
                <input
                  className="mx-input"
                  aria-label={`Option ${index + 1}`}
                  value={option.text}
                  maxLength={100}
                  readOnly={readOnly}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((entry) =>
                        entry.key === option.key ? { ...entry, text: event.target.value } : entry,
                      ),
                    )
                  }
                />
                {readOnly || options.length <= 2 ? null : (
                  <button
                    type="button"
                    className="mx-btn mx-btn-ghost"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() =>
                      setOptions((current) => current.filter((entry) => entry.key !== option.key))
                    }
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            ))}
            {readOnly || options.length >= POLL_OPTION_LIMIT ? null : (
              <button
                type="button"
                className="mx-btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setOptions((current) => [...current, ...blank(1)])}
              >
                Add option
              </button>
            )}
          </div>
          <Fields>
            <Field label="Channel">
              <ChannelSelect
                value={channelId}
                none={fallback ? `Default (${channelName(fallback)})` : 'Pick a channel'}
                onChange={setChannelId}
              />
            </Field>
            <Field label="Ends">
              <Select
                value={minuteValue}
                options={
                  durations.some((entry) => entry.value === minuteValue)
                    ? durations
                    : [...durations, { value: minuteValue, label: `${minutes} minutes` }]
                }
                onChange={(next) => setMinutes(Number(next))}
              />
            </Field>
          </Fields>
          <ToggleRow title="Anonymous votes" checked={anonymous} onChange={setAnonymous} />
          <ToggleRow title="Allow more than one choice" checked={multiple} onChange={setMultiple} />
          <StatusText status={status} />
        </PanelBody>
      </Panel>
      <div className="mx-s6" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ResultCard
          question={question}
          options={options}
          anonymous={anonymous}
          multiple={multiple}
          minutes={minutes}
        />
        <Recent polls={polls} />
      </div>
    </div>
  );
}
