import type { Embed, OutgoingMessage } from '../platform/types.js';
import { lines, subtext, timestamp } from './format.js';

export function embedToMarkdown(embed: Embed): string {
  const title = embed.title && (embed.url ? `[${embed.title}](${embed.url})` : embed.title);
  const fields = embed.fields?.map((field) => `**${field.name}** ${field.value}`);
  const footer = [embed.footer, embed.timestamp && timestamp(embed.timestamp, 'f')]
    .filter(Boolean)
    .join(' / ');

  return lines(
    embed.author && `**${embed.author.name}**`,
    title && `### ${title}`,
    embed.description,
    ...(fields ?? []),
    footer ? subtext(footer) : null,
  );
}

export function flatten(message: OutgoingMessage): OutgoingMessage {
  if (!message.embeds?.length) return message;
  const body = message.embeds.map(embedToMarkdown).join('\n\n');
  return {
    ...message,
    embeds: undefined,
    files: undefined,
    content: message.content ? `${message.content}\n\n${body}` : body,
  };
}
