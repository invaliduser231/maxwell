import { TicketStore, TRANSCRIPT_LIMIT } from '@maxwell/core/stores/tickets';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GuildProvider } from '@/components/guild';
import { Markdown } from '@/components/message-preview';
import { TopBar } from '@/components/top-bar';
import { Avatar } from '@/components/ui';
import { requireUser } from '@/lib/access';
import { db } from '@/lib/db';
import { guildChannels, guildRoles } from '@/lib/fluxer';
import { getT, titled } from '@/lib/i18n/server';
import { namesOf } from '@/lib/people';
import { dayTime } from '@/lib/time';
import { panelName, supportPanels } from '../data';

export const generateMetadata = titled('Transcript');

export default async function SupportTranscript({
  params,
}: {
  params: Promise<{ guild: string; ticket: string }>;
}) {
  const { guild, ticket: ticketId } = await params;
  const user = await requireUser(`/support/${guild}/${ticketId}`);
  if (!/^\d{1,21}$/.test(guild) || !/^\d{1,19}$/.test(ticketId)) notFound();
  const store = new TicketStore(db().sql);
  const [ticket, panels] = await Promise.all([
    store.getInGuild(guild, ticketId),
    supportPanels(guild),
  ]);
  if (!ticket || !panels || ticket.openerId !== user.id || ticket.panelId === 'modmail') {
    notFound();
  }
  const rows = (await store.messages(ticket.id, { limit: TRANSCRIPT_LIMIT })).filter(
    (row) => row.deletedAt === null,
  );
  const [names, t, channels, roles] = await Promise.all([
    namesOf(
      rows.map((row) => row.authorId),
      120,
    ),
    getT(),
    guildChannels(guild).catch(() => []),
    guildRoles(guild).catch(() => []),
  ]);
  const context = {
    guildId: guild,
    guildName: '',
    channels,
    roles,
    emojis: [],
    voted: false,
    admin: false,
    userId: user.id,
    voteUrl: null,
    timezone: 'UTC',
    timezones: [],
  };
  const now = Date.now();

  return (
    <GuildProvider value={context}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TopBar user={{ name: user.displayName, avatarUrl: user.avatarUrl }} />
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: '32px 16px 48px',
          }}
        >
          <section className="mx-panel" style={{ width: '100%', maxWidth: 720 }}>
            <div className="mx-panel-head">
              <h1 className="mx-h1" style={{ fontSize: 20 }}>
                {ticket.subject ?? t('Ticket {number}', { number: String(ticket.number) })}
              </h1>
              <span className="mx-chip">{ticket.status === 'open' ? t('Open') : t('Closed')}</span>
            </div>
            <div className="mx-panel-body" style={{ paddingTop: 0 }}>
              <span className="mx-sub">
                {[panelName(panels, ticket), dayTime(t, ticket.createdAt, now, 'UTC')].join(', ')}
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="mx-panel-body">
                <span className="mx-sub">{t('No messages yet.')}</span>
              </div>
            ) : (
              rows.map((row) => {
                const name = names[row.authorId]?.name ?? row.authorName;
                return (
                  <div key={row.messageId} className="mx-row" style={{ alignItems: 'flex-start' }}>
                    <Avatar src={row.authorAvatar} name={name} size={30} />
                    <div className="mx-row-main" style={{ gap: 4 }}>
                      <span className="mx-row-title">
                        {name}{' '}
                        <span className="mx-sub" style={{ fontWeight: 400 }}>
                          {dayTime(t, row.createdAt, now, 'UTC')}
                        </span>
                      </span>
                      {row.content ? <Markdown text={row.content} names={names} /> : null}
                      {row.attachments.map((file) => (
                        <span key={file.url} className="mx-sub">
                          {file.filename}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
          <Link className="mx-btn mx-btn-ghost" href={`/support/${guild}`}>
            {t('All your tickets')}
          </Link>
        </main>
      </div>
    </GuildProvider>
  );
}
