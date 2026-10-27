import { voiceConfig } from '@maxwell/core/modules/voice';
import { VoiceStore } from '@maxwell/core/stores/voice';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import type { Translator } from '@/lib/i18n';
import { getT, titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { span } from '@/lib/time';
import { type OpenRoom, VoiceForm } from './voice-form';

export const generateMetadata = titled('Voice rooms');

function openFor(t: Translator, since: Date, now: number): string {
  const ms = Math.max(0, now - since.getTime());
  return ms < 60_000 ? t('Just now') : span(t, ms);
}

export default async function VoicePage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'voice', voiceConfig);
  const [rooms, prefix, t] = await Promise.all([
    new VoiceStore(db().sql).list(guild),
    db().guilds.prefix(guild),
    getT(),
  ]);
  const names = await people(rooms.map((room) => room.ownerId));
  const now = Date.now();
  const open: OpenRoom[] = rooms.map((room) => ({
    channelId: room.channelId,
    lobbyId: room.lobbyId,
    owner: personOf(names, room.ownerId).name,
    members: room.members.length,
    locked: room.locked,
    openFor: openFor(t, room.createdAt, now),
  }));

  return (
    <ModuleShell {...loaded.shell}>
      <VoiceForm
        rooms={open}
        prefix={prefix}
        viewer={{ name: loaded.access.user.displayName, username: loaded.access.user.username }}
      />
    </ModuleShell>
  );
}
