import { starboardConfig } from '@maxwell/core/modules/starboard';
import { type StarboardPost, StarboardStore } from '@maxwell/core/stores/starboard';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { people } from '@/lib/people';
import { type Author, StarboardForm, type Summary, type TopPost } from './starboard-form';

export const generateMetadata = titled('Starboard');

const DAY = 86_400_000;

function webUrl(): string {
  return (process.env.FLUXER_WEB_URL ?? 'https://fluxer.app').replace(/\/+$/, '');
}

export default async function StarboardPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'starboard', starboardConfig);
  const store = new StarboardStore(db().sql);
  const now = Date.now();
  const month = new Date(now - 30 * DAY);
  const before = new Date(now - 60 * DAY);
  const week = new Date(now - 7 * DAY);

  const [current, previous, total, channels, authors, weekTop, monthTop, allTop] =
    await Promise.all([
      store.period(guild, month),
      store.period(guild, before, month),
      store.stats(guild),
      store.topChannels(guild, month, 1),
      store.topAuthors(guild, 1, month),
      store.top(guild, { limit: 8, since: week }),
      store.top(guild, { limit: 8, since: month }),
      store.top(guild, { limit: 8 }),
    ]);

  const profiles = await people([
    ...[...weekTop, ...monthTop, ...allTop].map((post) => post.authorId),
    ...authors.map((author) => author.authorId),
  ]);
  const authorsById: Record<string, Author> = {};
  for (const person of profiles.values()) {
    authorsById[person.id] = {
      name: person.name,
      username: person.handle,
      avatarUrl: person.avatar,
    };
  }

  const base = webUrl();
  const plain = (post: StarboardPost): TopPost => ({
    messageId: post.messageId,
    channelId: post.channelId,
    authorId: post.authorId,
    stars: post.stars,
    content: post.content,
    image: post.postImage,
    createdAt: post.createdAt.toISOString(),
    url: `${base}/channels/${guild}/${post.channelId}/${post.messageId}`,
  });

  const topChannel = channels[0];
  const topAuthor = authors[0];
  const summary: Summary = {
    posts: current.posts,
    delta: current.posts - previous.posts,
    stars: current.stars,
    allStars: total.stars,
    topChannel: topChannel ? { id: topChannel.channelId, posts: topChannel.posts } : null,
    topAuthor: topAuthor ? { id: topAuthor.authorId, posts: topAuthor.posts } : null,
  };

  return (
    <ModuleShell {...loaded.shell}>
      <StarboardForm
        summary={summary}
        top={{ week: weekTop.map(plain), month: monthTop.map(plain), all: allTop.map(plain) }}
        people={authorsById}
        viewer={{
          name: loaded.access.user.displayName,
          username: loaded.access.user.username,
          avatarUrl: loaded.access.user.avatarUrl,
        }}
      />
    </ModuleShell>
  );
}
