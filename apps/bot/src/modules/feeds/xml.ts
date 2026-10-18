export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export interface XmlLimits {
  maxNodes: number;
  maxDepth: number;
}

const defaults: XmlLimits = { maxNodes: 50_000, maxDepth: 64 };

const named: Record<string, number> = {
  amp: 38,
  lt: 60,
  gt: 62,
  quot: 34,
  apos: 39,
  nbsp: 160,
  copy: 169,
  reg: 174,
  trade: 8482,
  hellip: 8230,
  mdash: 8212,
  ndash: 8211,
  lsquo: 8216,
  rsquo: 8217,
  ldquo: 8220,
  rdquo: 8221,
  laquo: 171,
  raquo: 187,
  middot: 183,
  bull: 8226,
  euro: 8364,
  pound: 163,
  deg: 176,
  times: 215,
  auml: 228,
  ouml: 246,
  uuml: 252,
  Auml: 196,
  Ouml: 214,
  Uuml: 220,
  szlig: 223,
  eacute: 233,
  egrave: 232,
  aacute: 225,
  agrave: 224,
  ccedil: 231,
  ntilde: 241,
};

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return '';
  if (value >= 0xd800 && value <= 0xdfff) return '';
  return String.fromCodePoint(value);
}

export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(
    /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,15});/gi,
    (whole, body: string) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        return codePoint(Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)) || whole;
      }
      const point = named[body];
      return point === undefined ? whole : codePoint(point);
    },
  );
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

export function parseXml(input: string, limits: XmlLimits = defaults): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  let i = 0;
  const length = input.length;

  const top = () => stack[stack.length - 1] ?? root;

  while (i < length) {
    const open = input.indexOf('<', i);
    if (open === -1) {
      top().text += decodeEntities(input.slice(i));
      break;
    }
    if (open > i) top().text += decodeEntities(input.slice(i, open));

    if (input.startsWith('<!--', open)) {
      const end = input.indexOf('-->', open + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', open)) {
      const end = input.indexOf(']]>', open + 9);
      top().text += input.slice(open + 9, end === -1 ? length : end);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (input.startsWith('<?', open)) {
      const end = input.indexOf('?>', open + 2);
      i = end === -1 ? length : end + 2;
      continue;
    }
    if (input.startsWith('<!', open)) {
      const bracket = input.indexOf('[', open);
      const close = input.indexOf('>', open);
      if (bracket !== -1 && (close === -1 || bracket < close)) {
        const end = input.indexOf(']>', bracket);
        i = end === -1 ? length : end + 2;
      } else {
        i = close === -1 ? length : close + 1;
      }
      continue;
    }

    const close = findTagEnd(input, open + 1);
    if (close === -1) break;
    const raw = input.slice(open + 1, close);
    i = close + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]?.name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameEnd = body.search(/[\s/]/);
    const name = nameEnd === -1 ? body : body.slice(0, nameEnd);
    if (!name) continue;

    nodes++;
    if (nodes > limits.maxNodes) break;
    const node: XmlNode = {
      name,
      attrs: nameEnd === -1 ? {} : parseAttributes(body.slice(nameEnd)),
      children: [],
      text: '',
    };
    top().children.push(node);
    if (!selfClosing && stack.length <= limits.maxDepth) stack.push(node);
  }

  return root;
}

function findTagEnd(input: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return -1;
}

export function child(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  if (!node) return undefined;
  for (const name of names) {
    const found = node.children.find((entry) => entry.name === name);
    if (found) return found;
  }
  return undefined;
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((entry) => entry.name === name) : [];
}

export function text(node: XmlNode | undefined): string {
  return node ? node.text.trim() : '';
}

export function descendant(
  node: XmlNode | undefined,
  name: string,
  depth = 4,
): XmlNode | undefined {
  if (!node || depth < 0) return undefined;
  for (const entry of node.children) {
    if (entry.name === name) return entry;
    const found = descendant(entry, name, depth - 1);
    if (found) return found;
  }
  return undefined;
}
