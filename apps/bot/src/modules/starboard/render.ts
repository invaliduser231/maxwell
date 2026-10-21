import { isPublicHttps } from '../../net.js';
import type { Attachment, Embed, IncomingMessage } from '../../platform/types.js';
import { lines, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';

const imageTypes = /^image\/(png|jpe?g|gif|webp)$/i;
const imageNames = /\.(png|jpe?g|gif|webp)$/i;

export function countStars(
  users: readonly string[],
  authorId: string,
  selfId: string | null,
  selfStar: boolean,
): number {
  return new Set(users.filter((id) => id !== selfId && (selfStar || id !== authorId))).size;
}

export function jumpUrl(
  webUrl: string,
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return `${webUrl.replace(/\/+$/, '')}/channels/${guildId}/${channelId}/${messageId}`;
}

export function firstImage(attachments: readonly Attachment[]): Attachment | null {
  return (
    attachments.find((file) =>
      file.contentType ? imageTypes.test(file.contentType) : imageNames.test(file.filename),
    ) ?? null
  );
}

export function imageName(file: Attachment): string {
  const ext = imageNames.exec(file.filename)?.[1]?.toLowerCase() ?? 'png';
  return `starred.${ext === 'jpeg' ? 'jpg' : ext}`;
}

export function postEmbed(
  message: IncomingMessage,
  jump: string,
  image: Attachment | null,
  nickname?: string | null,
): Embed {
  const others = message.attachments.filter((file) => file !== image);
  return {
    color: palette.north,
    author: { name: nickname ?? message.author.displayName, iconUrl: message.author.avatarUrl },
    description: lines(
      message.content ? truncate(message.content, 3800) : null,
      ...others.slice(0, 5).map((file) => copy.attachment(file.filename)),
      message.content || others.length ? '' : null,
      `[${copy.jump}](${jump})`,
    ),
    imageUrl: image ? `attachment://${imageName(image)}` : undefined,
    footer: copy.footer(message.id),
    timestamp: message.createdAt,
  };
}

export async function download(
  url: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<Uint8Array | null> {
  if (!(await isPublicHttps(url))) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) return null;
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > maxBytes ? null : bytes;
  } catch {
    return null;
  }
}
