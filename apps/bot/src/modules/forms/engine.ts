import type { FormCondition, FormDefinition, FormQuestion } from '@maxwell/core/modules/forms';
import type { FormAnswerValue, SubmittedAnswer } from '@maxwell/core/stores/forms';
import { count } from '../../ui/format.js';
import { formsCopy } from './copy.js';

export type Answers = Record<string, FormAnswerValue | null>;

export type AnswerProblem =
  | 'required'
  | 'number'
  | 'tooSmall'
  | 'tooLarge'
  | 'tooShort'
  | 'tooLong'
  | 'choice'
  | 'yesno';

export type ParsedAnswer =
  | { ok: true; value: FormAnswerValue | null }
  | { ok: false; problem: AnswerProblem };

const yes = new Set([
  'yes',
  'y',
  'yeah',
  'yep',
  'true',
  'ja',
  'oui',
  'si',
  'sí',
  'tak',
  'evet',
  'sim',
]);
const no = new Set([
  'no',
  'n',
  'nope',
  'false',
  'nein',
  'non',
  'nie',
  'hayır',
  'hayir',
  'não',
  'nao',
]);
const skipWords = new Set(['skip', '-', 'überspringen', 'omitir', 'saltar']);
const cancelWords = new Set([
  'cancel',
  'stop',
  'quit',
  'abbrechen',
  'abbruch',
  'cancelar',
  'salir',
]);
const TEXT_LIMIT = 1_000;

export function isCancel(input: string): boolean {
  return cancelWords.has(input.trim().toLowerCase());
}

export function isSkip(input: string): boolean {
  return skipWords.has(input.trim().toLowerCase());
}

function asNumber(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/[\s_']/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function asText(value: FormAnswerValue): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

export function parseAnswer(question: FormQuestion, raw: string): ParsedAnswer {
  const input = raw.trim();
  if (!input || isSkip(input)) {
    return question.required ? { ok: false, problem: 'required' } : { ok: true, value: null };
  }

  switch (question.type) {
    case 'number': {
      const value = asNumber(input);
      if (value === null) return { ok: false, problem: 'number' };
      if (question.min !== null && value < question.min) return { ok: false, problem: 'tooSmall' };
      if (question.max !== null && value > question.max) return { ok: false, problem: 'tooLarge' };
      return { ok: true, value };
    }
    case 'yesno': {
      const word = input.toLowerCase().replace(/[.!]+$/, '');
      if (yes.has(word)) return { ok: true, value: true };
      if (no.has(word)) return { ok: true, value: false };
      return { ok: false, problem: 'yesno' };
    }
    case 'choice': {
      const index = /^\d{1,2}$/.test(input) ? Number(input) - 1 : -1;
      const byIndex = index >= 0 ? question.options[index] : undefined;
      if (byIndex !== undefined) return { ok: true, value: byIndex };
      const byText = question.options.find(
        (option) => option.toLowerCase() === input.toLowerCase(),
      );
      return byText !== undefined ? { ok: true, value: byText } : { ok: false, problem: 'choice' };
    }
    default: {
      const min = question.min ?? 0;
      const max = Math.min(question.max ?? TEXT_LIMIT, TEXT_LIMIT);
      if (input.length < min) return { ok: false, problem: 'tooShort' };
      if (input.length > max) return { ok: false, problem: 'tooLong' };
      return { ok: true, value: input };
    }
  }
}

export function conditionMet(condition: FormCondition | null, answers: Answers): boolean {
  if (!condition) return true;
  const answer = answers[condition.questionId];
  if (answer === undefined || answer === null) return condition.operator === 'notEquals';

  const expected = condition.value.trim().toLowerCase();
  const actual = asText(answer).trim().toLowerCase();
  const expectedBool = yes.has(expected) ? 'yes' : no.has(expected) ? 'no' : expected;

  switch (condition.operator) {
    case 'equals':
      if (typeof answer === 'number') return answer === asNumber(expected);
      return actual === expectedBool;
    case 'notEquals':
      if (typeof answer === 'number') return answer !== asNumber(expected);
      return actual !== expectedBool;
    case 'includes':
      return expected.length > 0 && actual.includes(expected);
    case 'greaterThan':
    case 'lessThan': {
      const left = typeof answer === 'number' ? answer : asNumber(actual);
      const right = asNumber(expected);
      if (left === null || right === null) return false;
      return condition.operator === 'greaterThan' ? left > right : left < right;
    }
  }
}

export function nextQuestion(
  form: FormDefinition,
  answers: Answers,
  afterId: string | null,
): FormQuestion | null {
  const start = afterId === null ? 0 : form.questions.findIndex((q) => q.id === afterId) + 1;
  if (afterId !== null && start === 0) return null;
  for (const question of form.questions.slice(start)) {
    if (conditionMet(question.condition, answers)) return question;
  }
  return null;
}

export function progress(
  form: FormDefinition,
  answers: Answers,
  currentId: string,
): { index: number; total: number } {
  const position = form.questions.findIndex((q) => q.id === currentId);
  const asked = form.questions.slice(0, Math.max(position, 0)).filter((q) => q.id in answers);
  const later = form.questions
    .slice(position + 1)
    .filter(
      (q) =>
        !q.condition || !(q.condition.questionId in answers) || conditionMet(q.condition, answers),
    );
  return { index: asked.length + 1, total: asked.length + 1 + later.length };
}

export function displayValue(value: FormAnswerValue | null): string {
  if (value === null) return formsCopy.skipped;
  if (typeof value === 'boolean') return value ? formsCopy.yes : formsCopy.no;
  if (typeof value === 'number') return count(value);
  return value;
}

export function buildAnswers(form: FormDefinition, answers: Answers): SubmittedAnswer[] {
  const out: SubmittedAnswer[] = [];
  let after: string | null = null;
  for (;;) {
    const question = nextQuestion(form, answers, after);
    if (!question) break;
    const value = answers[question.id] ?? null;
    out.push({
      questionId: question.id,
      label: question.label,
      type: question.type,
      value,
      display: displayValue(value),
    });
    after = question.id;
  }
  return out;
}

export function formIssues(form: FormDefinition): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const question of form.questions) {
    if (seen.has(question.id)) issues.push(`Question id ${question.id} is used twice.`);
    if (question.type === 'choice' && question.options.length === 0) {
      issues.push(`${question.label} has no options.`);
    }
    if (question.condition && !seen.has(question.condition.questionId)) {
      issues.push(`${question.label} depends on a question that does not come before it.`);
    }
    seen.add(question.id);
  }
  return issues;
}
