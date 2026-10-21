const custom = /^<(a?):([\w~-]{1,32}):(\d{15,21})>$/;
const bare = /^([\w~-]{1,32}):(\d{15,21})$/;

export function normalizeEmoji(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const tagged = custom.exec(text);
  if (tagged) return `${tagged[2]}:${tagged[3]}`;
  const plain = bare.exec(text);
  if (plain) return `${plain[1]}:${plain[2]}`;
  if (/\s/.test(text) || [...text].length > 12 || /^[\w~-]+$/.test(text)) return null;
  return text;
}

export function emojiKey(emoji: string): string {
  const normalized = normalizeEmoji(emoji) ?? emoji.trim();
  const id = bare.exec(normalized)?.[2];
  return id ?? normalized.replaceAll('️', '');
}

export function sameEmoji(a: string, b: string): boolean {
  return emojiKey(a) === emojiKey(b);
}

export function displayEmoji(emoji: string): string {
  const text = emoji.trim();
  if (custom.test(text)) return text;
  const plain = bare.exec(text);
  return plain ? `<:${plain[1]}:${plain[2]}>` : text;
}
