'use client';

import type {
  FormAction,
  FormCondition,
  FormQuestion,
  FormQuestionType,
} from '@maxwell/core/modules/forms';
import { useState } from 'react';
import {
  AddPicker,
  OptionalNumber,
  RoleMulti,
  Seg,
  Select,
  Switch,
  TextArea,
  TextInput,
  ToggleRow,
  WordList,
} from '@/components/controls';
import { useRoleName } from '@/components/guild';
import { useT } from '@/components/i18n';
import { Callout, Field, Fields, Panel, PanelBody } from '@/components/ui';
import type { Translator } from '@/lib/i18n';
import {
  conditionText,
  formIssues,
  operatorLabels,
  operatorsFor,
  questionId,
  typeLabels,
  useForm,
} from './bits';

export interface TicketPanelOption {
  id: string;
  name: string;
}

const addTypes: FormQuestionType[] = ['text', 'choice', 'number', 'yesno'];

function typeOptions(t: Translator) {
  return addTypes.map((type) => ({ value: type, label: t(typeLabels[type]) }));
}

const QUESTION_LIMIT = 25;

function blank(type: FormQuestionType, id: string): FormQuestion {
  return {
    id,
    label: '',
    description: '',
    type,
    required: true,
    options: [],
    min: null,
    max: null,
    condition: null,
  };
}

export function AddQuestion({
  formIndex,
  onSelect,
}: {
  formIndex: number;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const { form, patch, readOnly } = useForm(formIndex);
  if (!form || readOnly || form.questions.length >= QUESTION_LIMIT) return null;
  return (
    <AddPicker
      label={t('Add question')}
      options={typeOptions(t)}
      onPick={(type) => {
        const id = questionId(form.questions.map((question) => question.id));
        patch({ questions: [...form.questions, blank(type as FormQuestionType, id)] });
        onSelect(form.questions.length);
      }}
    />
  );
}

export function Questions({
  formIndex,
  selected,
  onSelect,
}: {
  formIndex: number;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const { form, readOnly } = useForm(formIndex);
  if (!form) return null;
  const issues = formIssues(t, form).filter((issue) => issue.index !== selected);
  return (
    <Panel
      title={t('Questions')}
      id="f-questions"
      actions={readOnly ? null : <AddQuestion formIndex={formIndex} onSelect={onSelect} />}
    >
      {form.questions.map((question, index) => {
        const picked = index === selected;
        const condition = conditionText(t, question.condition, form.questions);
        return (
          <div key={question.id} className="mx-row" style={{ alignItems: 'flex-start' }}>
            <span className="mx-mono mx-muted" style={{ width: 18, paddingTop: 1 }}>
              {index + 1}
            </span>
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={picked}
              onClick={() => onSelect(index)}
            >
              <span className="mx-row-title" style={{ overflowWrap: 'anywhere' }}>
                {question.label || <span className="mx-muted">{t('No text yet')}</span>}
              </span>
              <span className="mx-sub">
                {t(typeLabels[question.type])}
                {question.required ? '' : `, ${t('optional')}`}
                {condition ? `, ${t('if {condition}', { condition })}` : ''}
              </span>
            </button>
          </div>
        );
      })}
      {issues.length > 0 ? (
        <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
          <Callout tone="warn">{issues.map((issue) => issue.text).join(' ')}</Callout>
        </div>
      ) : null}
    </Panel>
  );
}

function ConditionFields({
  question,
  earlier,
  onChange,
}: {
  question: FormQuestion;
  earlier: FormQuestion[];
  onChange: (next: FormCondition | null) => void;
}) {
  const t = useT();
  const condition = question.condition;
  const source = earlier.find((candidate) => candidate.id === condition?.questionId);
  const options = [
    { value: '', label: t('Always') },
    ...earlier.map((candidate, index) => ({
      value: candidate.id,
      label: `Q${index + 1} ${candidate.label}`.slice(0, 60),
    })),
    ...(condition && !source
      ? [{ value: condition.questionId, label: t('Removed question') }]
      : []),
  ];
  const pick = (id: string) => {
    if (!id) {
      onChange(null);
      return;
    }
    const target = earlier.find((candidate) => candidate.id === id);
    const value =
      target?.type === 'yesno' ? 'yes' : target?.type === 'choice' ? (target.options[0] ?? '') : '';
    onChange({ questionId: id, operator: 'equals', value });
  };
  return (
    <Fields>
      <Field label={t('Show')}>
        <Select value={condition?.questionId ?? ''} options={options} onChange={pick} />
      </Field>
      {condition && source ? (
        <>
          <Field label={t('Rule')}>
            <Select
              value={condition.operator}
              options={operatorsFor[source.type].map((operator) => ({
                value: operator,
                label: t(operatorLabels[operator]),
              }))}
              onChange={(operator) => onChange({ ...condition, operator })}
            />
          </Field>
          {source.type === 'yesno' ? (
            <div className="mx-field">
              <span className="mx-label">{t('Answer')}</span>
              <Seg
                label={t('Answer')}
                value={condition.value.toLowerCase() === 'no' ? 'no' : 'yes'}
                options={[
                  { value: 'yes', label: t('Yes') },
                  { value: 'no', label: t('No') },
                ]}
                onChange={(value) => onChange({ ...condition, value })}
              />
            </div>
          ) : (
            <Field label={t('Answer')}>
              {source.type === 'choice' && source.options.length > 0 ? (
                <Select
                  value={condition.value}
                  placeholder={t('Pick one')}
                  options={[
                    ...(source.options.includes(condition.value) || !condition.value
                      ? []
                      : [{ value: condition.value, label: condition.value }]),
                    ...source.options.map((option) => ({ value: option, label: option })),
                  ]}
                  onChange={(value) => onChange({ ...condition, value })}
                />
              ) : (
                <TextInput
                  value={condition.value}
                  maxLength={200}
                  onChange={(value) => onChange({ ...condition, value })}
                />
              )}
            </Field>
          )}
        </>
      ) : null}
    </Fields>
  );
}

function actionLines(
  t: Translator,
  action: FormAction,
  accept: boolean,
  roleName: (id: string) => string,
  panels: TicketPanelOption[],
): string[] {
  const lines = [
    ...action.addRoleIds.map((id) => t('Give role {name}', { name: roleName(id) })),
    ...action.removeRoleIds.map((id) => t('Take role {name}', { name: roleName(id) })),
  ];
  if (action.openTicket) {
    const panel = panels.find((entry) => entry.id === action.ticketPanelId) ?? panels[0];
    lines.push(panel ? t('Open a ticket in {panel}', { panel: panel.name }) : t('Open a ticket'));
  }
  const dm = action.dm.trim();
  lines.push(
    dm
      ? `DM: "${dm.length > 80 ? `${dm.slice(0, 80)}...` : dm}"`
      : accept
        ? t('DM: "Your form was accepted."')
        : t('DM: "Your form was declined."'),
  );
  return lines;
}

export function ActionPanel({
  formIndex,
  which,
  panels,
}: {
  formIndex: number;
  which: 'onAccept' | 'onDecline';
  panels: TicketPanelOption[];
}) {
  const t = useT();
  const { form, patch, readOnly } = useForm(formIndex);
  const roleName = useRoleName();
  const [open, setOpen] = useState(false);
  if (!form) return null;
  const action = form[which];
  const accept = which === 'onAccept';
  const set = (next: Partial<FormAction>) => patch({ [which]: { ...action, ...next } });
  return (
    <Panel
      title={accept ? t('On approve') : t('On decline')}
      span={6}
      id={accept ? 'f-on-accept' : 'f-on-decline'}
      actions={
        readOnly ? null : (
          <button type="button" className="mx-btn mx-btn-ghost" onClick={() => setOpen(!open)}>
            {open ? t('Done') : t('Change')}
          </button>
        )
      }
    >
      <PanelBody>
        {open && !readOnly ? (
          <>
            <div className="mx-field">
              <span className="mx-label">{t('Give roles')}</span>
              <RoleMulti
                value={action.addRoleIds}
                onChange={(addRoleIds) => set({ addRoleIds: addRoleIds.slice(0, 10) })}
              />
            </div>
            <div className="mx-field">
              <span className="mx-label">{t('Take roles')}</span>
              <RoleMulti
                value={action.removeRoleIds}
                onChange={(removeRoleIds) => set({ removeRoleIds: removeRoleIds.slice(0, 10) })}
              />
            </div>
            <div className="mx-toggle-row">
              <div className="mx-row-main">
                <span className="mx-row-title">{t('Open a ticket')}</span>
              </div>
              <Switch
                label={t('Open a ticket')}
                checked={action.openTicket}
                disabled={panels.length === 0}
                onChange={(openTicket) =>
                  set({ openTicket, ticketPanelId: action.ticketPanelId ?? panels[0]?.id ?? null })
                }
              />
            </div>
            {action.openTicket && panels.length > 1 ? (
              <Field label={t('Ticket panel')}>
                <Select
                  value={action.ticketPanelId ?? panels[0]?.id ?? ''}
                  options={panels.map((panel) => ({ value: panel.id, label: panel.name }))}
                  onChange={(ticketPanelId) => set({ ticketPanelId })}
                />
              </Field>
            ) : null}
            <Field label="DM" hint="{user} {form} {server} {note}">
              <TextArea
                value={action.dm}
                rows={2}
                maxLength={2000}
                placeholder={
                  accept
                    ? t('Your {form} for {server} was accepted.')
                    : t('Your {form} for {server} was declined.')
                }
                onChange={(dm) => set({ dm })}
              />
            </Field>
          </>
        ) : (
          actionLines(t, action, accept, roleName, panels).map((line) => (
            <span key={line} style={{ overflowWrap: 'anywhere' }}>
              {line}
            </span>
          ))
        )}
      </PanelBody>
    </Panel>
  );
}

function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={up ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function QuestionEditor({
  formIndex,
  index,
  onSelect,
}: {
  formIndex: number;
  index: number;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const { form, patch, readOnly } = useForm(formIndex);
  const question = form?.questions[index];
  if (!form || !question) return null;
  const setQuestion = (next: Partial<FormQuestion>) =>
    patch({
      questions: form.questions.map((entry, at) => (at === index ? { ...entry, ...next } : entry)),
    });
  const move = (to: number) => {
    const list = [...form.questions];
    const [item] = list.splice(index, 1);
    if (!item) return;
    list.splice(to, 0, item);
    patch({ questions: list });
    onSelect(to);
  };

  return (
    <Panel
      title={t('Question {number}', { number: index + 1 })}
      id="f-edit"
      actions={
        readOnly ? null : (
          <>
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              aria-label={t('Move up')}
              disabled={index === 0}
              onClick={() => move(index - 1)}
            >
              <ArrowIcon up />
            </button>
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              aria-label={t('Move down')}
              disabled={index >= form.questions.length - 1}
              onClick={() => move(index + 1)}
            >
              <ArrowIcon />
            </button>
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              onClick={() => {
                patch({
                  questions: form.questions
                    .filter((_, at) => at !== index)
                    .map((entry) =>
                      entry.condition?.questionId === question.id
                        ? { ...entry, condition: null }
                        : entry,
                    ),
                });
                onSelect(Math.max(0, index - 1));
              }}
            >
              {t('Remove')}
            </button>
          </>
        )
      }
    >
      <PanelBody>
        <Field label={t('Question')}>
          <TextInput
            value={question.label}
            maxLength={256}
            onChange={(label) => setQuestion({ label })}
          />
        </Field>
        <div className="mx-field">
          <span className="mx-label">{t('Type')}</span>
          <Seg
            label={t('Type')}
            value={question.type}
            options={typeOptions(t)}
            onChange={(type) =>
              setQuestion({ type, min: null, max: null, options: question.options })
            }
          />
        </div>
        {question.type === 'choice' ? (
          <div className="mx-field">
            <span className="mx-label">{t('Options')}</span>
            <WordList
              value={question.options}
              placeholder={t('Add option and press Enter')}
              onChange={(options) =>
                setQuestion({
                  options: options.map((option) => option.slice(0, 100)).slice(0, 20),
                })
              }
            />
            {readOnly && question.options.length === 0 ? (
              <span className="mx-sub">{t('None')}</span>
            ) : null}
          </div>
        ) : null}
        {question.type === 'number' ? (
          <Fields>
            <Field label={t('Lowest')}>
              <OptionalNumber
                label={t('Lowest')}
                value={question.min}
                onChange={(min) => setQuestion({ min })}
              />
            </Field>
            <Field label={t('Highest')}>
              <OptionalNumber
                label={t('Highest')}
                value={question.max}
                onChange={(max) => setQuestion({ max })}
              />
            </Field>
          </Fields>
        ) : null}
        {question.type === 'text' ? (
          <Fields>
            <Field label={t('Shortest')}>
              <OptionalNumber
                label={t('Shortest')}
                value={question.min}
                min={0}
                max={1000}
                onChange={(min) => setQuestion({ min })}
              />
            </Field>
            <Field label={t('Longest')}>
              <OptionalNumber
                label={t('Longest')}
                value={question.max}
                min={1}
                max={1000}
                placeholder="1000"
                onChange={(max) => setQuestion({ max })}
              />
            </Field>
          </Fields>
        ) : null}
        {index > 0 || question.condition ? (
          <ConditionFields
            question={question}
            earlier={form.questions.slice(0, index)}
            onChange={(condition) => setQuestion({ condition })}
          />
        ) : null}
        <ToggleRow
          title={t('Required')}
          checked={question.required}
          onChange={(required) => setQuestion({ required })}
        />
      </PanelBody>
    </Panel>
  );
}
