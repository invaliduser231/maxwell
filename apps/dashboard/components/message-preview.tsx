'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useGuild } from './guild';
import { useT } from './i18n';
import { Avatar, roleColor } from './ui';

const EMOJI = 'https://fluxerusercontent.com/emojis';
const MAXWELL = 'Maxwell';

export type Vars = Record<string, string>;
export type MentionNames = Record<string, { name: string }>;

export function MaxwellAvatar({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="100" cy="100" r="100" fill="#F26B3A" />
      <path
        d="M50 143V93a25 25 0 0 1 50 0v50M100 93a25 25 0 0 1 50 0v50"
        fill="none"
        stroke="#17171B"
        strokeWidth="22"
      />
      <path d="M39 127h22v16H39zM89 127h22v16H89zM139 127h22v16h-22z" fill="#E6E6EA" />
    </svg>
  );
}

const INLINE =
  /`([^`\n]+)`|<@!?(\d{1,21})>|<@&(\d{1,21})>|<#(\d{1,21})>|<(a?):([\w~-]{1,32}):(\d{1,21})>|<t:(-?\d{1,13})(?::([tdfr]))?>|\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)|<?(https?:\/\/[^\s<>]*[^\s<>.,:;"')\]!?])>?|\|\|([\s\S]+?)\|\||\{([a-z][\w.]*)\}|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\n]+?)\*|(?<!\w)_([^_\n]+?)_(?!\w)/gi;

const FENCE = /```(?:([\w+#.-]{1,20})?\n)?([\s\S]*?)```/g;
const HEADING = /^(#{1,3}) (.+)$/;

interface Context {
  vars?: Vars;
  names?: MentionNames;
  locale: string;
  timezone: string;
  channel: (id: string) => string;
  role: (id: string) => { name: string; color: string };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

const STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
};

function relative(seconds: number, locale: string): string {
  const diff = seconds - Date.now() / 1000;
  const [unit, size] = UNITS.find(([, step]) => Math.abs(diff) >= step) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(diff / size),
    unit,
  );
}

function timestamp(seconds: number, style: string, context: Context): string {
  if (style === 'R' || style === 'r') return relative(seconds, context.locale);
  const options = STYLES[style] ?? STYLES.f;
  try {
    return new Intl.DateTimeFormat(context.locale, {
      ...options,
      timeZone: context.timezone,
    }).format(seconds * 1000);
  } catch {
    return new Intl.DateTimeFormat(context.locale, options).format(seconds * 1000);
  }
}

function inline(text: string, context: Context, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const id = `${key}.${at}`;
    const [
      ,
      code,
      user,
      role,
      channel,
      animated,
      emojiName,
      emojiId,
      time,
      timeStyle,
      linkText,
      linkUrl,
      url,
      spoiler,
      placeholder,
      bold,
      underline,
      strike,
      starItalic,
      lineItalic,
    ] = match;
    if (code !== undefined) {
      out.push(
        <code key={id} className="mx-md-code">
          {code}
        </code>,
      );
    } else if (user) {
      out.push(
        <span key={id} className="mx-mention">
          @{context.names?.[user]?.name ?? 'member'}
        </span>,
      );
    } else if (role) {
      const found = context.role(role);
      out.push(
        <span key={id} className="mx-mention" style={{ color: found.color }}>
          @{found.name}
        </span>,
      );
    } else if (channel) {
      out.push(
        <span key={id} className="mx-mention">
          {context.channel(channel)}
        </span>,
      );
    } else if (emojiId) {
      out.push(
        <img
          key={id}
          className="mx-emoji"
          src={`${EMOJI}/${emojiId}.webp${animated ? '?animated=true' : ''}`}
          alt={`:${emojiName}:`}
          title={`:${emojiName}:`}
          width={20}
          height={20}
        />,
      );
    } else if (time !== undefined) {
      const seconds = Number(time);
      out.push(
        <time
          key={id}
          className="mx-md-time"
          dateTime={new Date(seconds * 1000).toISOString()}
          title={timestamp(seconds, 'F', context)}
          suppressHydrationWarning
        >
          {timestamp(seconds, timeStyle ?? 'f', context)}
        </time>,
      );
    } else if (linkUrl !== undefined || url !== undefined) {
      const href = linkUrl ?? url ?? '';
      out.push(
        <a key={id} className="mx-md-link" href={href} target="_blank" rel="noopener noreferrer">
          {linkText !== undefined ? inline(linkText, context, id) : href}
        </a>,
      );
    } else if (spoiler !== undefined) {
      out.push(
        <span
          key={id}
          className="mx-md-spoiler"
          role="button"
          tabIndex={0}
          onClick={(event) => event.currentTarget.setAttribute('data-open', '')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.currentTarget.setAttribute('data-open', '');
            }
          }}
        >
          {inline(spoiler, context, id)}
        </span>,
      );
    } else if (placeholder !== undefined) {
      const value = context.vars?.[placeholder.toLowerCase()];
      if (!context.vars) {
        out.push(match[0]);
      } else if (value === undefined) {
        out.push(
          <span key={id} className="mx-token">
            {`{${placeholder}}`}
          </span>,
        );
      } else if (value.startsWith('@') || value.startsWith('#')) {
        out.push(
          <span key={id} className="mx-mention">
            {value}
          </span>,
        );
      } else {
        out.push(...inline(value, { ...context, vars: undefined }, id));
      }
    } else if (bold !== undefined) {
      out.push(<strong key={id}>{inline(bold, context, id)}</strong>);
    } else if (underline !== undefined) {
      out.push(<u key={id}>{inline(underline, context, id)}</u>);
    } else if (strike !== undefined) {
      out.push(<s key={id}>{inline(strike, context, id)}</s>);
    } else {
      out.push(<em key={id}>{inline(starItalic ?? lineItalic ?? '', context, id)}</em>);
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function blocks(text: string, context: Context, key: string, nodes: ReactNode[]) {
  const rows = text.split('\n');
  let quote: string[] = [];
  const block = (node: ReactNode) => {
    if (nodes[nodes.length - 1] === '\n') nodes.pop();
    nodes.push(node);
  };
  const flush = (at: number) => {
    if (quote.length === 0) return;
    const id = `${key}.q${at}`;
    const inner: ReactNode[] = [];
    blocks(quote.join('\n'), context, id, inner);
    block(
      <span key={id} className="mx-md-quote">
        {inner}
      </span>,
    );
    quote = [];
  };
  for (let index = 0; index < rows.length; index++) {
    const line = rows[index] ?? '';
    const id = `${key}.${index}`;
    if (line.startsWith('>>> ')) {
      flush(index);
      quote = [line.slice(4), ...rows.slice(index + 1)];
      flush(index);
      return;
    }
    if (line === '>' || line.startsWith('> ')) {
      quote.push(line.slice(2));
      continue;
    }
    flush(index);
    const heading = HEADING.exec(line);
    if (heading) {
      block(
        <span key={id} className={`mx-md-h${heading[1]?.length ?? 1}`}>
          {inline(heading[2] ?? '', context, id)}
        </span>,
      );
      continue;
    }
    if (line.startsWith('-# ')) {
      block(
        <span key={id} className="mx-md-subtext">
          {inline(line.slice(3), context, id)}
        </span>,
      );
      continue;
    }
    nodes.push(...inline(line, context, id));
    if (index < rows.length - 1) nodes.push('\n');
  }
  flush(rows.length);
}

export function Markdown({
  text,
  vars,
  names,
  as: Tag = 'div',
}: {
  text: string;
  vars?: Vars;
  names?: MentionNames;
  as?: 'div' | 'span';
}) {
  const { channels, roles, timezone } = useGuild();
  const t = useT();
  const context: Context = {
    vars,
    names,
    locale: t.locale,
    timezone,
    channel: (id) => {
      const found = channels.find((entry) => entry.id === id);
      return found ? `#${found.name}` : '#deleted-channel';
    },
    role: (id) => {
      const found = roles.find((entry) => entry.id === id);
      return {
        name: found?.name ?? 'deleted-role',
        color: found?.color ? roleColor(found.color) : 'inherit',
      };
    },
  };
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const at = match.index ?? 0;
    if (at > last) blocks(text.slice(last, at).replace(/\n$/, ''), context, `b${last}`, nodes);
    nodes.push(
      <code key={`f${at}`} className="mx-md-block">
        {(match[2] ?? '').replace(/\n$/, '')}
      </code>,
    );
    last = at + match[0].length;
    if (text[last] === '\n') last++;
  }
  if (last < text.length || last === 0) blocks(text.slice(last), context, `b${last}`, nodes);
  return <Tag className="mx-md">{nodes}</Tag>;
}

function colorOf(color: string | number | null | undefined): string {
  if (typeof color === 'number') return `#${color.toString(16).padStart(6, '0')}`;
  return color || '#3A3A44';
}

export interface EmbedField {
  name: string;
  value: string;
}

export function EmbedPreview({
  color,
  author,
  title,
  description,
  fields,
  footer,
  vars,
  names,
  children,
}: {
  color?: string | number | null;
  author?: ReactNode;
  title?: ReactNode;
  description?: string | null;
  fields?: readonly EmbedField[];
  footer?: ReactNode;
  vars?: Vars;
  names?: MentionNames;
  children?: ReactNode;
}) {
  return (
    <div className="mx-embed">
      <div className="mx-embed-bar" style={{ background: colorOf(color) }} />
      <div className="mx-embed-body">
        {author ? <span className="mx-sub">{author}</span> : null}
        {title ? <strong>{title}</strong> : null}
        {description ? <Markdown text={description} vars={vars} names={names} /> : null}
        {fields?.map((field) => (
          <span
            key={`${field.name}:${field.value}`}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <span className="mx-sub">{field.name}</span>
            <Markdown text={field.value} vars={vars} names={names} as="span" />
          </span>
        ))}
        {children}
        {footer ? <span className="mx-sub">{footer}</span> : null}
      </div>
    </div>
  );
}

export function MessagePreview({
  name = MAXWELL,
  avatar,
  icon,
  bot = name === MAXWELL,
  time,
  tags,
  content,
  vars,
  names,
  divided,
  style,
  avatarSize = 36,
  accent = bot && name === MAXWELL,
  children,
}: {
  name?: string;
  avatar?: string | null;
  icon?: ReactNode;
  bot?: boolean;
  time?: ReactNode;
  tags?: ReactNode;
  content?: string | null;
  vars?: Vars;
  names?: MentionNames;
  divided?: boolean;
  style?: CSSProperties;
  avatarSize?: number;
  accent?: boolean;
  children?: ReactNode;
}) {
  const maxwell = bot && name === MAXWELL && !avatar;
  return (
    <div
      className="mx-msg"
      style={{ ...(divided ? { paddingTop: 10, borderTop: '1px solid #2B2B33' } : {}), ...style }}
    >
      {icon ??
        (maxwell ? (
          <MaxwellAvatar size={avatarSize} />
        ) : (
          <Avatar src={avatar} name={name} size={avatarSize} />
        ))}
      <div className="mx-msg-body">
        <div>
          <span className="mx-msg-name" style={accent ? { color: '#F26B3A' } : undefined}>
            {name}
          </span>
          {bot ? <span className="mx-bot-tag">Bot</span> : null}
          {time ? <span className="mx-time">{time}</span> : null}
          {tags}
        </div>
        {content ? <Markdown text={content} vars={vars} names={names} /> : null}
        {children}
      </div>
    </div>
  );
}
