export const iconNames = [
  'ok',
  'no',
  'warn',
  'lock',
  'clock',
  'info',
  'join',
  'leave',
  'invite',
  'shield',
  'prev',
  'next',
  'neutral',
  'happy',
  'error',
  'thinking',
  'skeptical',
  'sleeping',
] as const;

export type IconName = (typeof iconNames)[number];

export interface IconSet {
  inline(name: IconName): string;
  reaction(name: IconName): string | null;
}

export function parseIconSet(spec: string): IconSet {
  const emojis = new Map<IconName, { name: string; id: string }>();
  for (const entry of spec.split(',')) {
    const [key, id] = entry.split('=').map((part) => part.trim());
    if (!key || !id || !/^\d+$/.test(id)) continue;
    if (!(iconNames as readonly string[]).includes(key)) continue;
    emojis.set(key as IconName, { name: `mx_${key}`, id });
  }

  return {
    inline(name) {
      const emoji = emojis.get(name);
      return emoji ? `<:${emoji.name}:${emoji.id}> ` : '';
    },
    reaction(name) {
      const emoji = emojis.get(name);
      return emoji ? `${emoji.name}:${emoji.id}` : null;
    },
  };
}
