'use client';

import type { FormDefinition, FormsConfig } from '@maxwell/core/modules/forms';
import type { SubmissionStatus } from '@maxwell/core/stores/forms';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  ChannelSelect,
  RoleMulti,
  Select,
  Tabs,
  TextArea,
  TextInput,
  ToggleRow,
} from '@/components/controls';
import { ChannelType, useGuild } from '@/components/guild';
import { fingerprint } from '@/components/live';
import { useDraft } from '@/components/module-shell';
import { Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import type { Names } from '@/lib/people';
import { plural, span } from '@/lib/time';
import { fetchSubmissions } from './actions';
import { freshId, slug, useForm } from './bits';
import {
  ActionPanel,
  AddQuestion,
  QuestionEditor,
  Questions,
  type TicketPanelOption,
} from './builder';
import type { SubmissionView } from './load';
import { ResponseDetail, ResponseList, ResponsesEmpty, type Show } from './responses';

type Tab = 'questions' | 'settings' | 'responses';

interface Bucket {
  items: SubmissionView[];
  names: Names;
  more: boolean;
}

const tabs = [
  { value: 'questions', label: 'Questions' },
  { value: 'settings', label: 'Settings' },
  { value: 'responses', label: 'Responses' },
] as const;

const cooldowns = [
  { value: '0', label: 'None' },
  { value: '24', label: '1 day' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
];

const voteCounts = [
  { value: '0', label: 'Off' },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
];

const sessionOptions = [
  { value: '10', label: '10 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '180', label: '3 hours' },
];

const CATEGORY = [ChannelType.Category];

const FORM_LIMIT = 25;

function withCurrent(options: { value: string; label: string }[], current: number, label: string) {
  return options.some((option) => option.value === String(current))
    ? options
    : [...options, { value: String(current), label }];
}

type Counts = { formId: string; status: SubmissionStatus; total: number }[];

function countFor(counts: Counts, formId: string, status?: SubmissionStatus): number {
  return counts
    .filter((row) => row.formId === formId && (!status || row.status === status))
    .reduce((sum, row) => sum + row.total, 0);
}

function useAddForm(onSelect: (index: number) => void): () => void {
  const { value, update } = useDraft<FormsConfig>();
  return () => {
    const form: FormDefinition = {
      id: freshId(
        value.forms.length === 0 ? 'apply' : 'new-form',
        value.forms.map((entry) => entry.id),
      ),
      name: value.forms.length === 0 ? 'Staff application' : 'New form',
      description: '',
      enabled: true,
      questions: [],
      requiredRoleIds: [],
      cooldownHours: 0,
      oncePerMember: false,
      reviewChannelId: null,
      reviewerRoleIds: [],
      votesToAccept: 0,
      votesToDecline: 0,
      onAccept: {
        addRoleIds: [],
        removeRoleIds: [],
        openTicket: false,
        ticketPanelId: null,
        dm: '',
      },
      onDecline: {
        addRoleIds: [],
        removeRoleIds: [],
        openTicket: false,
        ticketPanelId: null,
        dm: '',
      },
    };
    update((previous) => ({ ...previous, forms: [...previous.forms, form] }));
    onSelect(value.forms.length);
  };
}

function FormList({
  selected,
  onSelect,
  onAdd,
  counts,
}: {
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  counts: Counts;
}) {
  const { value, readOnly } = useDraft<FormsConfig>();
  return (
    <Panel
      title="Forms"
      id="f-forms"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn"
            disabled={value.forms.length >= FORM_LIMIT}
            onClick={onAdd}
          >
            New
          </button>
        )
      }
    >
      {value.forms.map((form, index) => {
        const waiting = countFor(counts, form.id, 'pending');
        const total = countFor(counts, form.id);
        const picked = index === selected;
        return (
          <div key={form.id} className="mx-row">
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={picked}
              onClick={() => onSelect(index)}
            >
              <span className="mx-row-title mx-ellipsis">{form.name || 'Untitled form'}</span>
              <span className="mx-sub">
                {plural(form.questions.length, 'question')}, {plural(total, 'response')}
                {form.enabled ? '' : ', paused'}
              </span>
            </button>
            {waiting > 0 ? (
              <span className="mx-chip" style={{ color: 'var(--mx-north)' }}>
                {waiting} new
              </span>
            ) : null}
          </div>
        );
      })}
    </Panel>
  );
}

function FormSettings({
  index,
  prefix,
  onRemoved,
}: {
  index: number;
  prefix: string;
  onRemoved: () => void;
}) {
  const { value, form, patch, update, readOnly } = useForm(index);
  if (!form) return null;
  const taken = value.forms.some((entry, at) => at !== index && entry.id === form.id);
  return (
    <Panel
      title={form.name || 'Untitled form'}
      id="f-settings"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            onClick={() => {
              update((previous) => ({
                ...previous,
                forms: previous.forms.filter((_, at) => at !== index),
              }));
              onRemoved();
            }}
          >
            Delete form
          </button>
        )
      }
    >
      <PanelBody>
        <Fields>
          <Field label="Name">
            <TextInput value={form.name} maxLength={80} onChange={(name) => patch({ name })} />
          </Field>
          <label className="mx-field">
            <span className="mx-label">Open with</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mx-mono mx-muted" style={{ whiteSpace: 'nowrap' }}>
                {prefix}form start
              </span>
              <input
                className="mx-input mx-mono"
                style={{ flex: 1, minWidth: 0 }}
                value={form.id}
                maxLength={32}
                readOnly={readOnly}
                onChange={(event) => patch({ id: slug(event.target.value) })}
              />
            </span>
            {taken ? <span className="mx-hint">Another form already uses this.</span> : null}
          </label>
          <Field label="Reviews go to">
            <ChannelSelect
              value={form.reviewChannelId}
              none="Nowhere"
              onChange={(reviewChannelId) => patch({ reviewChannelId })}
            />
          </Field>
          <Field label="Cooldown">
            <Select
              value={String(form.cooldownHours)}
              options={withCurrent(cooldowns, form.cooldownHours, `${form.cooldownHours} hours`)}
              onChange={(next) => patch({ cooldownHours: Number(next) })}
            />
          </Field>
          <Field label="Approvals needed">
            <Select
              value={String(form.votesToAccept)}
              options={withCurrent(voteCounts, form.votesToAccept, String(form.votesToAccept))}
              onChange={(next) => patch({ votesToAccept: Number(next) })}
            />
          </Field>
          <Field label="Declines needed">
            <Select
              value={String(form.votesToDecline)}
              options={withCurrent(voteCounts, form.votesToDecline, String(form.votesToDecline))}
              onChange={(next) => patch({ votesToDecline: Number(next) })}
            />
          </Field>
          <div className="mx-field">
            <span className="mx-label">Who can apply</span>
            <RoleMulti
              value={form.requiredRoleIds}
              onChange={(requiredRoleIds) =>
                patch({ requiredRoleIds: requiredRoleIds.slice(0, 10) })
              }
            />
            {form.requiredRoleIds.length === 0 ? <span className="mx-hint">Everyone</span> : null}
          </div>
          <div className="mx-field">
            <span className="mx-label">Who can vote</span>
            <RoleMulti
              value={form.reviewerRoleIds}
              onChange={(reviewerRoleIds) =>
                patch({ reviewerRoleIds: reviewerRoleIds.slice(0, 10) })
              }
            />
            <span className="mx-hint">Manage Server always can</span>
          </div>
        </Fields>
        <Field label="Intro">
          <TextArea
            value={form.description}
            rows={2}
            maxLength={1000}
            onChange={(description) => patch({ description })}
          />
        </Field>
        <Fields>
          <ToggleRow
            title="Taking answers"
            checked={form.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
          <ToggleRow
            title="One approval per member"
            checked={form.oncePerMember}
            onChange={(oncePerMember) => patch({ oncePerMember })}
          />
        </Fields>
      </PanelBody>
    </Panel>
  );
}

function AllForms() {
  const { value, update } = useDraft<FormsConfig>();
  return (
    <Panel title="All forms" id="f-all">
      <PanelBody>
        <Fields>
          <Field label="Time to answer">
            <Select
              value={String(value.sessionMinutes)}
              options={withCurrent(
                sessionOptions,
                value.sessionMinutes,
                `${value.sessionMinutes} minutes`,
              )}
              onChange={(next) =>
                update((previous) => ({ ...previous, sessionMinutes: Number(next) }))
              }
            />
          </Field>
          <Field label="Category when DMs are closed">
            <ChannelSelect
              value={value.fallbackCategoryId}
              kinds={CATEGORY}
              none="No category"
              onChange={(fallbackCategoryId) =>
                update((previous) => ({ ...previous, fallbackCategoryId }))
              }
            />
          </Field>
        </Fields>
      </PanelBody>
    </Panel>
  );
}

function FormStats({
  form,
  counts,
  times,
}: {
  form: FormDefinition;
  counts: Counts;
  times: { formId: string; medianSeconds: number }[];
}) {
  const median = times.find((entry) => entry.formId === form.id)?.medianSeconds;
  const stats = [
    { label: 'Responses', value: countFor(counts, form.id).toLocaleString('en-US') },
    { label: 'Waiting', value: countFor(counts, form.id, 'pending').toLocaleString('en-US') },
    { label: 'Approved', value: countFor(counts, form.id, 'accepted').toLocaleString('en-US') },
    ...(median === undefined ? [] : [{ label: 'Median review', value: span(median * 1000) }]),
  ];
  return (
    <section className="mx-panel" aria-label="Numbers">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`,
        }}
      >
        {stats.map((stat) => (
          <div className="mx-stat" key={stat.label}>
            <span className="mx-stat-label">{stat.label}</span>
            <span className="mx-stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FormsView({
  now,
  prefix,
  counts,
  times,
  waiting,
  decided,
  ticketPanels,
}: {
  now: number;
  prefix: string;
  counts: Counts;
  times: { formId: string; medianSeconds: number }[];
  waiting: Bucket;
  decided: Bucket;
  ticketPanels: TicketPanelOption[];
}) {
  const { value, readOnly } = useDraft<FormsConfig>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('questions');
  const [formIndex, setFormIndex] = useState(0);
  const [question, setQuestion] = useState(0);
  const [show, setShow] = useState<Show>('waiting');
  const [buckets, setBuckets] = useState<Record<Show, Bucket>>({ waiting, decided });
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const { guildId } = useGuild();

  const seen = useRef(fingerprint({ waiting, decided }));

  useEffect(() => {
    const key = fingerprint({ waiting, decided });
    if (key === seen.current) return;
    seen.current = key;
    setBuckets({ waiting, decided });
    setMore({});
  }, [waiting, decided]);

  const selectForm = (index: number) => {
    setFormIndex(index);
    setQuestion(0);
    setPicked(null);
  };
  const add = useAddForm(selectForm);

  const index = Math.max(0, Math.min(formIndex, value.forms.length - 1));
  const form = value.forms[index];
  const bucket = buckets[show];
  const names = { ...buckets.waiting.names, ...buckets.decided.names };
  const items = form ? bucket.items.filter((item) => item.formId === form.id) : [];
  const key = `${form?.id ?? ''}:${show}`;
  const hasMore = more[key] ?? bucket.more;
  const current = items.find((item) => item.id === picked) ?? items[0] ?? null;

  const loadMore = () =>
    start(async () => {
      if (!form) return;
      const which = show;
      const result = await fetchSubmissions(guildId, {
        formId: form.id,
        decided: which === 'decided',
        before: items.at(-1)?.id,
      });
      if (!result.ok || !result.data) return;
      const page = result.data;
      setBuckets((previous) => {
        const target = previous[which];
        const fresh = page.items.filter(
          (item) => !target.items.some((known) => known.id === item.id),
        );
        return {
          ...previous,
          [which]: {
            ...target,
            items: [...target.items, ...fresh],
            names: { ...target.names, ...page.names },
          },
        };
      });
      setMore((previous) => ({ ...previous, [key]: page.more }));
    });

  if (!form) {
    return (
      <Grid>
        <Panel id="f-empty">
          <Empty
            mood="sleeping"
            action={
              readOnly ? null : (
                <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                  New form
                </button>
              )
            }
          >
            No forms yet.
          </Empty>
        </Panel>
      </Grid>
    );
  }

  const list = <FormList selected={index} onSelect={selectForm} onAdd={add} counts={counts} />;
  const questionIndex = Math.max(0, Math.min(question, form.questions.length - 1));
  const total = countFor(counts, form.id);

  return (
    <>
      <Tabs label="Forms" value={tab} options={tabs} onChange={setTab} />
      <Grid>
        {tab === 'questions' ? (
          <>
            <div className="mx-s4 mx-stack" style={{ gap: 16 }}>
              {list}
              {form.questions.length > 0 ? (
                <Questions formIndex={index} selected={questionIndex} onSelect={setQuestion} />
              ) : null}
            </div>
            <div className="mx-s8 mx-stack" style={{ gap: 16 }}>
              {form.questions.length > 0 ? (
                <QuestionEditor formIndex={index} index={questionIndex} onSelect={setQuestion} />
              ) : (
                <Panel id="f-no-questions">
                  <Empty
                    mood="thinking"
                    action={
                      readOnly ? null : <AddQuestion formIndex={index} onSelect={setQuestion} />
                    }
                  >
                    No questions yet.
                  </Empty>
                </Panel>
              )}
            </div>
          </>
        ) : null}
        {tab === 'settings' ? (
          <>
            <div className="mx-s4 mx-stack" style={{ gap: 16 }}>
              {list}
            </div>
            <div className="mx-s8 mx-stack" style={{ gap: 16 }}>
              <FormSettings index={index} prefix={prefix} onRemoved={() => selectForm(0)} />
              <Grid>
                <ActionPanel formIndex={index} which="onAccept" panels={ticketPanels} />
                <ActionPanel formIndex={index} which="onDecline" panels={ticketPanels} />
              </Grid>
              <AllForms />
            </div>
          </>
        ) : null}
        {tab === 'responses' ? (
          <>
            <div className="mx-s4 mx-stack" style={{ gap: 16 }}>
              {list}
              {items.length > 0 ? (
                <ResponseList
                  items={items}
                  names={names}
                  now={now}
                  show={show}
                  onShow={(next) => {
                    setShow(next);
                    setPicked(null);
                  }}
                  selected={current?.id ?? null}
                  onSelect={setPicked}
                  more={hasMore}
                  loading={loading}
                  onMore={loadMore}
                />
              ) : null}
            </div>
            <div className="mx-s8 mx-stack" style={{ gap: 16 }}>
              {total > 0 ? <FormStats form={form} counts={counts} times={times} /> : null}
              {current ? (
                <ResponseDetail
                  item={current}
                  names={names}
                  now={now}
                  onDecided={() => router.refresh()}
                />
              ) : (
                <ResponsesEmpty
                  show={show}
                  any={total > 0}
                  onShow={(next) => {
                    setShow(next);
                    setPicked(null);
                  }}
                  more={hasMore}
                  loading={loading}
                  onMore={loadMore}
                />
              )}
            </div>
          </>
        ) : null}
      </Grid>
    </>
  );
}
