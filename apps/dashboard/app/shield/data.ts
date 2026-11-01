import 'server-only';
import type { ShieldSource } from '@maxwell/core/modules/security';
import {
  type DisputeStatus,
  disputeEligibility,
  type ShieldDispute,
  ShieldDisputeStore,
} from '@maxwell/core/stores/shield-disputes';
import { db } from '@/lib/db';

export interface ListingView {
  source: ShieldSource;
  createdAt: string;
  expiresAt: string;
}

export interface DisputeView {
  status: DisputeStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type ShieldState =
  | { kind: 'not-listed'; last: DisputeView | null }
  | { kind: 'open'; listing: ListingView[]; dispute: DisputeView }
  | { kind: 'wait'; listing: ListingView[]; last: DisputeView; until: string }
  | { kind: 'ready'; listing: ListingView[]; last: DisputeView | null };

function view(dispute: ShieldDispute): DisputeView;
function view(dispute: ShieldDispute | null): DisputeView | null;
function view(dispute: ShieldDispute | null): DisputeView | null {
  if (!dispute) return null;
  return {
    status: dispute.status,
    note: dispute.note,
    createdAt: dispute.createdAt.toISOString(),
    decidedAt: dispute.decidedAt?.toISOString() ?? null,
  };
}

export async function shieldState(userId: string, now = Date.now()): Promise<ShieldState> {
  const store = new ShieldDisputeStore(db().sql);
  const [entries, last] = await Promise.all([store.listing(userId, now), store.latest(userId)]);
  const listing = entries.map((entry) => ({
    source: entry.source,
    createdAt: entry.createdAt.toISOString(),
    expiresAt: entry.expiresAt.toISOString(),
  }));
  const state = disputeEligibility(entries, last, now);
  switch (state.kind) {
    case 'open':
      return { kind: 'open', listing, dispute: view(state.dispute) };
    case 'not-listed':
      return { kind: 'not-listed', last: view(state.last) };
    case 'wait':
      return { kind: 'wait', listing, last: view(state.last), until: state.until.toISOString() };
    case 'ready':
      return { kind: 'ready', listing, last: view(state.last) };
  }
}
