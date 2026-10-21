import { usageLine } from '../../../commands/dispatcher.js';
import { mention } from '../../../commands/mentions.js';
import type { Command, GuildContext } from '../../../commands/types.js';
import type { UserRef } from '../../../platform/types.js';
import { bold } from '../../../ui/format.js';

export const USAGE_TTL = 30_000;
export const NOISE_TTL = 8_000;

export function who(user: UserRef | null, userId: string): string {
  return user ? bold(user.displayName) : mention.user(userId);
}

export async function usage(ctx: GuildContext, command: Command, problem: string): Promise<void> {
  const { voice } = ctx.services;
  await ctx.reply({
    content: voice.usage(problem, usageLine(ctx.prefix, ctx.path, command)),
    deleteAfter: USAGE_TTL,
  });
}

export async function noise(ctx: GuildContext, content: string, ttl = USAGE_TTL): Promise<void> {
  await ctx.reply({ content, deleteAfter: ttl });
}
