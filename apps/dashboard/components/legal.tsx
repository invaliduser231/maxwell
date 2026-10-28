import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { SiteFooter, SiteHeader } from './site';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of source.trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((line) => line.trimEnd());
    const heading = /^(#{1,3}) (.*)$/.exec(lines[0] ?? '');
    if (heading && lines.length === 1) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      continue;
    }
    if (lines.every((line) => /^- /.test(line))) {
      blocks.push({ kind: 'list', ordered: false, items: lines.map((line) => line.slice(2)) });
      continue;
    }
    if (lines.every((line) => /^\d+\. /.test(line))) {
      blocks.push({
        kind: 'list',
        ordered: true,
        items: lines.map((line) => line.replace(/^\d+\. /, '')),
      });
      continue;
    }
    blocks.push({ kind: 'paragraph', lines });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (match[1] !== undefined) {
      out.push(<strong key={at}>{inline(match[1])}</strong>);
    } else {
      const href = match[3] ?? '';
      out.push(
        href.startsWith('/') ? (
          <Link key={at} href={href}>
            {match[2]}
          </Link>
        ) : (
          <a key={at} href={href} rel="noreferrer">
            {match[2]}
          </a>
        ),
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function render(block: Block, index: number): ReactNode {
  if (block.kind === 'heading') {
    if (block.level === 1) return <h1 key={index}>{inline(block.text)}</h1>;
    if (block.level === 2) return <h2 key={index}>{inline(block.text)}</h2>;
    return <h3 key={index}>{inline(block.text)}</h3>;
  }
  if (block.kind === 'list') {
    const items = block.items.map((item) => <li key={item}>{inline(item)}</li>);
    return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
  }
  return (
    <p key={index}>
      {block.lines.map((line, at) => (
        <Fragment key={line}>
          {at > 0 ? <br /> : null}
          {inline(line)}
        </Fragment>
      ))}
    </p>
  );
}

export async function LegalPage({ source, lang }: { source: string; lang?: string }) {
  return (
    <div className="mx-land">
      <SiteHeader />
      <main className="mx-land-wrap">
        <article className="mx-legal" lang={lang}>
          {parse(source).map(render)}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
