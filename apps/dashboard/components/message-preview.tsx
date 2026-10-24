'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useGuild } from './guild';
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
  /`([^`\n]+)`|<@!?(\d{1,21})>|<@&(\d{1,21})>|<#(\d{1,21})>|<(a?):([\w~-]{1,32}):(\d{1,21})>|\{([a-z][\w.]*)\}|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\n]+?)\*|(?<!\w)_([^_\n]+?)_(?!\w)/gi;

interface Context {
  vars?: Vars;
  names?: MentionNames;
  channel: (id: string) => string;
  role: (id: string) => { name: string; color: string };
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
  const { channels, roles } = useGuild();
  const context: Context = {
    vars,
    names,
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
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    const key = String(index);
    const last = index === lines.length - 1;
    if (line.startsWith('-# ')) {
      nodes.push(
        <span key={key} className="mx-md-subtext">
          {inline(line.slice(3), context, key)}
        </span>,
      );
      return;
    }
    nodes.push(...inline(line, context, key));
    if (!last) nodes.push('\n');
  });
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
