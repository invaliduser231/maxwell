import de from 'emojibase-data/de/compact.json';
import deMessages from 'emojibase-data/de/messages.json';
import en from 'emojibase-data/en/compact.json';
import enMessages from 'emojibase-data/en/messages.json';
import es from 'emojibase-data/es/compact.json';
import esMessages from 'emojibase-data/es/messages.json';

const SKIPPED_GROUP = 2;

interface CompactEmoji {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  tags?: string[];
}

interface MessagesDataset {
  groups: { key: string; message: string; order: number }[];
}

interface Payload {
  groups: { id: number; label: string }[];
  emojis: [string, string, string, number][];
}

const built = new Map<string, string>();

type EmojiLang = 'en' | 'de' | 'es';

const locales: Record<
  Exclude<EmojiLang, 'en'>,
  { data: CompactEmoji[]; messages: MessagesDataset }
> = {
  de: { data: de as CompactEmoji[], messages: deMessages as MessagesDataset },
  es: { data: es as CompactEmoji[], messages: esMessages as MessagesDataset },
};

function build(lang: EmojiLang): string {
  const cached = built.get(lang);
  if (cached) return cached;
  const local = lang === 'en' ? null : locales[lang];
  const translated = new Map((local ?? locales.de).data.map((emoji) => [emoji.hexcode, emoji]));
  const messages = local?.messages ?? (enMessages as MessagesDataset);
  const emojis: Payload['emojis'] = [];
  for (const emoji of en as CompactEmoji[]) {
    if (emoji.group === undefined || emoji.group === SKIPPED_GROUP) continue;
    const other = translated.get(emoji.hexcode);
    const label = local && other?.label ? other.label : emoji.label;
    const search = [emoji.label, ...(emoji.tags ?? []), other?.label ?? '', ...(other?.tags ?? [])]
      .join(' ')
      .toLowerCase();
    emojis.push([emoji.unicode, label, search, emoji.group]);
  }
  const payload: Payload = {
    groups: messages.groups
      .filter((group) => group.order !== SKIPPED_GROUP)
      .map((group) => ({
        id: group.order,
        label: group.message.charAt(0).toUpperCase() + group.message.slice(1),
      })),
    emojis,
  };
  const text = JSON.stringify(payload);
  built.set(lang, text);
  return text;
}

export function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get('lang');
  const lang: EmojiLang = asked === 'de' || asked === 'es' ? asked : 'en';
  return new Response(build(lang), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
