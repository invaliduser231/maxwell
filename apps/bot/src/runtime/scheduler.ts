import { claim, complete, enqueue, fail, type Job, type JobInput, type Sql } from '@maxwell/core';
import { inGuild } from '../i18n/language.js';
import type { Logger } from '../log.js';

export type JobHandler = (job: Job) => Promise<void>;

const BACKOFF = [10_000, 60_000, 5 * 60_000, 30 * 60_000];

export class Scheduler {
  readonly #handlers = new Map<string, JobHandler>();
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #stopped = false;

  constructor(
    private readonly sql: Sql,
    private readonly log: Logger,
    private readonly intervalMs = 1_000,
  ) {}

  handle(kind: string, handler: JobHandler): void {
    if (this.#handlers.has(kind)) throw new Error(`duplicate job handler: ${kind}`);
    this.#handlers.set(kind, handler);
  }

  enqueue(job: JobInput): Promise<string | null> {
    return enqueue(this.sql, job);
  }

  start(): void {
    if (this.#timer) return;
    this.#stopped = false;
    this.#timer = setInterval(() => void this.tick(), this.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async tick(): Promise<number> {
    if (this.#running || this.#stopped) return 0;
    this.#running = true;
    try {
      const jobs = await claim(this.sql, 20, 60, [...this.#handlers.keys()]);
      await Promise.all(jobs.map((job) => this.#run(job)));
      return jobs.length;
    } catch (error) {
      this.log.error({ err: error }, 'scheduler tick failed');
      return 0;
    } finally {
      this.#running = false;
    }
  }

  async #run(job: Job): Promise<void> {
    const handler = this.#handlers.get(job.kind);
    if (!handler) {
      this.log.warn({ kind: job.kind, id: job.id }, 'no handler for job');
      await fail(this.sql, job.id, 'no handler', null);
      return;
    }
    try {
      await inGuild(job.guildId, () => handler(job));
      await complete(this.sql, job.id);
    } catch (error) {
      const delay = BACKOFF[job.attempts - 1];
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(
        { err: error, kind: job.kind, id: job.id, attempt: job.attempts },
        'job failed',
      );
      await fail(
        this.sql,
        job.id,
        message,
        delay === undefined ? null : new Date(Date.now() + delay),
      );
    }
  }
}
