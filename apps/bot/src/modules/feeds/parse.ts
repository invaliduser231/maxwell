import {
  child,
  children,
  decodeEntities,
  descendant,
  parseXml,
  text,
  type XmlNode,
} from './xml.js';

export interface FeedItem {
  id: string;
  title: string;
  url: string | null;
  summary: string;
  author: string | null;
  publishedAt: Date | null;
  imageUrl: string | null;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

const MAX_ITEMS = 50;
const SUMMARY_MAX = 600;
const BLOCK_TAGS = ['script', 'style'];

function tagAt(html: string, at: number, tag: string): boolean {
  for (let i = 0; i < tag.length; i++) {
    const code = html.charCodeAt(at + i);
    if ((code >= 65 && code <= 90 ? code + 32 : code) !== tag.charCodeAt(i)) return false;
  }
  return true;
}

function findTag(html: string, tag: string, from: number): number {
  let at = html.indexOf('<', from);
  while (at !== -1 && !tagAt(html, at, tag)) at = html.indexOf('<', at + 1);
  return at;
}

function removeBlocks(html: string): string {
  const unclosed = new Set<string>();
  let out = '';
  let kept = 0;
  let at = html.indexOf('<');
  while (at !== -1) {
    let next = at + 1;
    const name = BLOCK_TAGS.find((tag) => tagAt(html, next, tag));
    if (name && !unclosed.has(name)) {
      const close = findTag(html, `</${name}>`, next + name.length);
      if (close === -1) {
        unclosed.add(name);
      } else {
        out += html.slice(kept, at);
        kept = close + name.length + 3;
        next = kept;
      }
    }
    at = html.indexOf('<', next);
  }
  return out + html.slice(kept);
}

function replaceTags(html: string, open: string, replacement: string, minBody = 0): string {
  let out = '';
  let kept = 0;
  let at = findTag(html, open, 0);
  while (at !== -1) {
    const end = html.indexOf('>', at + open.length);
    if (end === -1) break;
    let next = at + 1;
    if (end - at - open.length >= minBody) {
      out += html.slice(kept, at) + replacement;
      kept = end + 1;
      next = kept;
    }
    at = findTag(html, open, next);
  }
  return out + html.slice(kept);
}

export function htmlToText(html: string): string {
  const breaks = removeBlocks(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n');
  const stripped = replaceTags(replaceTags(breaks, '<li', '- '), '<', '', 1);
  return decodeEntities(stripped)
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function deepText(node: XmlNode | undefined): string {
  if (!node) return '';
  return [node.text, ...node.children.map(deepText)].join(' ');
}

function firstImage(html: string): string | null {
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return match?.[1] && /^https:\/\//i.test(match[1]) ? decodeEntities(match[1]) : null;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function mediaImage(node: XmlNode): string | null {
  const group = child(node, 'media:group');
  const thumb = child(group, 'media:thumbnail') ?? child(node, 'media:thumbnail');
  if (thumb?.attrs.url) return httpUrl(thumb.attrs.url);
  const contents = [...children(node, 'media:content'), ...children(group, 'media:content')];
  const image = contents.find(
    (entry) => entry.attrs.medium === 'image' || entry.attrs.type?.startsWith('image/'),
  );
  if (image?.attrs.url) return httpUrl(image.attrs.url);
  const enclosure = children(node, 'enclosure').find((entry) =>
    entry.attrs.type?.startsWith('image/'),
  );
  return httpUrl(enclosure?.attrs.url);
}

function clean(value: string, max: number): string {
  const flat = htmlToText(value);
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function atomLink(entry: XmlNode): string | null {
  const links = children(entry, 'link');
  const preferred =
    links.find((link) => link.attrs.rel === 'alternate') ??
    links.find((link) => !link.attrs.rel) ??
    links[0];
  return httpUrl(preferred?.attrs.href);
}

function atomItem(entry: XmlNode): FeedItem | null {
  const url = atomLink(entry);
  const title = clean(text(child(entry, 'title')), 256);
  const id = text(child(entry, 'id')) || url || title;
  if (!id) return null;
  const content = child(entry, 'content');
  const summaryNode = child(entry, 'summary') ?? content;
  const rawSummary =
    summaryNode?.attrs.type === 'xhtml' ? deepText(summaryNode) : text(summaryNode);
  const description = text(child(child(entry, 'media:group'), 'media:description'));
  const author = text(child(child(entry, 'author'), 'name')) || null;
  return {
    id,
    title: title || url || id,
    url,
    summary: clean(rawSummary || description, SUMMARY_MAX),
    author,
    publishedAt: parseDate(text(child(entry, 'published', 'updated', 'issued', 'modified'))),
    imageUrl: mediaImage(entry) ?? firstImage(text(content) || rawSummary),
  };
}

function rssItem(item: XmlNode): FeedItem | null {
  const url = httpUrl(text(child(item, 'link'))) ?? httpUrl(item.attrs['rdf:about']);
  const title = clean(text(child(item, 'title')), 256);
  const guid = text(child(item, 'guid'));
  const id = guid || item.attrs['rdf:about'] || url || title;
  if (!id) return null;
  const encoded = text(child(item, 'content:encoded'));
  const description = text(child(item, 'description')) || encoded;
  const author = text(child(item, 'dc:creator', 'author', 'itunes:author')) || null;
  return {
    id,
    title: title || url || id,
    url,
    summary: clean(description, SUMMARY_MAX),
    author,
    publishedAt: parseDate(text(child(item, 'pubDate', 'dc:date', 'published', 'updated'))),
    imageUrl: mediaImage(item) ?? firstImage(encoded || description),
  };
}

export function parseFeed(xml: string): ParsedFeed {
  const document = parseXml(xml);
  const feed = child(document, 'feed');
  if (feed) {
    return {
      title: clean(text(child(feed, 'title')), 256),
      items: children(feed, 'entry')
        .slice(0, MAX_ITEMS)
        .map(atomItem)
        .filter((item): item is FeedItem => item !== null),
    };
  }

  const rss = child(document, 'rss');
  const channel = child(rss, 'channel');
  if (channel) {
    return {
      title: clean(text(child(channel, 'title')), 256),
      items: children(channel, 'item')
        .slice(0, MAX_ITEMS)
        .map(rssItem)
        .filter((item): item is FeedItem => item !== null),
    };
  }

  const rdf = child(document, 'rdf:RDF') ?? descendant(document, 'rdf:RDF', 1);
  if (rdf) {
    return {
      title: clean(text(child(child(rdf, 'channel'), 'title')), 256),
      items: children(rdf, 'item')
        .slice(0, MAX_ITEMS)
        .map(rssItem)
        .filter((item): item is FeedItem => item !== null),
    };
  }

  throw new FeedError('not_a_feed');
}

export class FeedError extends Error {
  constructor(
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
