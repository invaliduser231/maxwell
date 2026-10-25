import { voiceConfig } from '@maxwell/core/modules/voice';
import { VoiceStore } from '@maxwell/core/stores/voice';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { type OpenRoom, VoiceForm } from './voice-form';

export const metadata: Metadata = { title: 'Voice rooms' };

function openFor(since: Date, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since.getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

export default async function VoicePage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'voice', voiceConfig);
  const [rooms, prefix] = await Promise.all([
    new VoiceStore(db().sql).list(guild),
    db().guilds.prefix(guild),
  ]);
  const names = await people(rooms.map((room) => room.ownerId));
  const now = Date.now();
  const open: OpenRoom[] = rooms.map((room) => ({
    channelId: room.channelId,
    lobbyId: room.lobbyId,
    owner: personOf(names, room.ownerId).name,
    members: room.members.length,
    locked: room.locked,
    openFor: openFor(room.createdAt, now),
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
