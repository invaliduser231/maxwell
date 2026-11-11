'use client';

import type { GameKey, GamesConfig, TriviaQuestion } from '@maxwell/core/modules/games';
import { useState, useTransition } from 'react';
import {
  ChannelMulti,
  ChannelSelect,
  OptionalNumber,
  Select,
  Switch,
  TextInput,
} from '@/components/controls';
import { useChannelName, useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { Listbox } from '@/components/listbox';
import { MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { outcome, type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Avatar, Column, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { runAction } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';
import { Section, Tile, Tiles } from '../economy/bits';

export interface BoardRow {
  userId: string;
  name: string;
  avatar: string | null;
  game: GameKey;
  wins: number;
  plays: number;
  best: number;
}

interface ChannelView {
  channelId: string;
  game: GameKey;
  current: number;
  highScore: number;
  lastWord: string | null;
}

interface EconomyView {
  on: boolean;
  symbol: string;
  name: string;
  perWin: number;
}

type ConfigKey = 'trivia' | 'counting' | 'wordchain' | 'higherLower' | 'coinflip';

const list: { key: GameKey; config: ConfigKey; name: Key }[] = [
  { key: 'trivia', config: 'trivia', name: 'Trivia' },
  { key: 'counting', config: 'counting', name: 'Counting' },
  { key: 'wordchain', config: 'wordchain', name: 'Word chain' },
  { key: 'higherlower', config: 'higherLower', name: 'Higher or lower' },
  { key: 'coinflip', config: 'coinflip', name: 'Coinflip duels' },
];

const gameNames: Record<GameKey, Key> = {
  trivia: 'Trivia',
  counting: 'Counting',
  wordchain: 'Word chain',
  higherlower: 'Higher or lower',
  coinflip: 'Coinflip',
};

const SLOTS = ['a', 'b', 'c', 'd'] as const;

const seconds = [10, 15, 20, 30, 45, 60, 90, 120, 180, 300];

function secondsLabel(t: Translator, n: number): string {
  if (n >= 60 && n % 60 === 0)
    return t('{n, plural, one {# minute} other {# minutes}}', { n: n / 60 });
  return t('{count} seconds', { count: n });
}

function SecondsSelect({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  const t = useT();
  const options = seconds.filter((n) => n >= min && n <= max);
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <Select
      label={label}
      value={String(value)}
      options={all.map((n) => ({ value: String(n), label: secondsLabel(t, n) }))}
      onChange={(next) => onChange(Number(next))}
    />
  );
}

function RightMark({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {on ? (
        <>
          <circle cx="10" cy="10" r="9" fill="var(--mx-success)" />
          <path
            d="M6 10.3l2.6 2.6L14 7.6"
            fill="none"
            stroke="#17171B"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

function AnswerRow({
  index,
  right,
  value,
  onMark,
  onChange,
}: {
  index: number;
  right: boolean;
  value: string;
  onMark: () => void;
  onChange: (next: string) => void;
}) {
  const t = useT();
  return (
    <div
      className={right ? 'mx-inset' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderRadius: 'var(--mx-radius-sm)',
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={right}
        aria-label={t('Answer {number} is right', { number: index + 1 })}
        title={right ? t('Right answer') : t('Mark as right')}
        onClick={onMark}
        style={{
          width: 36,
          height: 36,
          padding: 0,
          border: 0,
          borderRadius: 'var(--mx-radius-sm)',
          background: 'transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          color: 'var(--mx-faint)',
        }}
      >
        <RightMark on={right} />
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'grid' }}>
        <TextInput
          label={t('Answer {number}', { number: index + 1 })}
          value={value}
          maxLength={100}
          placeholder={right ? t('Right answer') : t('Wrong answer')}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function Chat({ name, color, text }: { name: string; color: string; text: string }) {
  return (
    <MessagePreview
      name={name}
      bot={false}
      avatarSize={28}
      content={text}
      icon={
        <span
          className="mx-avatar"
          aria-hidden="true"
          style={{ width: 28, height: 28, fontSize: 12, background: color }}
        >
          {name.slice(0, 1)}
        </span>
      }
    />
  );
}

function ResetChannel({ game, label }: { game: 'counting' | 'wordchain'; label: string }) {
  const { guildId } = useGuild();
  const t = useT();
  const readOnly = useReadOnly();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  if (readOnly) return null;
  return (
    <div className="mx-inline">
      <TwoStep
        label={label}
        danger
        disabled={pending}
        run={() =>
          start(async () => {
            const result = await runAction(guildId, 'games', 'resetChannel', { game });
            setStatus(outcome(result, t('Resetting.')));
          })
        }
      />
      <StatusText status={status} />
    </div>
  );
}

function shuffleIn(right: string, wrong: string[]): string[] {
  const at = Math.floor(Math.random() * (wrong.length + 1));
  return [...wrong.slice(0, at), right, ...wrong.slice(at)];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function questionsFromCsv(text: string): TriviaQuestion[] {
  return parseCsv(text)
    .map((cells) => cells.map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 2 && cells[0]?.toLowerCase() !== 'question')
    .map((cells) => {
      const [question = '', answer = '', ...wrong] = cells;
      return {
        question: question.slice(0, 300),
        answers: [answer.slice(0, 100)],
        choices:
          wrong.length > 0
            ? shuffleIn(
                answer.slice(0, 100),
                wrong.slice(0, 5).map((choice) => choice.slice(0, 100)),
              )
            : [],
      };
    });
}

function TriviaEditor({ economy }: { economy: EconomyView }) {
  const { guildId } = useGuild();
  const t = useT();
  const { value, set, readOnly } = useDraft<GamesConfig>();
  const trivia = value.trivia;
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState(['', '', '', '']);
  const [right, setRight] = useState(0);
  const [all, setAll] = useState(false);
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const questions = trivia.questions;
  const shown = all ? questions : questions.slice(-6);
  const full = questions.length >= 500;
  const text = question.trim();
  const filled = answers.map((answer) => answer.trim());
  const choices = filled.filter(Boolean);
  const correct = filled[right] ?? '';
  const questionError = text ? null : t('Write a question first.');
  const answerError =
    choices.length === 0
      ? t('Add the right answer.')
      : choices.length > 1 && !correct
        ? t('The answer marked as right is empty.')
        : null;

  const add = () => {
    setTried(true);
    if (questionError || answerError) return;
    const next: TriviaQuestion =
      choices.length === 1
        ? { question: text, answers: [choices[0] as string], choices: [] }
        : { question: text, answers: [correct], choices };
    set({ trivia: { ...trivia, questions: [...questions, next] } });
    setQuestion('');
    setAnswers(['', '', '', '']);
    setRight(0);
    setTried(false);
    setStatus({ message: t('Added. Save to keep it.'), error: false });
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = questionsFromCsv(String(reader.result));
      const room = 500 - questions.length;
      const added = parsed.slice(0, Math.max(room, 0));
      if (added.length === 0) {
        setStatus({ message: t('No questions found in that file.'), error: true });
        return;
      }
      set({ trivia: { ...trivia, questions: [...questions, ...added] } });
      setStatus({
        message: t(
          '{n, plural, one {# question added. Save to keep it.} other {# questions added. Save to keep them.}}',
          { n: added.length },
        ),
        error: false,
      });
    };
    reader.readAsText(file);
  };

  return (
    <>
      <PanelBody>
        <Fields>
          <Field label={t('Time per question')}>
            <SecondsSelect
              label={t('Time per question')}
              value={trivia.answerSeconds}
              min={10}
              max={300}
              onChange={(answerSeconds) => set({ trivia: { ...trivia, answerSeconds } })}
            />
          </Field>
          <div className="mx-field">
            <span className="mx-label">{t('Reward per right answer')}</span>
            <div className="mx-between" style={{ minHeight: 36 }}>
              <span>
                {economy.on && economy.perWin > 0
                  ? `${t.count(economy.perWin)} ${economy.symbol}`
                  : t('No reward')}
              </span>
              <a className="mx-btn mx-btn-ghost" href={`/g/${guildId}/economy`}>
                {t('Economy')}
              </a>
            </div>
          </div>
        </Fields>
      </PanelBody>
      <Section
        title={t('Questions')}
        aside={t('{n, plural, one {# question} other {# questions}}', { n: questions.length })}
      />
      {questions.length === 0 ? <Empty mood="thinking">{t('No questions yet.')}</Empty> : null}
      {shown.map((entry) => {
        const index = questions.indexOf(entry);
        return (
          <Row
            key={`${index}-${entry.question}`}
            title={entry.question}
            sub={
              entry.choices.length > 0
                ? t('{answer}, out of {count} choices', {
                    answer: entry.answers[0] ?? '',
                    count: entry.choices.length,
                  })
                : entry.answers.join(', ')
            }
          >
            {readOnly ? null : (
              <button
                type="button"
                className="mx-btn mx-btn-ghost"
                aria-label={t('Remove {name}', { name: entry.question })}
                onClick={() =>
                  set({
                    trivia: { ...trivia, questions: questions.filter((_, i) => i !== index) },
                  })
                }
              >
                {t('Remove')}
              </button>
            )}
          </Row>
        );
      })}
      {questions.length > 6 ? (
        <div className="mx-row">
          <button type="button" className="mx-btn mx-btn-ghost" onClick={() => setAll(!all)}>
            {all ? t('Show fewer') : t('Show all {count}', { count: questions.length })}
          </button>
        </div>
      ) : null}
      {readOnly ? null : (
        <>
          <Section title={t('New question')} />
          <PanelBody>
            <div className="mx-field">
              <TextInput
                label={t('New question')}
                placeholder={t('Question')}
                value={question}
                maxLength={300}
                onChange={setQuestion}
              />
              {tried && questionError ? (
                <span className="mx-field-error">{questionError}</span>
              ) : null}
            </div>
            <div className="mx-field">
              <span className="mx-label">{t('Answers')}</span>
              <div
                role="radiogroup"
                aria-label={t('Right answer')}
                style={{ display: 'grid', gap: 6 }}
              >
                {SLOTS.map((slot, i) => (
                  <AnswerRow
                    key={slot}
                    index={i}
                    right={right === i}
                    value={answers[i] ?? ''}
                    onMark={() => setRight(i)}
                    onChange={(next) =>
                      setAnswers(answers.map((entry, j) => (j === i ? next : entry)))
                    }
                  />
                ))}
              </div>
              {tried && answerError ? <span className="mx-field-error">{answerError}</span> : null}
            </div>
            <div className="mx-inline">
              <button type="button" className="mx-btn mx-btn-primary" disabled={full} onClick={add}>
                {t('Add question')}
              </button>
              <label className="mx-btn">
                {t('Import CSV')}
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="mx-sr"
                  disabled={full}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importFile(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <StatusText status={status} />
            </div>
          </PanelBody>
        </>
      )}
    </>
  );
}

function CountingEditor({
  state,
  top,
  economy,
}: {
  state: ChannelView | null;
  top: BoardRow | null;
  economy: EconomyView;
}) {
  const t = useT();
  const { value, set } = useDraft<GamesConfig>();
  const counting = value.counting;
  const at = state?.current ?? 0;

  return (
    <PanelBody>
      {state || top ? (
        <Tiles>
          <Tile label={t('Current count')} value={t.count(at)} />
          <Tile label={t('Record')} value={t.count(state?.highScore ?? 0)} />
          <Tile label={t('Counted most')} value={top ? `${top.name}, ${t.count(top.wins)}` : '0'} />
        </Tiles>
      ) : null}
      <Fields>
        <Field label={t('Channel')} hint={t('Math counts too, like sqrt(16) or 2*3.')}>
          <ChannelSelect
            value={counting.channelId}
            none={t('Pick a channel')}
            onChange={(channelId) => set({ counting: { ...counting, channelId } })}
          />
        </Field>
        <Field label={t('Wrong number')}>
          <Select
            value={counting.resetOnMistake ? 'reset' : 'keep'}
            options={[
              { value: 'reset', label: t('Back to 1') },
              { value: 'keep', label: t('Keep going') },
            ]}
            onChange={(next) =>
              set({ counting: { ...counting, resetOnMistake: next === 'reset' } })
            }
          />
        </Field>
        <Field label={t('Same person twice in a row')}>
          <Select
            value={counting.allowSameUser ? 'yes' : 'no'}
            options={[
              { value: 'no', label: t('Not allowed') },
              { value: 'yes', label: t('Allowed') },
            ]}
            onChange={(next) => set({ counting: { ...counting, allowSameUser: next === 'yes' } })}
          />
        </Field>
        <Field label={t('Reward every')}>
          <OptionalNumber
            integer
            label={t('Reward every')}
            value={counting.rewardEvery > 0 ? counting.rewardEvery : null}
            placeholder={t('Off')}
            min={1}
            onChange={(next) =>
              set({ counting: { ...counting, rewardEvery: Math.min(100_000, next ?? 0) } })
            }
          />
        </Field>
      </Fields>
      <div className="mx-preview">
        <Chat name="Max" color="#E8B23A" text={String(at + 1)} />
        <Chat name="Kai" color="#2EB67D" text={String(at + 3)} />
        <MessagePreview
          avatarSize={28}
          content={
            counting.resetOnMistake
              ? t('Kai broke the count at {number}. Next number is 1.', { number: at + 1 })
              : t("Kai, that's not it.")
          }
        />
        {counting.rewardEvery > 0 && economy.on && economy.perWin > 0 ? (
          <MessagePreview
            avatarSize={28}
            content={t('{number}. +{amount} {symbol} for Max.', {
              number: counting.rewardEvery,
              amount: economy.perWin,
              symbol: economy.symbol,
            })}
          />
        ) : null}
      </div>
      {state ? <ResetChannel game="counting" label={t('Reset count')} /> : null}
    </PanelBody>
  );
}

function WordchainEditor({ state }: { state: ChannelView | null }) {
  const t = useT();
  const { value, set } = useDraft<GamesConfig>();
  const words = value.wordchain;

  return (
    <PanelBody>
      {state ? (
        <Tiles>
          <Tile label={t('Chain')} value={t.count(state.current)} />
          <Tile label={t('Record')} value={t.count(state.highScore)} />
          {state.lastWord ? <Tile label={t('Last word')} value={state.lastWord} /> : null}
        </Tiles>
      ) : null}
      <Fields>
        <Field label={t('Channel')}>
          <ChannelSelect
            value={words.channelId}
            none={t('Pick a channel')}
            onChange={(channelId) => set({ wordchain: { ...words, channelId } })}
          />
        </Field>
        <Field label={t('Minimum length')}>
          <OptionalNumber
            integer
            label={t('Minimum length')}
            value={words.minLength}
            placeholder="3"
            min={1}
            onChange={(next) =>
              set({ wordchain: { ...words, minLength: Math.min(20, next ?? 1) } })
            }
          />
        </Field>
        <Field label={t('Words can repeat')}>
          <Select
            value={words.allowRepeat ? 'yes' : 'no'}
            options={[
              { value: 'no', label: t('Never') },
              { value: 'yes', label: t('Yes') },
            ]}
            onChange={(next) => set({ wordchain: { ...words, allowRepeat: next === 'yes' } })}
          />
        </Field>
        <Field label={t('Same person twice in a row')}>
          <Select
            value={words.allowSameUser ? 'yes' : 'no'}
            options={[
              { value: 'no', label: t('Not allowed') },
              { value: 'yes', label: t('Allowed') },
            ]}
            onChange={(next) => set({ wordchain: { ...words, allowSameUser: next === 'yes' } })}
          />
        </Field>
        <Field label={t('Wrong word')}>
          <Select
            value={words.resetOnMistake ? 'reset' : 'keep'}
            options={[
              { value: 'reset', label: t('Chain starts over') },
              { value: 'keep', label: t('Ignore it') },
            ]}
            onChange={(next) => set({ wordchain: { ...words, resetOnMistake: next === 'reset' } })}
          />
        </Field>
      </Fields>
      <div className="mx-preview">
        <Chat name="Lena" color="#3A9EEA" text={t('magnet')} />
        <Chat name="Tom" color="#B48CF2" text={t('tangent')} />
        <Chat name="Ada" color="#F26B3A" text={t('tiger')} />
      </div>
      {state ? <ResetChannel game="wordchain" label={t('Reset chain')} /> : null}
    </PanelBody>
  );
}

function HiloEditor({ prefix }: { prefix: string }) {
  const t = useT();
  const { value, set } = useDraft<GamesConfig>();
  const hilo = value.higherLower;
  return (
    <PanelBody>
      <Fields>
        <Field label={t('Highest number')}>
          <OptionalNumber
            integer
            label={t('Highest number')}
            value={hilo.max}
            placeholder="100"
            min={10}
            onChange={(next) =>
              set({ higherLower: { ...hilo, max: Math.min(1_000, Math.max(10, next ?? 100)) } })
            }
          />
        </Field>
        <Field label={t('House edge (%)')}>
          <OptionalNumber
            integer
            label={t('House edge (%)')}
            value={Math.round(hilo.edge * 100)}
            placeholder="0"
            onChange={(next) =>
              set({ higherLower: { ...hilo, edge: Math.min(50, next ?? 0) / 100 } })
            }
          />
        </Field>
        <Field label={t('Highest multiplier')}>
          <OptionalNumber
            integer
            label={t('Highest multiplier')}
            value={hilo.maxMultiplier}
            placeholder="10"
            min={1}
            onChange={(next) =>
              set({ higherLower: { ...hilo, maxMultiplier: Math.min(100, next ?? 1) } })
            }
          />
        </Field>
        <Field label={t('Time to answer')}>
          <SecondsSelect
            label={t('Time to answer')}
            value={hilo.timeoutSeconds}
            min={15}
            max={600}
            onChange={(timeoutSeconds) => set({ higherLower: { ...hilo, timeoutSeconds } })}
          />
        </Field>
      </Fields>
      <p className="mx-sub" style={{ margin: 0 }}>
        {t('Command:')} <span className="mx-kbd">{`${prefix}higherlower 50`}</span>
      </p>
    </PanelBody>
  );
}

function CoinflipEditor({ prefix }: { prefix: string }) {
  const t = useT();
  const { value, set } = useDraft<GamesConfig>();
  const coinflip = value.coinflip;
  return (
    <PanelBody>
      <Fields>
        <Field label={t('Challenges expire after')}>
          <SecondsSelect
            label={t('Challenges expire after')}
            value={coinflip.expirySeconds}
            min={15}
            max={600}
            onChange={(expirySeconds) => set({ coinflip: { ...coinflip, expirySeconds } })}
          />
        </Field>
      </Fields>
      <p className="mx-sub" style={{ margin: 0 }}>
        {t('Command:')} <span className="mx-kbd">{`${prefix}coinflip @member 100`}</span>
      </p>
    </PanelBody>
  );
}

function BoardSelect({
  value,
  onChange,
}: {
  value: 'all' | GameKey;
  onChange: (next: 'all' | GameKey) => void;
}) {
  const t = useT();
  return (
    <Listbox
      label={t('Game')}
      value={value}
      options={[
        { value: 'all', label: t('All games') },
        ...list.map((game) => ({ value: game.key, label: t(gameNames[game.key]) })),
      ]}
      onChange={(next) => onChange(next as 'all' | GameKey)}
    />
  );
}

function BoardPanel({ board }: { board: Record<string, BoardRow[]> }) {
  const t = useT();
  const [tab, setTab] = useState<'all' | GameKey>('all');
  const rows = board[tab] ?? [];
  const detail = (row: BoardRow) => {
    if (tab === 'all') {
      return `${t(gameNames[row.game])}, ${t('{n, plural, one {# win} other {# wins}}', { n: row.best })}`;
    }
    if (tab === 'higherlower') return t('{count} played', { count: row.plays });
    if (tab === 'counting') return t('Highest {count}', { count: row.best });
    if (tab === 'wordchain') return t('Longest chain {count}', { count: row.best });
    return t('{count} played', { count: row.plays });
  };
  const score = (row: BoardRow) => {
    if (tab === 'higherlower') return t('{count} streak', { count: row.best });
    if (tab === 'counting')
      return t('{n, plural, one {# number} other {# numbers}}', { n: row.wins });
    if (tab === 'wordchain') return t('{n, plural, one {# word} other {# words}}', { n: row.wins });
    return t('{n, plural, one {# win} other {# wins}}', { n: row.wins });
  };

  const played = Object.values(board).some((entries) => entries.length > 0);

  if (!played) {
    return (
      <Panel title={t('Top players')} span={4} id="board">
        <Empty mood="sleeping">{t('Nobody has played yet.')}</Empty>
      </Panel>
    );
  }

  return (
    <Panel
      title={t('Top players')}
      span={4}
      id="board"
      actions={
        <div style={{ width: 170 }}>
          <BoardSelect value={tab} onChange={setTab} />
        </div>
      }
    >
      {rows.length === 0 ? <Empty>{t('Nobody here yet.')}</Empty> : null}
      {rows.map((row, i) => (
        <div key={row.userId} className="mx-row">
          <span className="mx-mono mx-muted" style={{ width: 22 }}>
            {i + 1}
          </span>
          <Avatar src={row.avatar} name={row.name} size={24} />
          <div className="mx-row-main">
            <span className="mx-row-title">{row.name}</span>
            <span className="mx-sub">{detail(row)}</span>
          </div>
          <span className="mx-mono">{score(row)}</span>
        </div>
      ))}
    </Panel>
  );
}

function MoneyPanel({
  economy,
  money,
}: {
  economy: EconomyView;
  money: { rewards: number; staked: number; house: number };
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { value, set } = useDraft<GamesConfig>();
  const stakes = value.stakes;
  const symbol = economy.symbol;

  return (
    <Panel
      title={t('{currency} in games', { currency: economy.name })}
      span={4}
      id="money"
      actions={
        <>
          {economy.on ? null : <span className="mx-sub">{t('Economy is off')}</span>}
          <a className="mx-btn mx-btn-ghost" href={`/g/${guildId}/economy`}>
            {t('Economy')}
          </a>
        </>
      }
    >
      <PanelBody>
        <Fields>
          <Field label={t('Lowest stake ({symbol})', { symbol })}>
            <OptionalNumber
              integer
              label={t('Lowest stake')}
              value={stakes.min}
              placeholder="10"
              min={1}
              onChange={(next) => set({ stakes: { ...stakes, min: next ?? 1 } })}
            />
          </Field>
          <Field label={t('Highest stake ({symbol})', { symbol })}>
            <OptionalNumber
              integer
              label={t('Highest stake')}
              value={stakes.max}
              placeholder="5000"
              min={1}
              onChange={(next) => set({ stakes: { ...stakes, max: next ?? 1 } })}
            />
          </Field>
          <div className="mx-field">
            <span className="mx-label">{t('Reward per win')}</span>
            <span style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
              {economy.perWin > 0 ? `${t.count(economy.perWin)} ${symbol}` : t('Off')}
            </span>
          </div>
        </Fields>
        {money.rewards > 0 || money.staked > 0 || money.house > 0 ? (
          <Tiles>
            <Tile label={t('Rewards, 30 days')} value={`${t.count(money.rewards)} ${symbol}`} />
            <Tile label={t('Staked')} value={`${t.count(money.staked)} ${symbol}`} />
            <Tile label={t('House kept')} value={`${t.count(money.house)} ${symbol}`} />
          </Tiles>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

export function GamesForm({
  prefix,
  board,
  channels,
  economy,
  money,
}: {
  prefix: string;
  board: Record<string, BoardRow[]>;
  channels: ChannelView[];
  economy: EconomyView;
  money: { rewards: number; staked: number; house: number };
}) {
  const t = useT();
  const { value, set } = useDraft<GamesConfig>();
  const channelName = useChannelName();
  const [selected, setSelected] = useState<GameKey>('trivia');
  const current = list.find((game) => game.key === selected) ?? list[0];
  const enabled = (key: ConfigKey) => value[key].enabled;
  const commandWhere =
    value.channelIds.length === 0
      ? t('Every channel')
      : value.channelIds.map((id) => channelName(id)).join(', ');
  const where = (key: GameKey): string => {
    switch (key) {
      case 'trivia':
        return commandWhere;
      case 'counting':
        return value.counting.channelId
          ? channelName(value.counting.channelId)
          : t('No channel yet');
      case 'wordchain':
        return value.wordchain.channelId
          ? channelName(value.wordchain.channelId)
          : t('No channel yet');
      case 'higherlower':
        return `${prefix}higherlower <stake>`;
      case 'coinflip':
        return `${prefix}coinflip @member <stake>`;
    }
  };
  const stateFor = (game: 'counting' | 'wordchain') => {
    const channelId = value[game].channelId;
    return channels.find((state) => state.game === game && state.channelId === channelId) ?? null;
  };
  const active = list.filter((game) => enabled(game.config)).length;

  return (
    <Grid>
      <Column span={4}>
        <Panel
          title={t('Games')}
          span={4}
          id="games"
          actions={<span className="mx-sub">{t('{count} on', { count: active })}</span>}
        >
          {list.map((game) => (
            <div key={game.key} className="mx-row">
              <button
                type="button"
                className="mx-pick mx-row-main"
                aria-pressed={game.key === selected}
                onClick={() => setSelected(game.key)}
              >
                <span className="mx-row-title">{t(game.name)}</span>
                <span className="mx-sub mx-ellipsis">{where(game.key)}</span>
              </button>
              <Switch
                label={
                  enabled(game.config)
                    ? t('{name} on', { name: t(game.name) })
                    : t('{name} off', { name: t(game.name) })
                }
                checked={enabled(game.config)}
                onChange={(on) =>
                  set({
                    [game.config]: { ...value[game.config], enabled: on },
                  } as Partial<GamesConfig>)
                }
              />
            </div>
          ))}
          <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <div className="mx-field">
              <span
                className="mx-label"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <span>{t('Command channels')}</span>
                {value.channelIds.length === 0 ? (
                  <span className="mx-muted">{t('Every channel')}</span>
                ) : null}
              </span>
              <ChannelMulti
                value={value.channelIds}
                onChange={(channelIds) => set({ channelIds })}
              />
            </div>
          </div>
        </Panel>
        <BoardPanel board={board} />
        <MoneyPanel economy={economy} money={money} />
      </Column>

      <Panel
        title={current ? t(current.name) : t('Trivia')}
        span={8}
        id="editor"
        actions={
          <span className="mx-sub">
            {current && enabled(current.config) ? where(current.key) : t('Off')}
          </span>
        }
      >
        {selected === 'trivia' ? <TriviaEditor economy={economy} /> : null}
        {selected === 'counting' ? (
          <CountingEditor
            state={stateFor('counting')}
            top={board.counting?.[0] ?? null}
            economy={economy}
          />
        ) : null}
        {selected === 'wordchain' ? <WordchainEditor state={stateFor('wordchain')} /> : null}
        {selected === 'higherlower' ? <HiloEditor prefix={prefix} /> : null}
        {selected === 'coinflip' ? <CoinflipEditor prefix={prefix} /> : null}
      </Panel>
    </Grid>
  );
}
