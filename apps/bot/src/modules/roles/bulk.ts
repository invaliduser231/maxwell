import type { Job } from '@maxwell/core';
import type { rolesConfig } from '@maxwell/core/modules/roles';
import { roleId as parseRoleId } from '../../commands/mentions.js';
import type { Command, GuildCommand, GuildContext } from '../../commands/types.js';
import { permissionNames } from '../../platform/permissions.js';
import type { Permission, RoleRef } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { andList, lines } from '../../ui/format.js';
import type { Confirmations } from '../moderation/confirm.js';
import { audit, type BulkMode, copy, reasons } from './copy.js';

type Ctx = ModuleContext<typeof rolesConfig>;

export const BULK_PAGE = 100;
export const BULK_DELAY = 250;
const PROGRESS_EVERY = 4_000;
const fallback = { ok: '✅' };

const DANGEROUS: Permission[] = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
  'ManageMessages',
  'MentionEveryone',
];

export interface BulkPayload {
  roleId: string;
  mode: BulkMode;
  by: string;
  channelId: string;
  messageId: string;
  after: string | null;
  done: number;
  changed: number;
  failed: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function top(roles: readonly RoleRef[], ids: readonly string[]): number {
  const byId = new Map(roles.map((role) => [role.id, role.position]));
  return Math.max(-1, ...ids.map((id) => byId.get(id) ?? -1));
}

export function findRole(roles: readonly RoleRef[], input: string): RoleRef | null {
  const id = parseRoleId(input.trim());
  if (id) return roles.find((role) => role.id === id) ?? null;
  const raw = input.trim().toLowerCase();
  const name = raw.replace(/^@/, '');
  return (
    roles.find((role) => role.name.toLowerCase() === raw) ??
    roles.find((role) => role.name.toLowerCase() === name) ??
    null
  );
}

function parsePayload(job: Job): BulkPayload | null {
  const p = job.payload;
  if (typeof p.roleId !== 'string' || (p.mode !== 'add' && p.mode !== 'remove')) return null;
  if (typeof p.channelId !== 'string' || typeof p.messageId !== 'string') return null;
  return {
    roleId: p.roleId,
    mode: p.mode,
    by: typeof p.by === 'string' ? p.by : '',
    channelId: p.channelId,
    messageId: p.messageId,
    after: typeof p.after === 'string' ? p.after : null,
    done: Number(p.done) || 0,
    changed: Number(p.changed) || 0,
    failed: Number(p.failed) || 0,
  };
}

export class BulkRoles {
  readonly #running = new Map<string, string>();
  readonly #stopped = new Set<string>();

  constructor(
    private readonly ctx: Ctx,
    private readonly confirmations: Confirmations,
  ) {}

  running(guildId: string): string | null {
    return this.#running.get(guildId) ?? null;
  }

  async check(cmd: GuildContext, input: string): Promise<RoleRef | string> {
    const { platform } = cmd;
    const roles = await platform.roles(cmd.guildId).catch(() => []);
    const role = findRole(roles, input);
    if (!role) return copy.bulk.unknownRole;
    if (role.id === cmd.guildId) return copy.bulk.everyone;
    if (role.managed) return copy.bulk.managed(role.id);
    const risky = permissionNames(role.permissions).filter((name) => DANGEROUS.includes(name));
    if (risky.length > 0) return copy.bulk.dangerous(role.id, andList(risky));
    const self = platform.selfId ? await platform.member(cmd.guildId, platform.selfId) : null;
    if (role.position >= top(roles, self?.roles ?? [])) return copy.bulk.tooHighBot(role.id);
    const owner = await platform.guildOwner(cmd.guildId).catch(() => null);
    if (owner !== cmd.message.author.id) {
      const author = await platform.member(cmd.guildId, cmd.message.author.id);
      if (role.position >= top(roles, author?.roles ?? [])) return copy.bulk.tooHighYou(role.id);
    }
    return role;
  }

  async start(cmd: GuildContext, mode: BulkMode, input: string): Promise<void> {
    const { platform } = cmd;
    const { voice } = cmd.services;
    const busy = this.running(cmd.guildId);
    if (busy) {
      await cmd.reply({ content: copy.bulk.running(busy, cmd.prefix), mentionRoles: [] });
      return;
    }
    const checked = await this.check(cmd, input);
    if (typeof checked === 'string') {
      await cmd.reply({ content: checked, mentionRoles: [] });
      return;
    }
    const guild = await platform.guild(cmd.guildId).catch(() => null);
    const members = guild?.memberCount ?? 0;
    const minutes = Math.max(1, Math.ceil((members * BULK_DELAY) / 60_000));
    const emoji = voice.icons.reaction('ok') ?? fallback.ok;
    const channelId = cmd.message.channelId;
    const prompt = await cmd.reply({
      content: lines(
        copy.bulk.confirm(mode, checked.id, members, minutes),
        copy.bulk.confirmHint(voice.icon('ok') || emoji),
      ),
      mentionRoles: [],
    });
    await platform.react(channelId, prompt, emoji).catch(() => {});
    const ok = await this.confirmations.wait(prompt, cmd.message.author.id, emoji);
    await platform.unreact(channelId, prompt, emoji).catch(() => {});
    if (!ok) {
      await platform.edit(channelId, prompt, copy.bulk.expired).catch(() => {});
      return;
    }
    if (this.running(cmd.guildId)) return;
    this.#running.set(cmd.guildId, checked.id);
    this.#stopped.delete(cmd.guildId);
    await this.ctx.record(
      cmd.guildId,
      { id: cmd.message.author.id },
      'bulk.start',
      audit.bulkStarted(mode, checked.name),
      { after: { roleId: checked.id, mode } },
    );
    await platform
      .edit(
        channelId,
        prompt,
        lines(copy.bulk.progress(mode, checked.id, 0, 0), copy.bulk.stopHint(cmd.prefix)),
      )
      .catch(() => {});
    const payload: BulkPayload = {
      roleId: checked.id,
      mode,
      by: cmd.message.author.id,
      channelId,
      messageId: prompt,
      after: null,
      done: 0,
      changed: 0,
      failed: 0,
    };
    await this.ctx.schedule('bulk.run', {
      guildId: cmd.guildId,
      payload: { ...payload },
      dedupeKey: `roles.bulk:${cmd.guildId}`,
    });
  }

  async stop(cmd: GuildContext): Promise<void> {
    if (!this.running(cmd.guildId)) {
      await cmd.reply(copy.bulk.nothingRunning);
      return;
    }
    this.#stopped.add(cmd.guildId);
  }

  async run(job: Job): Promise<void> {
    const guildId = job.guildId;
    const state = parsePayload(job);
    if (!guildId || !state) return;
    const { platform, log } = this.ctx.services;
    this.#running.set(guildId, state.roleId);

    const finish = async (content: string) => {
      this.#running.delete(guildId);
      this.#stopped.delete(guildId);
      await platform.edit(state.channelId, state.messageId, content).catch(() => {});
    };

    const page = await platform.memberRoles(guildId, state.after, BULK_PAGE).catch(() => null);
    if (page === null) {
      await finish(copy.bulk.noMembers);
      return;
    }
    const reason = state.mode === 'add' ? reasons.bulkAdd : reasons.bulkRemove;
    let lastEdit = Date.now();
    for (const member of page) {
      if (this.#stopped.has(guildId)) {
        await finish(copy.bulk.stopped(state.changed));
        return;
      }
      state.after = member.userId;
      state.done += 1;
      if (member.userId === platform.selfId) continue;
      const has = member.roles.includes(state.roleId);
      if (state.mode === 'add' ? has : !has) continue;
      try {
        if (state.mode === 'add') {
          await platform.addRole(guildId, member.userId, state.roleId, reason);
        } else {
          await platform.removeRole(guildId, member.userId, state.roleId, reason);
        }
        state.changed += 1;
      } catch (error) {
        state.failed += 1;
        log.debug({ guild: guildId, user: member.userId, err: error }, 'bulk role change failed');
      }
      await sleep(BULK_DELAY);
      if (Date.now() - lastEdit >= PROGRESS_EVERY) {
        lastEdit = Date.now();
        await platform
          .edit(
            state.channelId,
            state.messageId,
            copy.bulk.progress(state.mode, state.roleId, state.done, state.changed),
          )
          .catch(() => {});
      }
    }

    if (page.length === BULK_PAGE) {
      await platform
        .edit(
          state.channelId,
          state.messageId,
          copy.bulk.progress(state.mode, state.roleId, state.done, state.changed),
        )
        .catch(() => {});
      await this.ctx.schedule('bulk.run', { guildId, payload: { ...state } });
      return;
    }

    const roles = await platform.roles(guildId).catch(() => []);
    const name = roles.find((role) => role.id === state.roleId)?.name ?? state.roleId;
    await this.ctx.record(
      guildId,
      { id: state.by || null },
      'bulk.finish',
      audit.bulkFinished(state.mode, name, state.changed),
      { after: { roleId: state.roleId, mode: state.mode, changed: state.changed } },
    );
    await finish(
      lines(
        copy.bulk.done(state.mode, state.roleId, state.changed),
        state.failed > 0 && copy.bulk.failed(state.failed),
      ),
    );
  }
}

export function roleCommand(bulk: BulkRoles): Command {
  const all: GuildCommand = {
    name: 'all',
    description: copy.bulk.commands.all,
    guildOnly: true,
    args: [{ name: 'role', type: 'text' }],
    examples: ['role all @Verified'],
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    async run(cmd) {
      await bulk.start(cmd, 'add', cmd.args.string('role') ?? '');
    },
  };
  const clear: GuildCommand = {
    name: 'clear',
    description: copy.bulk.commands.clear,
    guildOnly: true,
    args: [{ name: 'role', type: 'text' }],
    examples: ['role clear @Event'],
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    async run(cmd) {
      await bulk.start(cmd, 'remove', cmd.args.string('role') ?? '');
    },
  };
  const stop: GuildCommand = {
    name: 'stop',
    description: copy.bulk.commands.stop,
    guildOnly: true,
    permissions: ['ManageRoles'],
    async run(cmd) {
      await bulk.stop(cmd);
    },
  };
  return {
    name: 'role',
    aliases: ['roles'],
    description: copy.bulk.commands.role,
    guildOnly: true,
    subcommands: [all, clear, stop],
    permissions: ['ManageRoles'],
  };
}
