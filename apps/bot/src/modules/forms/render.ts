import type { FormDefinition, FormQuestion } from '@maxwell/core/modules/forms';
import type { FormSubmission, SubmittedAnswer, VoteTally } from '@maxwell/core/stores/forms';
import type { Embed, UserRef } from '../../platform/types.js';
import { bold, lines, subtext, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { formsCopy as copy } from './copy.js';
import { type AnswerProblem, type Answers, progress } from './engine.js';

const DESCRIPTION_LIMIT = 4_000;

function hint(question: FormQuestion): string | null {
  switch (question.type) {
    case 'choice':
      return copy.hintChoice;
    case 'yesno':
      return copy.hintYesNo;
    case 'number':
      return copy.hintNumber(question.min, question.max);
    default:
      return null;
  }
}

export function questionText(form: FormDefinition, answers: Answers, question: FormQuestion) {
  const { index, total } = progress(form, answers, question.id);
  const notes = [hint(question), question.required ? null : copy.hintOptional].filter(Boolean);
  return lines(
    copy.questionHeader(index, total),
    bold(question.label),
    question.description || null,
    ...(question.type === 'choice'
      ? question.options.map((option, i) => copy.option(i + 1, option))
      : []),
    notes.length ? subtext(notes.join(' ')) : null,
  );
}

export function problemText(question: FormQuestion, problem: AnswerProblem): string {
  switch (problem) {
    case 'required':
      return copy.problemRequired;
    case 'number':
      return copy.problemNumber;
    case 'tooSmall':
      return copy.problemTooSmall(question.min ?? 0);
    case 'tooLarge':
      return copy.problemTooLarge(question.max ?? 0);
    case 'tooShort':
      return copy.problemTooShort(question.min ?? 0);
    case 'tooLong':
      return copy.problemTooLong(Math.min(question.max ?? 1_000, 1_000));
    case 'choice':
      return copy.problemChoice;
    case 'yesno':
      return copy.problemYesNo;
  }
}

export function answersText(answers: readonly SubmittedAnswer[], limit = DESCRIPTION_LIMIT) {
  const each = Math.max(Math.floor(limit / Math.max(answers.length, 1)) - 40, 80);
  const blocks = answers.map((answer) =>
    lines(
      bold(answer.label),
      truncate(answer.display, each)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    ),
  );
  return truncate(blocks.join('\n\n'), limit);
}

export interface ReviewState {
  tally: VoteTally;
  accept: string;
  decline: string;
}

export function reviewEmbed(
  submission: FormSubmission,
  user: UserRef | null,
  state: ReviewState,
): Embed {
  const color =
    submission.status === 'accepted'
      ? palette.success
      : submission.status === 'declined'
        ? palette.danger
        : palette.north;
  const status =
    submission.status === 'accepted'
      ? copy.statusAccepted(submission.decidedBy)
      : submission.status === 'declined'
        ? copy.statusDeclined(submission.decidedBy)
        : null;
  const footer = [
    copy.reviewFooter(submission.number, submission.userId),
    copy.reviewVotes(state.tally.accept, state.tally.decline),
  ].join(' / ');

  return {
    color,
    author: user
      ? { name: `${user.displayName} (@${user.username})`, iconUrl: user.avatarUrl }
      : undefined,
    title: submission.formName,
    description: lines(
      status,
      status && submission.note ? copy.statusNote(truncate(submission.note, 500)) : null,
      status ? '' : null,
      answersText(submission.answers, DESCRIPTION_LIMIT - 400),
      submission.status === 'pending' ? '' : null,
      submission.status === 'pending'
        ? subtext(copy.reviewHint(state.accept, state.decline))
        : null,
    ),
    footer,
    timestamp: submission.createdAt,
  };
}
