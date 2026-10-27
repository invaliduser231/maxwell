import { TopBar } from '@/components/top-bar';
import { requireUser } from '@/lib/access';
import { communities } from '@/lib/communities';
import { titled } from '@/lib/i18n/server';
import { CommunityList } from './community-list';

export const generateMetadata = titled('Choose a community');

export default async function Home() {
  const user = await requireUser('/communities');
  const list = await communities(user);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar user={{ name: user.displayName, avatarUrl: user.avatarUrl }} />
      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 1040,
          margin: '0 auto',
          padding: '24px 24px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <CommunityList communities={list} />
      </main>
    </div>
  );
}
