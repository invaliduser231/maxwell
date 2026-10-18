export interface ResponseContext {
  user: { id: string; username: string; displayName: string };
  server: { id: string; name: string };
  channel: { id: string; name: string | null };
  args: string;
  match: readonly string[];
}

export type Random = () => number;

const RANDOM = /\{random:((?:[^{}]|\{[a-z0-9.]+\})*)\}/gi;
const VARIABLE = /\{([a-z]+)(?:\.([a-z0-9]+))?\}/gi;

export function pick<T>(items: readonly T[], random: Random = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.min(Math.floor(random() * items.length), items.length - 1)];
}

function variable(name: string, field: string | undefined, ctx: ResponseContext): string | null {
  const key = name.toLowerCase();
  const sub = field?.toLowerCase();
  switch (key) {
    case 'user':
      if (!sub) return ctx.user.displayName;
      if (sub === 'mention') return `<@${ctx.user.id}>`;
      if (sub === 'name') return ctx.user.username;
      if (sub === 'id') return ctx.user.id;
      return null;
    case 'server':
      if (!sub || sub === 'name') return ctx.server.name;
      if (sub === 'id') return ctx.server.id;
      return null;
    case 'channel':
      if (!sub) return `<#${ctx.channel.id}>`;
      if (sub === 'name') return ctx.channel.name ?? '';
      if (sub === 'id') return ctx.channel.id;
      return null;
    case 'args': {
      if (!sub) return ctx.args;
      const index = Number(sub);
      if (!Number.isInteger(index) || index < 1) return null;
      return ctx.args.split(/\s+/).filter(Boolean)[index - 1] ?? '';
    }
    case 'match': {
      if (!sub) return ctx.match[0] ?? '';
      const index = Number(sub);
      if (!Number.isInteger(index) || index < 0) return null;
      return ctx.match[index] ?? '';
    }
    default:
      return null;
  }
}

export function renderResponse(
  template: string,
  ctx: ResponseContext,
  random: Random = Math.random,
): string {
  const chosen = template.replace(RANDOM, (_whole, options: string) => {
    return pick(options.split('|'), random) ?? '';
  });
  return chosen.replace(VARIABLE, (whole, name: string, field: string | undefined) => {
    return variable(name, field, ctx) ?? whole;
  });
}

export function usesUserMention(template: string): boolean {
  return /\{user\.mention\}/i.test(template);
}
