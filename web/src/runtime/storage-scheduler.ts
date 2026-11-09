// The storage host's one-connection discipline: PGlite is a single Postgres
// session, so every client's statements share it, and a transaction one
// client opens is open for everyone.  The scheduler gives each client the
// isolation a real server's separate connections would:
//
// - Jobs run one at a time, in arrival order.
// - A job that leaves the session inside a transaction makes its client the
//   **holder**.  Until the session is idle again, only the holder's jobs run;
//   everyone else's wait in the queue, still in arrival order.
// - A client that goes away (`drop`) loses its queued jobs.  If it held the
//   transaction, the scheduler rolls it back as its very next step, ahead of
//   every queued job.  A waiting client can therefore never run a statement
//   inside a dead client's transaction and read its uncommitted rows.
// - A host job (`exclusive`: migrate, the Database console, Reset) queues
//   like any client's.  It runs with no transaction open, and whatever it
//   leaves open is rolled back, so the console cannot wedge the storage.
//
// Whether a transaction is open is read from the session itself after every
// job (`inTransaction`), never from what the client claims.

export interface SessionState {
  /** True while the session is inside a transaction block (open or aborted). */
  inTransaction(): boolean;
  /** Roll back the open transaction. */
  rollback(): Promise<void>;
}

interface Job {
  client: string;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/** The client id `exclusive` jobs run as. */
const HOST = "\0host";

export class StorageScheduler {
  private readonly queue: Job[] = [];
  private holder: string | null = null;
  private running = false;
  private readonly dropped = new Set<string>();

  constructor(private readonly session: SessionState) {}

  /** Run `run` as one of `client`'s statements. */
  submit<T>(client: string, run: () => Promise<T>): Promise<T> {
    if (this.dropped.has(client)) return Promise.reject(new Error("Storage connection closed."));
    return this.enqueue(client, run);
  }

  /** Run `run` with no client's transaction open, rolling back whatever it
   *  leaves open. */
  exclusive<T>(run: () => Promise<T>): Promise<T> {
    return this.enqueue(HOST, async () => {
      try {
        return await run();
      } finally {
        if (this.session.inTransaction()) await this.session.rollback();
      }
    });
  }

  /** `client` is gone: reject its queued jobs and, if it holds the open
   *  transaction, roll that back before anything else runs.  A job of its
   *  that is running finishes first; it cannot be interrupted. */
  drop(client: string): void {
    this.dropped.add(client);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const job = this.queue[i];
      if (job?.client !== client) continue;
      this.queue.splice(i, 1);
      job.reject(new Error("Storage connection closed."));
    }
    this.pump();
  }

  /** Who holds the open transaction (tests, diagnostics). */
  get transactionHolder(): string | null {
    return this.holder;
  }

  private enqueue<T>(client: string, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ client, run, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  private next(): Job | undefined {
    const i = this.holder === null ? 0 : this.queue.findIndex((j) => j.client === this.holder);
    return i < 0 ? undefined : this.queue.splice(i, 1)[0];
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    try {
      for (;;) {
        // A dead holder's transaction ends before anyone else's statement.
        if (this.holder !== null && this.dropped.has(this.holder)) {
          try {
            await this.session.rollback();
          } catch {
            // A failed rollback leaves nothing more to undo for this client.
          }
          this.holder = null;
        }
        const job = this.next();
        if (!job) return;
        try {
          job.resolve(await job.run());
        } catch (err) {
          job.reject(err);
        }
        this.holder = this.session.inTransaction() ? job.client : null;
      }
    } finally {
      this.running = false;
    }
  }
}
