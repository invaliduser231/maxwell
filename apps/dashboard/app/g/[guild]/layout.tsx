import { generalConfig } from '@maxwell/core';
import type { Metadata } from 'next';
import { GuildProvider } from '@/components/guild';
import { LiveProvider } from '@/components/live';
import { Sidebar } from '@/components/sidebar';
import { canSee, requireGuild } from '@/lib/access';
import { communities } from '@/lib/communities';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { guildChannels, guildEmojis, guildRoles } from '@/lib/fluxer';
import { pageGroups } from '@/lib/pages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guild: string }>;
}): Promise<Metadata> {
  const { guild } = await params;
  const access = await requireGuild(guild);
  return { title: { default: access.guild.name, template: `%s | ${access.guild.name}` } };
}

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guild: string }>;
}) {
  const { guild: guildId } = await params;
  const access = await requireGuild(guildId);
  const [channels, roles, emojis, general, all] = await Promise.all([
    guildChannels(guildId).catch(() => []),
    guildRoles(guildId).catch(() => []),
    guildEmojis(guildId).catch(() => []),
    db().modules.get(guildId, 'general', generalConfig),
    communities(access.user),
  ]);
  const others = all
    .filter((entry) => entry.id !== guildId)
    .map(({ id, name, iconUrl, members, invite }) => ({ id, name, iconUrl, members, invite }));
  const groups = pageGroups
    .map((group) => ({ ...group, pages: group.pages.filter((page) => canSee(access, page.key)) }))
    .filter((group) => group.pages.length > 0);
  const voteUrl = env().VOTE_URL ?? null;

  return (
    <GuildProvider
      value={{
        guildId,
        guildName: access.guild.name,
        channels,
        roles,
        emojis,
        voted: access.voted,
        admin: access.admin,
        userId: access.user.id,
        voteUrl,
        timezone: general.timezone,
        timezones: Intl.supportedValuesOf('timeZone'),
      }}
    >
      <LiveProvider guildId={guildId}>
        <div className="mx-app">
          <div className="mx-side-slot">
            <Sidebar
              guildId={guildId}
              guildName={access.guild.name}
              guildIcon={access.guild.iconUrl}
              memberCount={access.guild.memberCount}
              groups={groups}
              voted={access.voted}
              voteUrl={voteUrl}
              user={{ name: access.user.displayName, avatarUrl: access.user.avatarUrl }}
              others={others}
            />
          </div>
          <main className="mx-main">{children}</main>
        </div>
      </LiveProvider>
    </GuildProvider>
  );
}
