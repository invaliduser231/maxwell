'use client';

import type {
  FormCondition,
  FormDefinition,
  FormQuestion,
  FormQuestionType,
  FormsConfig,
} from '@maxwell/core/modules/forms';
import { useDraft } from '@/components/module-shell';

export const typeLabels: Record<FormQuestionType, string> = {
  text: 'Text',
  choice: 'Choice',
  number: 'Number',
  yesno: 'Yes or no',
};

export const operatorLabels: Record<FormCondition['operator'], string> = {
  equals: 'is',
  notEquals: 'is not',
  includes: 'contains',
  greaterThan: 'is more than',
  lessThan: 'is less than',
};

export const operatorsFor: Record<FormQuestionType, FormCondition['operator'][]> = {
  text: ['equals', 'notEquals', 'includes'],
  choice: ['equals', 'notEquals'],
  number: ['equals', 'notEquals', 'greaterThan', 'lessThan'],
  yesno: ['equals', 'notEquals'],
};

export function shownValue(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === 'yes') return 'Yes';
  if (lower === 'no') return 'No';
  return value;
}

export function conditionText(condition: FormCondition | null, questions: FormQuestion[]): string {
  if (!condition) return '';
  const at = questions.findIndex((question) => question.id === condition.questionId);
  const name = at === -1 ? 'a removed question' : `Q${at + 1}`;
  return `${name} ${operatorLabels[condition.operator]} ${shownValue(condition.value) || 'empty'}`;
}

export function slug(input: string, max = 32): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/g, '')
    .slice(0, max);
}

export function freshId(base: string, taken: readonly string[]): string {
  const start = slug(base, 24).replace(/-+$/g, '') || 'form';
  if (!taken.includes(start)) return start;
  for (let n = 2; ; n++) {
    const id = `${start}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

export function questionId(taken: readonly string[]): string {
  for (;;) {
    const id = `q-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.includes(id)) return id;
  }
}

export function formIssues(form: FormDefinition): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  form.questions.forEach((question, index) => {
    const name = `Q${index + 1}`;
    if (!question.label.trim()) issues.push(`${name} has no text.`);
    if (question.type === 'choice' && question.options.length === 0) {
      issues.push(`${name} has no options.`);
    }
    if (question.condition && !seen.has(question.condition.questionId)) {
      issues.push(`${name} depends on a question that is not above it.`);
    }
    seen.add(question.id);
  });
  return issues;
}

export function useForm(index: number) {
  const { value, update, readOnly } = useDraft<FormsConfig>();
  const form = value.forms[index];
  const patch = (next: Partial<FormDefinition>) =>
    update((previous) => ({
      ...previous,
      forms: previous.forms.map((entry, position) =>
        position === index ? { ...entry, ...next } : entry,
      ),
    }));
  return { value, form, patch, update, readOnly };
}
