import type { Command } from '../../commands/types.js';
import { lines, subtext } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { formsCopy as copy } from './copy.js';
import type { FormsContext } from './review.js';
import { type FormRunner, findForm, openForms, type StartResult } from './sessions.js';

function startReply(result: StartResult, formName: string): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case 'closed':
      return copy.closed(formName);
    case 'role':
      return copy.needsRole(result.roleIds);
    case 'active':
      return copy.alreadyFilling(result.formName);
    case 'pending':
      return copy.pending(formName);
    case 'once':
      return copy.once(formName);
    case 'cooldown':
      return copy.cooldown(result.until);
    case 'unreachable':
      return copy.unreachable;
  }
}

export function formCommands(ctx: FormsContext, runner: FormRunner): Command {
  const start: Command = {
    name: 'start',
    description: copy.commands.start,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'form', type: 'text', optional: true }],
    examples: ['form start staff', 'form start Staff application'],
    async run(command) {
      const config = await ctx.config(command.guildId);
      const available = openForms(config);
      const query = command.args.string('form')?.trim() ?? '';
      const only = available.length === 1 ? available[0] : undefined;
      const form = query ? findForm(config, query) : (only ?? null);

      if (!form) {
        const text = query
          ? copy.unknownForm(available.map((candidate) => candidate.id))
          : available.length
            ? copy.pickForm(command.prefix)
            : copy.listEmpty;
        await command.reply({ content: text, deleteAfter: 30_000 });
        return;
      }

      const result = await runner.start(
        command.guildId,
        command.message.author,
        command.message.memberRoles,
        form,
      );
      if (result.ok) {
        await command.reply(
          result.mode === 'dm' ? copy.checkDms : copy.continueIn(result.channelId),
        );
        return;
      }
      await command.reply(startReply(result, form.name) ?? copy.closed(form.name));
    },
  };

  const list: Command = {
    name: 'list',
    description: copy.commands.list,
    guildOnly: true,
    cooldown: 5_000,
    examples: ['form list'],
    async run(command) {
      const config = await ctx.config(command.guildId);
      const available = openForms(config);
      if (!available.length) {
        await command.reply(copy.listEmpty);
        return;
      }
      await command.reply({
        embeds: [
          {
            color: palette.north,
            title: copy.listTitle,
            description: lines(
              ...available.flatMap((form, i) => [
                i > 0 ? '' : null,
                copy.listLine(form.name, form.id, form.questions.length),
                form.description ? form.description.slice(0, 200) : null,
              ]),
              '',
              subtext(copy.listHint(command.prefix)),
            ),
          },
        ],
      });
    },
  };

  return {
    name: 'form',
    description: copy.commands.form,
    guildOnly: true,
    subcommands: [start, list],
  };
}
