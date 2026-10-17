export class Lanes {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(private readonly maxWaitMs = 30_000) {}

  run(key: string, task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const turn = Promise.race([
      previous,
      new Promise<void>((resolve) => setTimeout(resolve, this.maxWaitMs).unref()),
    ]);
    const next = turn.then(task).catch(onError);
    this.#tails.set(key, next);
    void next.finally(() => {
      if (this.#tails.get(key) === next) this.#tails.delete(key);
    });
    return next;
  }

  get size(): number {
    return this.#tails.size;
  }
}
