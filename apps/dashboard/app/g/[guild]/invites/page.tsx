import { invitesConfig } from '@maxwell/core/modules/invites';
import { InviteStatsStore } from '@maxwell/core/stores/invites';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { InvitesView } from './invites-view';

export const generateMetadata = titled('Invites');

export default async function InvitesPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'invites', invitesConfig);
  const store = new InviteStatsStore(db().sql);
  const [summary, codes, leaders] = await Promise.all([
    store.summary(guild),
    store.codes(guild, 100),
    store.leaderboard(guild, 10),
  ]);
  const known = await people([
    ...leaders.map((leader) => leader.inviterId),
    ...codes.flatMap((code) => (code.inviterId ? [code.inviterId] : [])),
  ]);

  return (
    <ModuleShell {...loaded.shell}>
      <InvitesView
        summary={summary}
        codes={codes.map((code) => ({
          code: code.code,
          owner: code.vanity
            ? 'Vanity link'
            : code.inviterId
              ? personOf(known, code.inviterId).name
              : 'Unknown',
          vanity: code.vanity,
          joins: code.joins,
          joins30: code.joins30,
          fake: code.fake,
          eligible7: code.eligible7,
          stayed7: code.stayed7,
          eligible30: code.eligible30,
          stayed30: code.stayed30,
        }))}
        leaders={leaders.map((leader) => ({
          person: personOf(known, leader.inviterId),
          active: leader.active,
          total: leader.total,
          fake: leader.fake,
        }))}
        now={Date.now()}
      />
    </ModuleShell>
  );
}
