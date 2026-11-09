import type { ArgSpec } from '../commands/args.js';
import { translate } from '../i18n/catalog.js';
import type { Permission } from '../platform/types.js';
import { uiCopy as copy } from './copy.js';
import { andList, code, lines, subtext, timestamp } from './format.js';
import type { IconName, IconSet } from './icons.js';
import { Variants } from './variants.js';

export { andList } from './format.js';

export const permissionNames: Record<Permission, string> = {
  Administrator: 'Administrator',
  ManageGuild: 'Manage Community',
  ManageChannels: 'Manage Channels',
  ManageRoles: 'Manage Roles',
  ManageMessages: 'Manage Messages',
  ManageNicknames: 'Manage Nicknames',
  ManageWebhooks: 'Manage Webhooks',
  KickMembers: 'Kick Members',
  BanMembers: 'Ban Members',
  ModerateMembers: 'Timeout Members',
  ViewAuditLog: 'View Audit Log',
  ViewChannel: 'View Channel',
  SendMessages: 'Send Messages',
  ReadMessageHistory: 'Read Message History',
  EmbedLinks: 'Embed Links',
  AttachFiles: 'Attach Files',
  AddReactions: 'Add Reactions',
  MentionEveryone: 'Mention Everyone',
  Connect: 'Connect',
  MoveMembers: 'Move Members',
};

function permissionList(required: readonly Permission[]): string {
  return andList(required.map((p) => `**${permissionNames[p]}**`));
}

export interface Seed {
  seed: string;
  scope: string;
}

export class Voice {
  readonly #variants = new Variants();

  constructor(readonly icons: IconSet) {}

  icon(name: IconName): string {
    return this.icons.inline(name);
  }

  pick(key: string, options: readonly string[], at: Seed): string {
    return this.#variants.pick(key, options, at.seed, at.scope);
  }

  done(detail: string, at: Seed): string {
    const word = this.pick('done', copy.done, at);
    return `${this.icon('ok')}${word} ${detail}`;
  }

  missingPermissions(required: readonly Permission[]): string {
    return `${this.icon('lock')}${copy.missingPermissions(permissionList(required))}`;
  }

  botMissingPermissions(required: readonly Permission[], where: string = copy.here): string {
    return `${this.icon('lock')}${copy.botMissingPermissions(permissionList(required), translate(where))}`;
  }

  moduleOff(name: string): string {
    return copy.moduleOff(name);
  }

  guildOnly(): string {
    return copy.guildOnly;
  }

  cooldown(readyAt: Date, at: Seed): string {
    const opener = this.pick('cooldown', copy.cooldown, at);
    return `${this.icon('clock')}${opener} ${copy.tryAgain(timestamp(readyAt, 'R'))}`;
  }

  failed(errorCode: string): string {
    return `${this.icon('no')}${copy.failed(errorCode)}`;
  }

  usage(problem: string, line: string): string {
    return lines(problem, subtext(code(line)));
  }

  argProblem(arg: ArgSpec, missing: boolean): string {
    const name = arg.name;
    const args = copy.args;
    switch (arg.type) {
      case 'user':
        return missing ? args.missing(name) : args.user(name);
      case 'channel':
        return missing ? args.missing(name) : args.channel;
      case 'role':
        return missing ? args.missing(name) : args.role;
      case 'duration':
        return missing ? args.durationMissing(name) : args.duration;
      case 'integer': {
        if (missing) return args.missing(name);
        if (arg.min !== undefined && arg.max !== undefined) {
          return args.between(name, arg.min, arg.max);
        }
        return args.whole(name);
      }
      default:
        return args.missing(name);
    }
  }

  unknownCommand(typed: string, suggestion: string): string {
    return copy.unknownCommand(typed, suggestion);
  }

  prefixHint(prefix: string, round: number): string {
    if (round === 0) return copy.prefixHint(prefix);
    if (round === 1) return copy.prefixAgain(prefix);
    return `${this.icon('skeptical')}${copy.prefixThird}`;
  }

  empty(key: string, options: readonly string[], at: Seed): string {
    return this.pick(`empty.${key}`, options, at);
  }
}
