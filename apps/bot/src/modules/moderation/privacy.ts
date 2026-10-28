import type { InboxStore } from '@maxwell/core/stores/inbox';
import type { CaseRow, ModerationStore, NameRow } from '@maxwell/core/stores/moderation';

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function exportCase(row: CaseRow): Record<string, unknown> {
  return {
    number: row.number,
    action: row.action,
    reason: row.reason,
    durationSeconds: row.durationSeconds,
    excerpt: row.excerpt,
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
    endedAt: iso(row.endedAt),
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
  };
}

export function exportName(row: NameRow): Record<string, unknown> {
  return {
    kind: row.kind,
    value: row.value,
    previous: row.previous,
    changedAt: iso(row.changedAt),
  };
}

export async function exportMember(
  store: ModerationStore,
  guildId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const data = await store.memberExport(guildId, userId);
  if (data.cases.length === 0 && data.names.length === 0 && data.notes === 0 && data.issued === 0) {
    return null;
  }
  return {
    cases: data.cases.map(exportCase),
    nameHistory: data.names.map(exportName),
    notesAboutYou: data.notes,
    casesYouIssued: data.issued,
  };
}

export async function exportInbox(
  inbox: InboxStore,
  guildId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const data = await inbox.memberData(guildId, userId);
  if (data.about.length === 0 && data.reported.length === 0) return null;
  return {
    appeals: data.about.map((item) => ({
      number: item.number,
      text: item.body,
      status: item.status,
      createdAt: iso(item.createdAt),
      resolvedAt: iso(item.resolvedAt),
    })),
    reportsYouMade: data.reported.map((item) => ({
      number: item.number,
      text: item.body,
      excerpt: item.excerpt,
      status: item.status,
      createdAt: iso(item.createdAt),
    })),
  };
}
