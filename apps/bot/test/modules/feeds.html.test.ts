import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { htmlToText, parseFeed } from '../../src/modules/feeds/parse.js';
import { decodeEntities } from '../../src/modules/feeds/xml.js';

function legacyStrip(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');
}

const sandbox = vm.createContext({ input: '' });
vm.runInContext(legacyStrip.toString(), sandbox);
const legacyCall = new vm.Script('legacyStrip(input)');

function legacyHtmlToText(html: string): string {
  sandbox.input = html;
  const stripped = legacyCall.runInContext(sandbox, { timeout: 1000 }) as string;
  return decodeEntities(stripped)
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mismatches(inputs: string[]): string[] {
  return inputs.filter((input) => htmlToText(input) !== legacyHtmlToText(input));
}

const tokens = [
  '< > / - & ; a x b B c e i I l L p r s S t y &amp; &nbsp; &#60; &lt; &gt; <> << >> </ </> <s </s',
  '<script <SCRIPT <ScRiPt <script> </script> </SCRIPT> </sCrIpT> </script <scripts',
  '<style <STYLE <style> </style> </Style> </style <styles <li <LI <Li <li> </li> </LI>',
  '<br <br> <br/> <p> </p> </P> <div> </div> </h1> </h7> </tr> </blockquote> <!-- --> </a>',
  '\u0130 \u0131 \u017f \u212a <l\u0130 <l\u0131 <scr\u0130pt </scr\u0131pt> <\u017fcript </\u017ftyle>',
]
  .join(' ')
  .split(' ')
  .concat([' ', '\n', '\t', '\r', '\u00a0', '</script >', '<BR />', '<br  /', '<li class="a">']);

function randomInputs(count: number, seed: number): string[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
  return Array.from({ length: count }, () => {
    const length = Math.floor(next() * (next() < 0.1 ? 200 : 40));
    return Array.from({ length }, () => tokens[Math.floor(next() * tokens.length)]).join('');
  });
}

function hostileInputs(): string[] {
  const units = ['<', '<a', '<li', '<LI', '<script', '<SCRIPT', '<style', '<br ', '</script', '<>'];
  const heads = ['', 'text ', '<p>', '<script>', '<li>', '&amp;'];
  const middles = ['', '>', '</script>', '</style>'];
  const tails = ['', '>', '</script>', '</STYLE>', '</li>', '<br/>', '</script></style>', ' > '];
  return units.flatMap((unit) =>
    [1, 2, 3, 50].flatMap((count) =>
      heads.flatMap((head) =>
        middles.flatMap((middle) =>
          tails.map((tail) => head + unit.repeat(count) + middle + unit.repeat(count) + tail),
        ),
      ),
    ),
  );
}

describe('htmlToText', () => {
  it('matches the previous regex output on odd markup', () => {
    expect(
      mismatches([
        '',
        '<',
        '<>',
        'a < b > c',
        '<p>open',
        '<script>x()',
        '<style>a{}</STYLE>b',
        '<SCRIPT>x</script>y<script>z',
        '<script</script>after',
        '<li<li>one</li>',
        '<l\u0130>x</l\u0130>',
        '<scr\u0130pt>x</scr\u0130pt>',
        '<<b>bold</b>',
        '<br/><br><BR  />text',
        '<ul><li>a</li><li>b</li></ul>',
        '<p>One&nbsp;two</p><script>x()</script><ul><li>a</li><li>b</li></ul>',
      ]),
    ).toEqual([]);
  });

  it('matches the previous regex output on random markup', () => {
    expect(mismatches(randomInputs(3000, 20261101))).toEqual([]);
  }, 30_000);

  it('matches the previous regex output on repeated unclosed tags', () => {
    expect(mismatches(hostileInputs())).toEqual([]);
  }, 30_000);

  it('stays fast on megabytes of unclosed tags', () => {
    const units = ['<', '<li', '<LI', '<script', '<style', '<script<style', '</script', '<>'];
    for (const unit of units) {
      const input = unit.repeat(Math.ceil(2_000_000 / unit.length));
      const started = performance.now();
      htmlToText(input);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  }, 30_000);

  it('parses a feed with a huge unclosed description quickly', () => {
    const description = `<![CDATA[${'<'.repeat(1_900_000)}]]>`;
    const feed = `<rss><channel><title>t</title><item><title>x</title><description>${description}</description></item></channel></rss>`;
    const started = performance.now();
    const [item] = parseFeed(feed).items;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(item?.summary.length).toBe(600);
  }, 30_000);
});
