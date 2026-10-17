import { describe, expect, it } from 'vitest';
import { chunk, withPageFooter } from '../src/ui/paginator.js';

describe('paginator helpers', () => {
  it('splits lists into pages', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });

  it('adds the page to the footer only when there is more than one', () => {
    expect(withPageFooter({ title: 'Top' }, 0, 1).footer).toBeUndefined();
    expect(withPageFooter({ title: 'Top' }, 1, 3).footer).toBe('Page 2 of 3');
    expect(withPageFooter({ footer: 'ID 1' }, 0, 2).footer).toBe('ID 1 / Page 1 of 2');
  });
});
