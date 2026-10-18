import { describe, expect, it } from 'vitest';
import { FeedError, htmlToText, parseFeed } from '../../src/modules/feeds/parse.js';
import { decodeEntities, parseXml } from '../../src/modules/feeds/xml.js';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>Fluxer blog</title>
<link>https://fluxer.app/blog</link>
<!-- a comment with <item> inside -->
<item>
<title>Patch notes for October 16, 2026</title>
<description>Everything we shipped from October 1 to October 16, 2026.</description>
<link>https://fluxer.app/blog/patch-notes-2026-10-16</link>
<guid isPermaLink="true">https://fluxer.app/blog/patch-notes-2026-10-16</guid>
<dc:creator>Hampus Kraft</dc:creator>
<pubDate>Fri, 16 Oct 2026 12:00:00 +0000</pubDate>
<media:content url="https://fluxer.app/static/img/blog-patch-notes-1280w.jpg" medium="image"/>
<content:encoded><![CDATA[<p>Starting with this post, we'll publish <b>patch notes</b> every Friday.</p><p>Second</p>]]></content:encoded>
</item>
<item>
<title>Roadmap &amp; plans</title>
<link>https://fluxer.app/blog/roadmap-2026</link>
<description>&lt;p&gt;Where Fluxer is headed&lt;/p&gt;&lt;img src="https://fluxer.app/r.png"&gt;</description>
<pubDate>Mon, 05 Oct 2026 09:00:00 +0000</pubDate>
</item>
</channel>
</rss>`;

const youtube = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Google for Developers</title>
 <entry>
  <id>yt:video:LJ2v4-FvPcA</id>
  <yt:videoId>LJ2v4-FvPcA</yt:videoId>
  <title>Builders building with Gemini Audio</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/LJ2v4-FvPcA"/>
  <author><name>Google for Developers</name></author>
  <published>2026-10-16T21:00:00+00:00</published>
  <updated>2026-10-19T16:31:28+00:00</updated>
  <media:group>
   <media:title>Builders building with Gemini Audio</media:title>
   <media:thumbnail url="https://i1.ytimg.com/vi/LJ2v4-FvPcA/hqdefault.jpg" width="480" height="360"/>
   <media:description>Paige Bailey catches up with builders.</media:description>
  </media:group>
 </entry>
</feed>`;

const github = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <title>Release notes from node</title>
  <entry>
    <id>tag:github.com,2008:Repository/27193779/v26.12.1</id>
    <updated>2026-10-21T10:38:29Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/nodejs/node/releases/tag/v26.12.1"/>
    <title>2026-10-21, Version 26.12.1 (Current)</title>
    <content type="html">&lt;p&gt;This is a security release.&lt;/p&gt;
&lt;ul&gt;&lt;li&gt;tls: reject non-canonical IP addresses&lt;/li&gt;&lt;/ul&gt;</content>
    <author><name>aduh95</name></author>
  </entry>
</feed>`;

const rdf = `<?xml version="1.0"?>
<!DOCTYPE rdf:RDF [ <!ENTITY boom "boom"> ]>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://example.org/"><title>Old school</title></channel>
  <item rdf:about="https://example.org/a"><title>First</title><link>https://example.org/a</link><dc:date>2026-10-01T10:00:00Z</dc:date></item>
</rdf:RDF>`;

describe('xml parser', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#228; &#x1F600; &unknown;')).toBe(
      'a & b <c> ä \u{1F600} &unknown;',
    );
  });

  it('keeps attributes with quotes and self-closing tags', () => {
    const doc = parseXml(`<a x="1 > 2" y='q'><b z=3/><c>t</c></a>`);
    const a = doc.children[0];
    expect(a?.attrs).toEqual({ x: '1 > 2', y: 'q' });
    expect(a?.children.map((node) => node.name)).toEqual(['b', 'c']);
    expect(a?.children[1]?.text).toBe('t');
  });

  it('survives broken markup', () => {
    const doc = parseXml('<a><b>one</a><c>two');
    expect(doc.children[0]?.name).toBe('a');
    expect(doc.children[1]?.name).toBe('c');
  });

  it('stops at the node limit', () => {
    const doc = parseXml(`<r>${'<i/>'.repeat(100)}</r>`, { maxNodes: 10, maxDepth: 8 });
    expect(doc.children[0]?.children.length).toBe(9);
  });
});

describe('parseFeed', () => {
  it('reads RSS 2.0 items', () => {
    const feed = parseFeed(rss);
    expect(feed.title).toBe('Fluxer blog');
    expect(feed.items).toHaveLength(2);
    const [first, second] = feed.items;
    expect(first).toMatchObject({
      id: 'https://fluxer.app/blog/patch-notes-2026-10-16',
      title: 'Patch notes for October 16, 2026',
      url: 'https://fluxer.app/blog/patch-notes-2026-10-16',
      author: 'Hampus Kraft',
      summary: 'Everything we shipped from October 1 to October 16, 2026.',
      imageUrl: 'https://fluxer.app/static/img/blog-patch-notes-1280w.jpg',
    });
    expect(first?.publishedAt?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
    expect(second?.title).toBe('Roadmap & plans');
    expect(second?.id).toBe('https://fluxer.app/blog/roadmap-2026');
    expect(second?.summary).toBe('Where Fluxer is headed');
    expect(second?.imageUrl).toBe('https://fluxer.app/r.png');
  });

  it('reads YouTube Atom entries', () => {
    const [video] = parseFeed(youtube).items;
    expect(video).toMatchObject({
      id: 'yt:video:LJ2v4-FvPcA',
      url: 'https://www.youtube.com/shorts/LJ2v4-FvPcA',
      author: 'Google for Developers',
      summary: 'Paige Bailey catches up with builders.',
      imageUrl: 'https://i1.ytimg.com/vi/LJ2v4-FvPcA/hqdefault.jpg',
    });
    expect(video?.publishedAt?.toISOString()).toBe('2026-10-16T21:00:00.000Z');
  });

  it('reads GitHub release entries with escaped html', () => {
    const [release] = parseFeed(github).items;
    expect(release?.title).toBe('2026-10-21, Version 26.12.1 (Current)');
    expect(release?.url).toBe('https://github.com/nodejs/node/releases/tag/v26.12.1');
    expect(release?.summary).toBe(
      'This is a security release.\n\n- tls: reject non-canonical IP addresses',
    );
    expect(release?.publishedAt?.toISOString()).toBe('2026-10-21T10:38:29.000Z');
  });

  it('reads RSS 1.0 and ignores the internal doctype subset', () => {
    const feed = parseFeed(rdf);
    expect(feed.items.map((item) => item.id)).toEqual(['https://example.org/a']);
    expect(feed.items[0]?.publishedAt?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('rejects documents that are not feeds', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(FeedError);
  });

  it('turns html into readable text', () => {
    expect(htmlToText('<p>One&nbsp;two</p><script>x()</script><ul><li>a</li><li>b</li></ul>')).toBe(
      'One two\n- a\n- b',
    );
  });
});
