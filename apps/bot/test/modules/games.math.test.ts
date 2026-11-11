import { describe, expect, it } from 'vitest';
import { evaluateCount, roman } from '../../src/modules/games/math.js';

const cases: [string, number | null][] = [
  ['42', 42],
  [' 7 nice', 7],
  ['7!', 7],
  ['7! yay', 7],
  ['hello 3', null],
  ['12345678901', null],
  ['sqrt(9)', 3],
  ['SQRT 16', 4],
  ['√9', 3],
  ['√(81)', 9],
  ['∛27', 3],
  ['cbrt(64)', 4],
  ['root(27, 3)', 3],
  ['2+1', 3],
  ['10 - 7', 3],
  ['2*3', 6],
  ['2x3', 6],
  ['2 x 3', 6],
  ['2×3', 6],
  ['2·3', 6],
  ['12/4', 3],
  ['12÷4', 3],
  ['12:4', 3],
  ['2^3', 8],
  ['2**3', 8],
  ['3²', 9],
  ['2³+1', 9],
  ['10²/4', 25],
  ['(1+2)*3', 9],
  ['[1+2]*3', 9],
  ['2(3+4)', 14],
  ['3!', 3],
  ['(3!)', 6],
  ['3!+1', 7],
  ['fact(4)', 24],
  ['|-5|', 5],
  ['abs(-5)', 5],
  ['10 mod 4', 2],
  ['10 % 4', 2],
  ['50% * 8', 4],
  ['round(pi)', 3],
  ['floor(e)', 2],
  ['ceil(2.1)', 3],
  ['2pi/pi', 2],
  ['π/π', 1],
  ['log(1000)', 3],
  ['log2(8)', 3],
  ['ln(e^2)', 2],
  ['0x1F', 31],
  ['0b101', 5],
  ['0o17', 15],
  ['1e3', 1000],
  ['1,000', 1000],
  ['2,5*2', 5],
  ['1.5*2', 3],
  ['1½*2', 3],
  ['½*10', 5],
  ['max(3, 9, 4)', 9],
  ['sum(1,2,3)', 6],
  ['gcd(12, 18)', 6],
  ['XII', 12],
  ['MMXXVI', 2026],
  ['I think so', null],
  ['sqrt(2)', null],
  ['1/3', null],
  ['-3', null],
  ['5-6 people', null],
  ['10/11', null],
  ['3 :)', 3],
  ['3 xd', 3],
  ['3 +', 3],
  ['(3', null],
  ['2^^3', null],
  ['21!', 21],
  ['(21!)', null],
  ['((((((((((((((((((((((((((((((((((1))))))))))))))))))))))))))))))))))', null],
  ['', null],
];

describe('counting with math', () => {
  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
      expect(evaluateCount(input)).toBe(expected);
    });
  }

  it('reads roman numerals only in their valid form', () => {
    expect(roman('XIV')).toBe(14);
    expect(roman('IIII')).toBeNull();
    expect(roman('VX')).toBeNull();
  });

  it('refuses very long input', () => {
    expect(evaluateCount(`1${'+0'.repeat(200)}`)).toBeNull();
  });
});
