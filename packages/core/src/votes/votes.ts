import type { Sql } from '../db/sql.js';
import type { Logger } from '../log.js';

export interface FluxerListOptions {
  apiBase: string;
  apiKey: string;
  botId: string;
  timeoutMs?: number;
}

const VOTER_ID = /"fluxerId"\s*:\s*"?(\d+)"?/g;

export function extractVoterIds(body: string): string[] {
  return [...body.matchAll(VOTER_ID)].map((match) => match[1] ?? '').filter(Boolean);
}

export class FluxerList {
  constructor(private readonly options: FluxerListOptions) {}

  private async request(path: string): Promise<Response> {
    const base = this.options.apiBase.replace(/\/+$/, '');
    const response = await fetch(
      `${base}/api/v1/bots/${encodeURIComponent(this.options.botId)}${path}`,
      {
        headers: { authorization: `Bearer ${this.options.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      },
    );
    if (!response.ok) throw new Error(`fluxerlist ${path}: ${response.status}`);
    return response;
  }

  async voters(page: number, limit = 100): Promise<string[]> {
    const response = await this.request(`/voters?page=${page}&limit=${limit}`);
    return extractVoterIds(await response.text());
  }

  async hasVoted(userId: string): Promise<boolean> {
    const response = await this.request(`/check?fluxerId=${encodeURIComponent(userId)}`);
    const body = (await response.json().catch(() => null)) as { voted?: unknown } | null;
    return body?.voted === true;
  }
}

export class Votes {
  readonly #recentChecks = new Map<string, number>();

  constructor(
    private readonly sql: Sql,
    private readonly api: FluxerList | null,
    private readonly log: Logger,
    private readonly checkCooldownMs = 10 * 60_000,
  ) {}

  async hasVoted(userId: string): Promise<boolean> {
    const [row] = await this.sql`select 1 from voters where user_id = ${userId}`;
    return row !== undefined;
  }

  async check(userId: string): Promise<boolean> {
    if (await this.hasVoted(userId)) return true;
    if (!this.api) return false;
    const last = this.#recentChecks.get(userId) ?? 0;
    if (Date.now() - last < this.checkCooldownMs) return false;
    this.#recentChecks.set(userId, Date.now());
    if (this.#recentChecks.size > 10_000) this.#recentChecks.clear();
    try {
      if (!(await this.api.hasVoted(userId))) return false;
    } catch (error) {
      this.log.warn({ err: error }, 'vote check failed');
      return false;
    }
    await this.add([userId]);
    return true;
  }

  async add(userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;
    const rows = await this.sql`
      insert into voters (user_id) select unnest(${userIds}::bigint[])
      on conflict (user_id) do nothing
      returning user_id
    `;
    return rows.length;
  }

  async sync(maxPages = 50): Promise<number> {
    if (!this.api) return 0;
    let added = 0;
    for (let page = 1; page <= maxPages; page++) {
      const ids = await this.api.voters(page);
      if (ids.length === 0) break;
      const fresh = await this.add(ids);
      added += fresh;
      if (fresh < ids.length) break;
    }
    return added;
  }
}
