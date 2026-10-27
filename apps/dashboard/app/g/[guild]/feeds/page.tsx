import { feedsConfig } from '@maxwell/core/modules/feeds';
import { FeedStore } from '@maxwell/core/stores/feeds';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { FeedsForm } from './feeds-form';

export const generateMetadata = titled('Feeds');

export default async function FeedsPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'feeds', feedsConfig);
  const store = new FeedStore(db().sql);
  const [states, posts] = await Promise.all([
    store.states(guild),
    store.recentPosts(guild, undefined, 12),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <FeedsForm
        now={Date.now()}
        savedIds={loaded.config.feeds.map((feed) => feed.id)}
        states={Object.fromEntries(
          states.map((state) => [
            state.feedId,
            {
              lastPolledAt: state.lastPolledAt?.toISOString() ?? null,
              lastPostedAt: state.lastPostedAt?.toISOString() ?? null,
              lastError: state.lastError,
              failures: state.failures,
              paused: state.pausedAt !== null,
              posted: state.posted,
            },
          ]),
        )}
        posts={posts.map((post) => ({
          id: post.id,
          feedId: post.feedId,
          title: post.title,
          url: post.url,
          channelId: post.channelId,
          postedAt: post.postedAt.toISOString(),
        }))}
      />
    </ModuleShell>
  );
}
