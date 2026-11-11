const MAX_INPUT = 200;
const MAX_DEPTH = 32;
const MAX_FACTORIAL = 20;
const MAX_RESULT = 1e9;
const EPSILON = 1e-9;

const superscripts: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
};

const fractions: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅛': 1 / 8,
};

const constants: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  tau: Math.PI * 2,
  τ: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  φ: (1 + Math.sqrt(5)) / 2,
};

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > MAX_FACTORIAL) return Number.NaN;
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

const functions: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  root: (x, n = 2) => (n === 2 ? Math.sqrt(x) : x ** (1 / n)),
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sign: Math.sign,
  exp: Math.exp,
  ln: Math.log,
  log: (x, base = 10) => Math.log(x) / Math.log(base),
  lg: Math.log10,
  log2: Math.log2,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  pow: (x, y = 2) => x ** y,
  mod: (x, y = 1) => x % y,
  gcd: (a, b = 0) => {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) [x, y] = [y, x % y];
    return x;
  },
  fact: factorial,
  factorial,
  hypot: (...xs) => Math.hypot(...xs),
  avg: (...xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length,
  sum: (...xs) => xs.reduce((sum, x) => sum + x, 0),
};

const romanValues: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function roman(text: string): number | null {
  if (!/^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(text) || !text) return null;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = romanValues[text[i] as string] ?? 0;
    const next = romanValues[text[i + 1] as string] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

function normalize(input: string): string {
  const text = input.replace(
    /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g,
    (run) => `^(${[...run].map((char) => superscripts[char] ?? '').join('')})`,
  );
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[×✕✖·⋅•]/g, '*')
    .replace(/[÷∶]/g, '/')
    .replace(/\*\*/g, '^')
    .replace(/[［【]/g, '(')
    .replace(/[］】]/g, ')');
}

class Parser {
  #pos = 0;
  #depth = 0;
  #args = 0;

  constructor(private readonly text: string) {}

  get pos(): number {
    return this.#pos;
  }

  #space(): void {
    while (this.#pos < this.text.length && /\s/.test(this.text[this.#pos] as string)) this.#pos++;
  }

  #peek(): string {
    this.#space();
    return this.text[this.#pos] ?? '';
  }

  #word(): string | null {
    this.#space();
    const match = /^[a-zA-Zπτφ][a-zA-Z0-9]*/.exec(this.text.slice(this.#pos));
    return match ? match[0] : null;
  }

  expression(): number | null {
    if (++this.#depth > MAX_DEPTH) return null;
    let left = this.#term();
    while (left !== null) {
      const mark = this.#pos;
      const op = this.#peek();
      if (op !== '+' && op !== '-') {
        this.#pos = mark;
        break;
      }
      this.#pos++;
      const right = this.#term();
      if (right === null) {
        this.#pos = mark;
        break;
      }
      left = op === '+' ? left + right : left - right;
    }
    this.#depth--;
    return left;
  }

  #term(): number | null {
    let left = this.#unary();
    while (left !== null) {
      const mark = this.#pos;
      let op = this.#peek();
      if (op === 'x' || op === 'X' || op === ':') {
        if (!/^[\s\d(.√∛π]/.test(this.text[this.#pos + 1] ?? '')) {
          this.#pos = mark;
          break;
        }
        op = op === ':' ? '/' : '*';
      } else if (op === 'm' && this.text.slice(this.#pos, this.#pos + 3) === 'mod') {
        op = '%';
        this.#pos += 2;
      } else if (op !== '*' && op !== '/' && op !== '%') {
        const implicit = this.#implicit(left);
        if (implicit === null) {
          this.#pos = mark;
          break;
        }
        left = implicit;
        continue;
      }
      this.#pos++;
      const right = this.#unary();
      if (right === null) {
        this.#pos = mark;
        break;
      }
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
    return left;
  }

  #implicit(left: number): number | null {
    const mark = this.#pos;
    const next = this.#peek();
    if (next !== '(' && next !== '√' && next !== '∛' && !this.#word()) return null;
    const right = this.#power();
    if (right === null) {
      this.#pos = mark;
      return null;
    }
    return left * right;
  }

  #unary(): number | null {
    const op = this.#peek();
    if (op === '-' || op === '+') {
      const mark = this.#pos;
      this.#pos++;
      const value = this.#unary();
      if (value === null) {
        this.#pos = mark;
        return null;
      }
      return op === '-' ? -value : value;
    }
    return this.#power();
  }

  #power(): number | null {
    const base = this.#postfix();
    if (base === null) return null;
    const mark = this.#pos;
    if (this.#peek() !== '^') {
      this.#pos = mark;
      return base;
    }
    this.#pos++;
    const exponent = this.#unary();
    if (exponent === null) {
      this.#pos = mark;
      return base;
    }
    return base ** exponent;
  }

  #postfix(): number | null {
    let value = this.#primary();
    while (value !== null && this.text[this.#pos] === '!') {
      const after = this.text.slice(this.#pos + 1).trimStart();
      if (after === '' || /^[\p{L}!?.\s]/u.test(after)) break;
      this.#pos++;
      value = factorial(value);
    }
    if (
      value !== null &&
      this.text[this.#pos] === '%' &&
      !/^\s*[\d(]/.test(this.text.slice(this.#pos + 1))
    ) {
      this.#pos++;
      value /= 100;
    }
    return value;
  }

  #primary(): number | null {
    const char = this.#peek();
    if (char === '(' || char === '[') {
      const close = char === '(' ? ')' : ']';
      const mark = this.#pos;
      this.#pos++;
      const value = this.expression();
      if (value === null || this.#peek() !== close) {
        this.#pos = mark;
        return null;
      }
      this.#pos++;
      return value;
    }
    if (char === '|') {
      const mark = this.#pos;
      this.#pos++;
      const value = this.expression();
      if (value === null || this.#peek() !== '|') {
        this.#pos = mark;
        return null;
      }
      this.#pos++;
      return Math.abs(value);
    }
    if (char === '√' || char === '∛') {
      const mark = this.#pos;
      this.#pos++;
      const value = this.#power();
      if (value === null) {
        this.#pos = mark;
        return null;
      }
      return char === '√' ? Math.sqrt(value) : Math.cbrt(value);
    }
    const fraction = fractions[char];
    if (fraction !== undefined) {
      this.#pos++;
      return fraction;
    }
    const number = this.#number();
    if (number !== null) return number;
    return this.#named();
  }

  #number(): number | null {
    const rest = this.text.slice(this.#pos);
    const special = /^0(x[0-9a-f]+|b[01]+|o[0-7]+)(?![0-9a-z])/i.exec(rest);
    if (special) {
      this.#pos += special[0].length;
      return Number(special[0].toLowerCase());
    }
    const pattern =
      this.#args > 0
        ? /^(\d{1,15}(?:\.\d{1,15})?|\.\d{1,15})(?:e[+-]?\d{1,3})?(?!\d)/i
        : /^(\d{1,3}(?:,\d{3})+(?![\d,])|\d{1,15}(?:[.,]\d{1,15})?|[.,]\d{1,15})(?:e[+-]?\d{1,3})?(?!\d)/i;
    const match = pattern.exec(rest);
    if (!match) return null;
    const token = /^\d{1,3}(?:,\d{3})+/.test(match[0]) ? match[0].replaceAll(',', '') : match[0];
    this.#pos += match[0].length;
    const following = fractions[this.text[this.#pos] ?? ''];
    const value = Number(token.replace(',', '.'));
    if (following !== undefined) {
      this.#pos++;
      return value + following;
    }
    return value;
  }

  #named(): number | null {
    const word = this.#word();
    if (!word) return null;
    const mark = this.#pos;
    const lower = word.toLowerCase();
    const fn = functions[lower];
    if (fn) {
      this.#pos += word.length;
      const args = this.#arguments();
      if (args !== null) return fn(...args);
      const single = this.#power();
      if (single !== null) return fn(single);
      this.#pos = mark;
      return null;
    }
    const constant = constants[lower] ?? constants[word];
    if (constant !== undefined) {
      this.#pos += word.length;
      return constant;
    }
    return null;
  }

  #arguments(): number[] | null {
    const mark = this.#pos;
    if (this.#peek() !== '(') return null;
    this.#pos++;
    const args: number[] = [];
    this.#args++;
    try {
      return this.#list(args, mark);
    } finally {
      this.#args--;
    }
  }

  #list(args: number[], mark: number): number[] | null {
    for (;;) {
      const value = this.expression();
      if (value === null) break;
      args.push(value);
      const next = this.#peek();
      if (next === ',' || next === ';') {
        this.#pos++;
        continue;
      }
      if (next === ')') {
        this.#pos++;
        return args;
      }
      break;
    }
    this.#pos = mark;
    return null;
  }
}

function whole(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > EPSILON * Math.max(1, Math.abs(value))) return null;
  if (rounded < 0 || rounded > MAX_RESULT) return null;
  return rounded;
}

export function evaluateCount(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > MAX_INPUT) return null;
  const numeral = roman(trimmed.split(/\s/)[0] ?? '');
  if (numeral !== null && /^[IVXLCDM]{2,}(\s|$)/.test(trimmed)) return numeral;

  const text = normalize(trimmed);
  const parser = new Parser(text);
  const value = parser.expression();
  if (value === null) return null;
  const rest = text.slice(parser.pos);
  if (/^\s*[\d(√∛^]/.test(rest)) return null;
  if (/^[\p{L}\d]/u.test(rest)) return null;
  return whole(value);
}
