import definition, { type FormDefinition, formsConfig } from '@maxwell/core/modules/forms';
import { describe, expect, it } from 'vitest';
import {
  buildAnswers,
  conditionMet,
  formIssues,
  isCancel,
  nextQuestion,
  parseAnswer,
  progress,
} from '../../src/modules/forms/engine.js';
import { problemText, questionText, reviewEmbed } from '../../src/modules/forms/render.js';
import { findForm, openForms } from '../../src/modules/forms/sessions.js';

const config = formsConfig.parse({
  forms: [
    {
      id: 'staff',
      name: 'Staff application',
      questions: [
        { id: 'age', label: 'How old are you?', type: 'number', min: 13, max: 99 },
        { id: 'mod', label: 'Moderated before?', type: 'yesno' },
        {
          id: 'where',
          label: 'Where?',
          condition: { questionId: 'mod', operator: 'equals', value: 'yes' },
        },
        { id: 'role', label: 'Which team?', type: 'choice', options: ['Events', 'Support'] },
        {
          id: 'events',
          label: 'Event ideas?',
          required: false,
          condition: { questionId: 'role', operator: 'equals', value: 'events' },
        },
        {
          id: 'adult',
          label: 'Can you run late events?',
          type: 'yesno',
          condition: { questionId: 'age', operator: 'greaterThan', value: '17' },
        },
      ],
    },
    { id: 'empty', name: 'Empty' },
    { id: 'off', name: 'Off', enabled: false, questions: [{ id: 'a', label: 'A' }] },
  ],
});
const staff = config.forms[0] as FormDefinition;
const question = (id: string) => {
  const found = staff.questions.find((q) => q.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('forms config', () => {
  it('parses an empty config', () => {
    const parsed = formsConfig.parse({});
    expect(parsed.forms).toEqual([]);
    expect(parsed.sessionMinutes).toBe(30);
  });

  it('fills action defaults', () => {
    expect(staff.onAccept).toEqual({
      addRoleIds: [],
      removeRoleIds: [],
      openTicket: false,
      ticketPanelId: null,
      dm: '',
    });
  });

  it('keeps every table behind the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('forms_')).toBe(true);
    }
  });

  it('lists open forms and finds them by id or name', () => {
    expect(openForms(config).map((form) => form.id)).toEqual(['staff']);
    expect(findForm(config, 'Staff Application')?.id).toBe('staff');
    expect(findForm(config, 'STAFF')?.id).toBe('staff');
    expect(findForm(config, '')).toBeNull();
  });
});

describe('parseAnswer', () => {
  it('reads numbers with limits', () => {
    expect(parseAnswer(question('age'), '21')).toEqual({ ok: true, value: 21 });
    expect(parseAnswer(question('age'), '1,000')).toEqual({ ok: false, problem: 'tooLarge' });
    expect(parseAnswer(question('age'), '12')).toEqual({ ok: false, problem: 'tooSmall' });
    expect(parseAnswer(question('age'), 'twenty')).toEqual({ ok: false, problem: 'number' });
    expect(parseAnswer(question('age'), '')).toEqual({ ok: false, problem: 'required' });
  });

  it('reads yes and no in several languages', () => {
    expect(parseAnswer(question('mod'), 'Yes.')).toEqual({ ok: true, value: true });
    expect(parseAnswer(question('mod'), 'nein')).toEqual({ ok: true, value: false });
    expect(parseAnswer(question('mod'), 'maybe')).toEqual({ ok: false, problem: 'yesno' });
  });

  it('reads choices by number or text', () => {
    expect(parseAnswer(question('role'), '2')).toEqual({ ok: true, value: 'Support' });
    expect(parseAnswer(question('role'), 'events')).toEqual({ ok: true, value: 'Events' });
    expect(parseAnswer(question('role'), '3')).toEqual({ ok: false, problem: 'choice' });
  });

  it('lets optional questions be skipped', () => {
    expect(parseAnswer(question('events'), 'skip')).toEqual({ ok: true, value: null });
    expect(parseAnswer(question('where'), 'skip')).toEqual({ ok: false, problem: 'required' });
  });

  it('checks text length', () => {
    const short = { ...question('where'), min: 5, max: 10 };
    expect(parseAnswer(short, 'abc')).toEqual({ ok: false, problem: 'tooShort' });
    expect(parseAnswer(short, 'abcdefghijk')).toEqual({ ok: false, problem: 'tooLong' });
    expect(parseAnswer(short, 'abcdef')).toEqual({ ok: true, value: 'abcdef' });
  });

  it('knows cancel words', () => {
    expect(isCancel(' Cancel ')).toBe(true);
    expect(isCancel('no')).toBe(false);
  });
});

describe('conditions', () => {
  it('compares answers by type', () => {
    const equals = { questionId: 'x', operator: 'equals' as const, value: 'yes' };
    expect(conditionMet(equals, { x: true })).toBe(true);
    expect(conditionMet(equals, { x: false })).toBe(false);
    expect(conditionMet({ ...equals, value: 'Events' }, { x: 'events' })).toBe(true);
    expect(conditionMet({ ...equals, value: '18' }, { x: 18 })).toBe(true);
    expect(conditionMet({ ...equals, operator: 'notEquals' }, {})).toBe(true);
    expect(conditionMet(equals, { x: null })).toBe(false);
    expect(
      conditionMet({ ...equals, operator: 'includes', value: 'disc' }, { x: 'On Discord' }),
    ).toBe(true);
    expect(conditionMet({ ...equals, operator: 'greaterThan', value: '17' }, { x: 18 })).toBe(true);
    expect(conditionMet({ ...equals, operator: 'lessThan', value: '17' }, { x: 18 })).toBe(false);
    expect(conditionMet({ ...equals, operator: 'lessThan', value: 'abc' }, { x: 18 })).toBe(false);
  });

  it('walks the questions by condition', () => {
    expect(nextQuestion(staff, {}, null)?.id).toBe('age');
    expect(nextQuestion(staff, { age: 15, mod: false }, 'mod')?.id).toBe('role');
    expect(nextQuestion(staff, { age: 15, mod: true }, 'mod')?.id).toBe('where');
    expect(nextQuestion(staff, { age: 15, mod: false, role: 'Support' }, 'role')).toBeNull();
    expect(nextQuestion(staff, { age: 30, mod: false, role: 'Support' }, 'role')?.id).toBe('adult');
    expect(nextQuestion(staff, {}, 'missing')).toBeNull();
  });

  it('builds the submitted answers in order', () => {
    const answers = {
      age: 30,
      mod: true,
      where: 'Elsewhere',
      role: 'Events',
      events: null,
      adult: false,
    };
    expect(buildAnswers(staff, answers).map((a) => [a.questionId, a.display])).toEqual([
      ['age', '30'],
      ['mod', 'Yes'],
      ['where', 'Elsewhere'],
      ['role', 'Events'],
      ['events', 'Skipped'],
      ['adult', 'No'],
    ]);
  });

  it('counts progress with undecided conditions', () => {
    expect(progress(staff, {}, 'age')).toEqual({ index: 1, total: 6 });
    expect(progress(staff, { age: 15, mod: false }, 'role')).toEqual({ index: 3, total: 4 });
  });

  it('reports broken forms', () => {
    const broken = formsConfig.parse({
      forms: [
        {
          id: 'b',
          name: 'B',
          questions: [
            {
              id: 'one',
              label: 'One',
              type: 'choice',
              condition: { questionId: 'two', value: 'x' },
            },
            { id: 'two', label: 'Two' },
          ],
        },
      ],
    }).forms[0] as FormDefinition;
    expect(formIssues(broken)).toHaveLength(2);
    expect(formIssues(staff)).toEqual([]);
  });
});

describe('render', () => {
  it('shows choices and hints in a question', () => {
    const text = questionText(staff, { age: 15, mod: false }, question('role'));
    expect(text).toContain('Question 3 of 4');
    expect(text).toContain('`1` Events');
    expect(text).toContain('Reply with the number or the option.');
    expect(problemText(question('age'), 'tooSmall')).toBe('It has to be at least 13.');
  });

  it('renders a review embed with status and votes', () => {
    const embed = reviewEmbed(
      {
        id: '4009',
        number: 9,
        guildId: '1',
        formId: 'staff',
        formName: 'Staff application',
        userId: '2',
        answers: buildAnswers(staff, { age: 30, mod: false, role: 'Support', adult: true }),
        status: 'accepted',
        reviewChannelId: null,
        reviewMessageId: null,
        decidedBy: '3',
        decidedAt: new Date(0),
        note: 'Welcome',
        applied: null,
        createdAt: new Date(0),
      },
      null,
      { tally: { accept: 2, decline: 1 }, accept: 'a', decline: 'd' },
    );
    expect(embed.description).toContain('**Accepted** by <@3>');
    expect(embed.description).toContain('> Support');
    expect(embed.footer).toBe('Submission 9 / User 2 / 2 accept, 1 decline');
  });
});
