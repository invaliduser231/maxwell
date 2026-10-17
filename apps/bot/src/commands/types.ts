import type { IncomingMessage, Outgoing, Permission, Platform } from '../platform/types.js';
import type { Services } from '../services.js';
import type { Seed } from '../ui/voice.js';
import type { ArgSpec, Args } from './args.js';

export interface CommandContext {
  message: IncomingMessage;
  guildId: string | null;
  prefix: string;
  path: string[];
  args: Args;
  services: Services;
  platform: Platform;
  seed: Seed;
  reply(out: Outgoing): Promise<string>;
}

export interface GuildContext extends CommandContext {
  guildId: string;
}

interface CommandBase {
  name: string;
  aliases?: string[];
  description: string;
  args?: ArgSpec[];
  examples?: string[];
  subcommands?: Command[];
  permissions?: Permission[];
  allow?(message: IncomingMessage, services: Services): Promise<boolean>;
  botPermissions?: Permission[];
  ownerOnly?: boolean;
  hidden?: boolean;
  cooldown?: number;
}

export interface GuildCommand extends CommandBase {
  guildOnly: true;
  run?(ctx: GuildContext): Promise<void>;
}

export interface AnywhereCommand extends CommandBase {
  guildOnly?: false;
  run?(ctx: CommandContext): Promise<void>;
}

export type Command = GuildCommand | AnywhereCommand;

export interface Module {
  key: string;
  name: string;
  description: string;
  commands: Command[];
}
