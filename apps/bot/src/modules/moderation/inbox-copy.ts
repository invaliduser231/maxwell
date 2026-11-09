import type { InboxKind } from '@maxwell/core/modules/moderation';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/moderation-inbox.json' with { type: 'json' };

export const inboxCopy = catalog('moderation-inbox', en, (m) => ({
  reactionSent: (server: string) => m.reactionSent({ server }),
  titles: {
    report: (n: number) => m.titles.report({ n: String(n) }),
    appeal: (n: number) => m.titles.appeal({ n: String(n) }),
    review: (n: number) => m.titles.review({ n: String(n) }),
    gate: (n: number) => m.titles.gate({ n: String(n) }),
    check: (n: number) => m.titles.check({ n: String(n) }),
  },
  reporters: (n: number) => m.reporters({ n }),
  status: {
    claimed: (who: string) => m.status.claimed({ who }),
    resolved: (who: string) => m.status.resolved({ who }),
    dismissed: (who: string) => m.status.dismissed({ who }),
  },
  outcomes: {
    warn: (n: number) => m.outcomes.warn({ n: String(n) }),
    timeout: (n: number) => m.outcomes.timeout({ n: String(n) }),
    kick: (n: number) => m.outcomes.kick({ n: String(n) }),
    ban: (n: number) => m.outcomes.ban({ n: String(n) }),
    unban: (n: number) => m.outcomes.unban({ n: String(n) }),
  },
  gateHeld: (n: number) => m.gateHeld({ n }),
  riskScore: (score: number, reasons: string) =>
    m.riskScore({ score: String(score), reasons, hasReasons: reasons ? 'yes' : 'no' }),
  appealAccepted: (server: string) => m.appealAccepted({ server }),
  appealDeclined: (server: string) => m.appealDeclined({ server }),
  more: (n: number) => m.more({ n }),
  appealLine: (url: string) => m.appealLine({ url }),
}));

const kinds: Record<InboxKind, string> = {
  report: 'report',
  appeal: 'appeal',
  review: 'review',
  gate: 'gate',
  check: 'verification',
};

export const inboxAudit = {
  claim: (kind: InboxKind, n: number) => `Claimed ${kinds[kind]} #${n}`,
  release: (kind: InboxKind, n: number) => `Released ${kinds[kind]} #${n}`,
  resolve: (kind: InboxKind, n: number) => `Resolved ${kinds[kind]} #${n}`,
  dismiss: (kind: InboxKind, n: number) => `Dismissed ${kinds[kind]} #${n}`,
};
