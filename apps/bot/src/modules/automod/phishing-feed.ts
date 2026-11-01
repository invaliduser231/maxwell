import type { PhishingStore } from '@maxwell/core/stores/phishing';
import type { Logger } from '../../log.js';
import {
  acceptList,
  downloadList,
  PHISHING_EVERY,
  PHISHING_SOURCE,
  type PhishingIndex,
} from './phishing.js';

const RETRY_AFTER = 60 * 60_000;

export function syncAt(at: number): { runAt: Date; dedupeKey: string } {
  return {
    runAt: new Date(at),
    dedupeKey: `automod.phishing:${Math.floor(at / PHISHING_EVERY)}`,
  };
}

export class PhishingFeed {
  constructor(
    private readonly store: PhishingStore,
    private readonly index: PhishingIndex,
    private readonly log: Logger,
    private readonly download: () => Promise<string[]> = () => downloadList(),
  ) {}

  async load(now = Date.now()): Promise<number> {
    const [domains, last] = await Promise.all([
      this.store.domains(),
      this.store.lastSync(PHISHING_SOURCE),
    ]);
    this.index.replace(domains);
    if (!last) return now;
    return Math.max(now, new Date(last.fetchedAt).getTime() + PHISHING_EVERY);
  }

  async sync(now = Date.now()): Promise<number> {
    try {
      const domains = await this.download();
      const last = await this.store.lastSync(PHISHING_SOURCE);
      if (!acceptList(domains.length, last?.domains ?? null)) {
        this.log.warn(
          { domains: domains.length, previous: last?.domains ?? null },
          'phishing list rejected',
        );
        return now + RETRY_AFTER;
      }
      await this.store.replace(PHISHING_SOURCE, domains);
      this.index.replace(domains);
      this.log.info({ domains: domains.length }, 'phishing list updated');
      return now + PHISHING_EVERY;
    } catch (error) {
      this.log.warn({ err: error }, 'phishing list update failed');
      return now + RETRY_AFTER;
    }
  }
}
