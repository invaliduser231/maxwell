import type { GuildRef } from '../../platform/types.js';
import type { Services } from '../../services.js';
import { lines, subtext } from '../../ui/format.js';
import { permissionNames } from '../../ui/voice.js';
import { copy } from './copy.js';

const wanted = ['ManageGuild', 'EmbedLinks', 'AddReactions'] as const;

export async function greet(services: Services, guild: GuildRef): Promise<void> {
  const { platform, config, log } = services;
  const channelId = await platform.welcomeChannel(guild.id);
  if (!channelId) {
    log.info({ guild: guild.id }, 'no channel to greet in');
    return;
  }

  const missing = await platform.missingBotPermissions(guild.id, null, wanted);
  const warnings = wanted
    .filter((permission) => missing.includes(permission))
    .map((permission) =>
      copy.greet.missing(permissionNames[permission], copy.greet.features[permission]),
    );

  const prefix = config.DEFAULT_PREFIX;
  await platform.send(
    channelId,
    lines(
      copy.greet.hello,
      copy.greet.prefix(prefix),
      subtext(copy.greet.mention),
      warnings.length > 0 && '',
      warnings.length > 0 && '> [!WARNING]',
      ...warnings,
    ),
  );
}
