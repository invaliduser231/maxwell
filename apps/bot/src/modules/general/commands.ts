import { usageLine } from '../../commands/dispatcher.js';
import type { Command, CommandContext, Module } from '../../commands/types.js';
import { translate } from '../../i18n/catalog.js';
import { code, count, lines, subtext, timestamp } from '../../ui/format.js';
import { moduleText } from '../../ui/modules.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { permissionNames } from '../../ui/voice.js';
import { copy } from './copy.js';

const ping: Command = {
  name: 'ping',
  aliases: ['latency'],
  description: copy.commands.ping,
  cooldown: 3_000,
  async run(ctx) {
    const started = performance.now();
    const id = await ctx.reply(copy.ping.first);
    const api = Math.round(performance.now() - started);
    const gateway = ctx.platform.gatewayPing();
    const heartbeat = gateway === null ? copy.ping.measuring : `${count(gateway)} ms`;
    await ctx.platform.edit(
      ctx.message.channelId,
      id,
      copy.ping.result(heartbeat, `${count(api)} ms`),
    );
  },
};

const MODULES_PER_PAGE = 8;

function visible(module: Module): Command[] {
  return module.commands.filter((c) => !c.ownerOnly && !c.hidden);
}

function findModule(ctx: CommandContext, query: string): Module | null {
  const key = query.trim().toLowerCase();
  return (
    ctx.services.registry.modules.find(
      (module) =>
        (module.name.toLowerCase() === key ||
          moduleText(module.key, module).name.toLowerCase() === key) &&
        visible(module).length > 0,
    ) ?? null
  );
}

async function helpForModule(ctx: CommandContext, module: Module): Promise<void> {
  const entries = visible(module).flatMap((command) => [
    { path: [command.name], command },
    ...(command.subcommands ?? [])
      .filter((sub) => !sub.hidden)
      .map((sub) => ({ path: [command.name, sub.name], command: sub })),
  ]);
  const text = moduleText(module.key, module);

  await ctx.reply({
    embeds: [
      {
        color: palette.north,
        title: text.name,
        description: lines(
          text.description,
          ...entries.flatMap(({ path, command }) => [
            '',
            code(usageLine(ctx.prefix, path, command)),
            translate(command.description),
          ]),
        ),
      },
    ],
  });
}

async function helpFor(ctx: CommandContext, query: string): Promise<void> {
  const module = findModule(ctx, query);
  if (module) {
    await helpForModule(ctx, module);
    return;
  }

  const path = query
    .replace(ctx.prefix, '')
    .trim()
    .split(/\s+/)
    .map((part) => part.toLowerCase());
  const command = ctx.services.registry.find(path);
  if (!command || command.ownerOnly || command.hidden) {
    await ctx.reply({
      content: copy.help.nothing(query, ctx.prefix),
      deleteAfter: 15_000,
    });
    return;
  }

  const canonical = ctx.services.registry.canonicalPath(path);
  const subs = command.subcommands?.filter((sub) => !sub.hidden) ?? [];
  const examples = command.examples?.map((example) => code(`${ctx.prefix}${example}`));

  await ctx.reply({
    embeds: [
      {
        color: palette.north,
        title: `${ctx.prefix}${canonical.join(' ')}`,
        description: lines(
          translate(command.description),
          '',
          command.run ? code(usageLine(ctx.prefix, canonical, command)) : null,
          subs.length > 0 && '',
          ...subs.map(
            (sub) => `${code(`${canonical.join(' ')} ${sub.name}`)}  ${translate(sub.description)}`,
          ),
          examples?.length ? '' : null,
          examples?.length ? `**${copy.help.examples}**` : null,
          ...(examples ?? []),
          command.permissions?.length || command.aliases?.length ? '' : null,
          command.permissions?.length
            ? `**${copy.help.needs}** ${command.permissions.map((p) => permissionNames[p]).join(', ')}`
            : null,
          command.aliases?.length
            ? `**${copy.help.also}** ${command.aliases.map((a) => code(a)).join(' ')}`
            : null,
        ),
      },
    ],
  });
}

const help: Command = {
  name: 'help',
  aliases: ['commands', 'h'],
  description: copy.commands.help,
  args: [{ name: 'topic', type: 'text', optional: true }],
  examples: ['help', 'help invites', 'help invites top'],
  async run(ctx) {
    const query = ctx.args.string('topic');
    if (query && !/^\d+$/.test(query)) {
      await helpFor(ctx, query);
      return;
    }

    const modules = [];
    for (const module of ctx.services.registry.modules) {
      if (visible(module).length === 0) continue;
      if (ctx.guildId && !(await ctx.services.settings.enabled(ctx.guildId, module.key))) continue;
      modules.push(module);
    }
    const pages = chunk(modules, MODULES_PER_PAGE).map((group) => ({
      color: palette.north,
      title: copy.help.title,
      description: lines(
        copy.help.prefix(ctx.prefix),
        '',
        ...group.map(
          (module) =>
            `**${moduleText(module.key, module).name}**  ${visible(module)
              .map((c) => code(c.name))
              .join(' ')}`,
        ),
        '',
        subtext(copy.help.details(ctx.prefix)),
      ),
    }));

    if (pages.length > 1) {
      await ctx.services.pages.send(ctx, pages, Number(query ?? 1) - 1);
      return;
    }

    const art = ctx.services.mascot.get('neutral');
    await ctx.reply({
      files: art ? [art.file] : undefined,
      embeds: pages.map((page) => ({ ...page, thumbnailUrl: art?.url })),
    });
  },
};

const prefix: Command = {
  name: 'prefix',
  description: copy.commands.prefix,
  guildOnly: true,
  args: [{ name: 'new prefix', type: 'word', optional: true }],
  examples: ['prefix ?', 'prefix reset'],
  async run(ctx) {
    const next = ctx.args.string('new prefix');
    const { voice, guilds, config } = ctx.services;
    if (!next) {
      await ctx.reply(
        lines(copy.prefix.current(ctx.prefix), subtext(copy.prefix.change(ctx.prefix))),
      );
      return;
    }

    const allowed = await ctx.platform.hasPermissions(
      ctx.guildId,
      ctx.message.author.id,
      ctx.message.channelId,
      ['ManageGuild'],
    );
    if (!allowed) {
      await ctx.reply(voice.missingPermissions(['ManageGuild']));
      return;
    }

    if (next.length > 8) {
      await ctx.reply({ content: copy.prefix.tooLong, deleteAfter: 15_000 });
      return;
    }

    if (next.toLowerCase() === 'reset') {
      await guilds.setPrefix(ctx.guildId, null);
      await ctx.reply(voice.done(copy.prefix.reset(config.DEFAULT_PREFIX), ctx.seed));
      return;
    }

    await guilds.setPrefix(ctx.guildId, next);
    await ctx.reply(voice.done(copy.prefix.set(next), ctx.seed));
  },
};

const about: Command = {
  name: 'about',
  aliases: ['info', 'bot'],
  description: copy.commands.about,
  async run(ctx) {
    const { startedAt } = ctx.services;
    const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const art = ctx.services.mascot.get('happy');
    await ctx.reply({
      files: art ? [art.file] : undefined,
      embeds: [
        {
          color: palette.north,
          thumbnailUrl: art?.url,
          title: 'Maxwell',
          description: lines(
            copy.about.tagline,
            '',
            `**${copy.about.communities}** ${count(ctx.platform.guildCount())}`,
            `**${copy.about.online}** ${timestamp(startedAt, 'R')}`,
            `**${copy.about.memory}** ${count(memory)} MB`,
          ),
        },
      ],
    });
  },
};

const entropy: Command = {
  name: 'entropy',
  description: copy.commands.entropy,
  hidden: true,
  async run(ctx) {
    await ctx.reply(copy.entropy);
  },
};

const vote: Command = {
  name: 'vote',
  description: copy.commands.vote,
  cooldown: 10_000,
  async run(ctx) {
    const { votes, config, voice } = ctx.services;
    if (await votes.check(ctx.message.author.id)) {
      await ctx.reply(voice.done(copy.vote.done, ctx.seed));
      return;
    }
    const link = config.VOTE_URL ? ` ${config.VOTE_URL}` : '';
    await ctx.reply(lines(copy.vote.ask(link), subtext(copy.vote.again(ctx.prefix))));
  },
};

export const generalCommands: Command[] = [help, ping, prefix, about, vote, entropy];
