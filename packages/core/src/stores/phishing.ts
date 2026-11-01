import type { Sql } from '../db/sql.js';

export interface PhishingSync {
  source: string;
  fetchedAt: Date;
  domains: number;
}

export class PhishingStore {
  constructor(private readonly sql: Sql) {}

  async domains(): Promise<string[]> {
    const rows = await this.sql<{ domain: string }[]>`select domain from automod_phishing_domains`;
    return rows.map((row) => row.domain);
  }

  async lastSync(source: string): Promise<PhishingSync | null> {
    const [row] = await this.sql<PhishingSync[]>`
      select source, fetched_at as "fetchedAt", domains
      from automod_phishing_sync
      where source = ${source}
    `;
    return row ?? null;
  }

  async latest(): Promise<PhishingSync | null> {
    const [row] = await this.sql<PhishingSync[]>`
      select source, fetched_at as "fetchedAt", domains
      from automod_phishing_sync
      order by fetched_at desc
      limit 1
    `;
    return row ?? null;
  }

  async replace(source: string, domains: readonly string[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from automod_phishing_domains`;
      if (domains.length > 0) {
        await tx`
          insert into automod_phishing_domains (domain)
          select unnest(${domains as string[]}::text[])
          on conflict do nothing
        `;
      }
      await tx`
        insert into automod_phishing_sync (source, fetched_at, domains)
        values (${source}, now(), ${domains.length})
        on conflict (source) do update
          set fetched_at = excluded.fetched_at, domains = excluded.domains
      `;
    });
  }
}
