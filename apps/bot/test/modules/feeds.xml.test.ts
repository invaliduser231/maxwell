import { describe, expect, it } from 'vitest';
import { parseXml, type XmlNode } from '../../src/modules/feeds/xml.js';

const leaf = (name: string, text = ''): XmlNode => ({ name, attrs: {}, children: [], text });

const documentOf = (children: XmlNode[], text = ''): XmlNode => ({
  name: '#document',
  attrs: {},
  children,
  text,
});

describe('xml declarations', () => {
  it('skips an internal doctype subset up to the first ]>', () => {
    expect(parseXml('<!DOCTYPE r [ <!ENTITY e "v"> <a>hidden</a> ]><r>ok</r>')).toEqual(
      documentOf([leaf('r', 'ok')]),
    );
    expect(parseXml('<!DOCTYPE r [ <!ENTITY e "[x]"> ]><r/>')).toEqual(documentOf([leaf('r')]));
    expect(parseXml('<!DOCTYPE r [ <!ENTITY e "x]>"> ]><r/>')).toEqual(
      documentOf([leaf('r')], '"> ]>'),
    );
    expect(parseXml('<!x [>tail]><r/>')).toEqual(documentOf([leaf('r')]));
  });

  it('ends a declaration without a bracket at its first >', () => {
    expect(parseXml('<!DOCTYPE r><r>a</r><s>[</s>')).toEqual(
      documentOf([leaf('r', 'a'), leaf('s', '[')]),
    );
    expect(parseXml('<!x>tail[<r/>]>')).toEqual(documentOf([leaf('r')], 'tail[]>'));
    expect(parseXml('<!>[]><r/>')).toEqual(documentOf([leaf('r')], '[]>'));
  });

  it('drops the rest of the document after an unterminated declaration', () => {
    expect(parseXml('<r>a</r><!x')).toEqual(documentOf([leaf('r', 'a')]));
    expect(parseXml('<r>a</r><![ <s/>')).toEqual(documentOf([leaf('r', 'a')]));
    expect(parseXml('<!x [>tail<r/>')).toEqual(documentOf([]));
  });

  it.each([
    ['empty declarations', '<!>'.repeat(700_000)],
    ['empty declarations before a late bracket', `${'<!>'.repeat(700_000)}[`],
    ['declarations between text', '<!>x'.repeat(500_000)],
    ['long declarations', `<!${'a'.repeat(20)}>`.repeat(90_000)],
  ])('skips %s in linear time', (_name, run) => {
    const started = performance.now();
    const doc = parseXml(`${run}<r>ok</r>`);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(doc.children).toEqual([leaf('r', 'ok')]);
  });
});
