'use client';

import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import type { Names } from '@/lib/people';
import { clock, dayTime } from '@/lib/time';
import type { MessageView } from './load';

export function Message({
  message,
  names,
  now,
  full,
}: {
  message: MessageView;
  names: Names;
  now: number;
  full?: boolean;
}) {
  const t = useT();
  const { timezone } = useGuild();
  const maxwell = message.bot && message.authorName === 'Maxwell';
  return (
    <MessagePreview
      name={message.authorName}
      avatar={maxwell ? null : message.authorAvatar}
      bot={message.bot}
      avatarSize={30}
      style={message.deleted ? { opacity: 0.55 } : undefined}
      time={
        full ? dayTime(t, message.createdAt, now, timezone) : clock(message.createdAt, timezone)
      }
      tags={
        <>
          {message.internal ? (
            <span className="mx-chip" style={{ marginLeft: 6 }}>
              {t('Internal')}
            </span>
          ) : null}
          {message.via === 'dm' ? <span className="mx-time">{t('by DM')}</span> : null}
          {message.edited ? <span className="mx-time">{t('edited')}</span> : null}
          {message.deleted ? <span className="mx-time">{t('deleted')}</span> : null}
        </>
      }
      content={message.content}
      names={names}
    >
      {message.embeds
        .map((embed, index) => ({ embed, key: `${message.id}:${index}` }))
        .map(({ embed, key }) => (
          <EmbedPreview
            key={key}
            color={embed.color}
            author={embed.author}
            title={embed.title}
            description={embed.description}
            fields={full ? embed.fields : undefined}
            footer={full ? embed.footer : undefined}
            names={names}
          />
        ))}
      {message.attachments.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {message.attachments.map((file) => (
            <a
              key={file.url}
              className="mx-chip"
              href={file.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {file.filename}
            </a>
          ))}
        </div>
      ) : null}
    </MessagePreview>
  );
}
