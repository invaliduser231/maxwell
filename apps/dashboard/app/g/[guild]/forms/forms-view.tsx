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
import { useT } from '@/components/i18n';
import { fingerprint } from '@/components/live';
import { useDraft } from '@/components/module-shell';
import { Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import type { Key, Translator } from '@/lib/i18n';
import type { Names } from '@/lib/people';
import { span } from '@/lib/time';
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

const tabs: { value: Tab; label: Key }[] = [
  { value: 'questions', label: 'Questions' },
  { value: 'settings', label: 'Settings' },
  { value: 'responses', label: 'Responses' },
];

const cooldowns: { value: string; label: Key }[] = [
  { value: '0', label: 'None' },
  { value: '24', label: '1 day' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
];

const sessionOptions: { value: string; label: Key }[] = [
  { value: '10', label: '10 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '180', label: '3 hours' },
];

const CATEGORY = [ChannelType.Category];

const FORM_LIMIT = 25;

function translate(t: Translator, list: { value: string; label: Key }[]) {
  return list.map((entry) => ({ ...entry, label: t(entry.label) }));
}

function voteCounts(t: Translator) {
  return [
    { value: '0', label: t('Off') },
    ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
  ];
}

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
  const t = useT();
  const { value, update } = useDraft<FormsConfig>();
  return () => {
    const form: FormDefinition = {
      id: freshId(
        value.forms.length === 0 ? 'apply' : 'new-form',
        value.forms.map((entry) => entry.id),
      ),
      name: value.forms.length === 0 ? t('Staff application') : t('New form'),
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
  const t = useT();
  const { value, readOnly } = useDraft<FormsConfig>();
  return (
    <Panel
      title={t('Forms')}
      id="f-forms"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn"
            disabled={value.forms.length >= FORM_LIMIT}
            onClick={onAdd}
          >
            {t('New')}
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
              <span className="mx-row-title mx-ellipsis">{form.name || t('Untitled form')}</span>
              <span className="mx-sub">
                {t.plural(form.questions.length, '{n} question', '{n} questions')},{' '}
                {t.plural(total, '{n} response', '{n} responses')}
                {form.enabled ? '' : `, ${t('paused')}`}
              </span>
            </button>
            {waiting > 0 ? (
              <span className="mx-chip" style={{ color: 'var(--mx-north)' }}>
                {t('{count} new', { count: waiting })}
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
  const t = useT();
  const { value, form, patch, update, readOnly } = useForm(index);
  if (!form) return null;
  const taken = value.forms.some((entry, at) => at !== index && entry.id === form.id);
  const votes = voteCounts(t);
  return (
    <Panel
      title={form.name || t('Untitled form')}
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
            {t('Delete form')}
          </button>
        )
      }
    >
      <PanelBody>
        <Fields>
          <Field label={t('Name')}>
            <TextInput value={form.name} maxLength={80} onChange={(name) => patch({ name })} />
          </Field>
          <label className="mx-field">
            <span className="mx-label">{t('Open with')}</span>
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
            {taken ? <span className="mx-hint">{t('Another form already uses this.')}</span> : null}
          </label>
          <Field label={t('Reviews go to')}>
            <ChannelSelect
              value={form.reviewChannelId}
              none={t('Nowhere')}
              onChange={(reviewChannelId) => patch({ reviewChannelId })}
            />
          </Field>
          <Field label={t('Cooldown')}>
            <Select
              value={String(form.cooldownHours)}
              options={withCurrent(
                translate(t, cooldowns),
                form.cooldownHours,
                t.plural(form.cooldownHours, '{n} hour', '{n} hours'),
              )}
              onChange={(next) => patch({ cooldownHours: Number(next) })}
            />
          </Field>
          <Field label={t('Approvals needed')}>
            <Select
              value={String(form.votesToAccept)}
              options={withCurrent(votes, form.votesToAccept, String(form.votesToAccept))}
              onChange={(next) => patch({ votesToAccept: Number(next) })}
            />
          </Field>
          <Field label={t('Declines needed')}>
            <Select
              value={String(form.votesToDecline)}
              options={withCurrent(votes, form.votesToDecline, String(form.votesToDecline))}
              onChange={(next) => patch({ votesToDecline: Number(next) })}
            />
          </Field>
          <div className="mx-field">
            <span className="mx-label">{t('Who can apply')}</span>
            <RoleMulti
              bots
              value={form.requiredRoleIds}
              onChange={(requiredRoleIds) =>
                patch({ requiredRoleIds: requiredRoleIds.slice(0, 10) })
              }
            />
            {form.requiredRoleIds.length === 0 ? (
              <span className="mx-hint">{t('Everyone')}</span>
            ) : null}
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Who can vote')}</span>
            <RoleMulti
              bots
              value={form.reviewerRoleIds}
              onChange={(reviewerRoleIds) =>
                patch({ reviewerRoleIds: reviewerRoleIds.slice(0, 10) })
              }
            />
            <span className="mx-hint">{t('Manage Server always can')}</span>
          </div>
        </Fields>
        <Field label={t('Intro')}>
          <TextArea
            value={form.description}
            rows={2}
            maxLength={1000}
            onChange={(description) => patch({ description })}
          />
        </Field>
        <Fields>
          <ToggleRow
            title={t('Taking answers')}
            checked={form.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
          <ToggleRow
            title={t('One approval per member')}
            checked={form.oncePerMember}
            onChange={(oncePerMember) => patch({ oncePerMember })}
          />
        </Fields>
      </PanelBody>
    </Panel>
  );
}

function AllForms() {
  const t = useT();
  const { value, update } = useDraft<FormsConfig>();
  return (
    <Panel title={t('All forms')} id="f-all">
      <PanelBody>
        <Fields>
          <Field label={t('Time to answer')}>
            <Select
              value={String(value.sessionMinutes)}
              options={withCurrent(
                translate(t, sessionOptions),
                value.sessionMinutes,
                t('{count} minutes', { count: value.sessionMinutes }),
              )}
              onChange={(next) =>
                update((previous) => ({ ...previous, sessionMinutes: Number(next) }))
              }
            />
          </Field>
          <Field label={t('Category when DMs are closed')}>
            <ChannelSelect
              value={value.fallbackCategoryId}
              kinds={CATEGORY}
              none={t('No category')}
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
  const t = useT();
  const median = times.find((entry) => entry.formId === form.id)?.medianSeconds;
  const stats = [
    { label: t('Responses'), value: t.count(countFor(counts, form.id)) },
    { label: t('Waiting'), value: t.count(countFor(counts, form.id, 'pending')) },
    { label: t('Approved'), value: t.count(countFor(counts, form.id, 'accepted')) },
    ...(median === undefined ? [] : [{ label: t('Median review'), value: span(t, median * 1000) }]),
  ];
  return (
    <section className="mx-panel" aria-label={t('Numbers')}>
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
  const t = useT();
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
                  {t('New form')}
                </button>
              )
            }
          >
            {t('No forms yet.')}
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
      <Tabs
        label={t('Forms')}
        value={tab}
        options={tabs.map((entry) => ({ ...entry, label: t(entry.label) }))}
        onChange={setTab}
      />
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
                    {t('No questions yet.')}
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
