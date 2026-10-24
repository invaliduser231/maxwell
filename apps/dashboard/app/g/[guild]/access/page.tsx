import type { Metadata } from 'next';
import { requirePage } from '@/lib/access';
import { db } from '@/lib/db';
import { userProfile } from '@/lib/fluxer';
import { POLE_COLOR, pageGroups } from '@/lib/pages';
import { people, personOf } from '@/lib/people';
import { AccessView, type ModuleGroupRow } from './access-view';

export const metadata: Metadata = { title: 'Dashboard access' };

export default async function AccessPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const access = await requirePage(guild, 'access');
  const grants = await db().access.list(guild);
  const userIds = [
    ...new Set(grants.filter((grant) => grant.subjectType === 'user').map((g) => g.subjectId)),
  ].slice(0, 80);
  const [owner, users] = await Promise.all([
    userProfile(access.guild.ownerId).catch(() => null),
    people(userIds),
  ]);

  const groups: ModuleGroupRow[] = pageGroups
    .filter((group) => group.title)
    .map((group) => ({
      title: group.title,
      color: POLE_COLOR[group.pages[0]?.pole ?? 'neutral'],
      modules: group.pages
        .filter((page) => page.module === page.key && !page.adminOnly)
        .map((page) => ({
          key: page.key,
          name: page.key === 'moderation' ? 'Moderation and member files' : page.name,
        })),
    }))
    .filter((group) => group.modules.length > 0);

  return (
    <AccessView
      grants={grants.map(({ subjectType, subjectId, module, level }) => ({
        subjectType,
        subjectId,
        module,
        level,
      }))}
      people={userIds.map((id) => {
        const person = personOf(users, id);
        return { id, name: person.name, avatar: person.avatar };
      })}
      ownerName={owner?.displayName ?? 'Owner'}
      groups={groups}
    />
  );
}
