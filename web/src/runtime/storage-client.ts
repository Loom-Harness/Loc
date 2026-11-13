// A deployable worker's connection to its storage: the client end of the
// storage port (see `storage-wire.ts`).  It speaks the slice of PGlite's API
// that drizzle's `drizzle-orm/pglite` driver calls (`query` with row mode
// and per-type parsers, `exec`, `transaction` with its `tx.query` /
// `tx.exec` / `tx.rollback`), so `drizzle(client)` runs on it unchanged.
// Each statement is one round trip.  A transaction opens lazily: its
// `BEGIN` rides on its first statement, and its `COMMIT` / `ROLLBACK` is one
// more round trip.
//
// Statements from one client run in the order issued.  While a transaction
// runs, the client's other statements wait for it to end, as they do on
// PGlite itself, so none of them lands inside someone else's transaction on
// the host.  Isolation from other deployables is the host's job
// (`storage-scheduler.ts`).

import { bindToCallerContext } from "./async-context.js";
import type {
  StorageWireClosed,
  StorageWireRequest,
  StorageWireResponse,
  WireError,
  WireResultSet,
} from "./storage-wire.js";

type Parser = (value: string, typeId: number) => unknown;

export interface QueryOptions {
  rowMode?: "array" | "object";
  parsers?: Record<number, Parser>;
  paramTypes?: number[];
  /** Not supported over the port: PGlite applies serializers by the type ids
   *  the host learns, and a function cannot cross.  Present only to refuse
   *  it loudly. */
  serializers?: Record<number, unknown>;
  /** Not supported (`/dev/blob` COPY). */
  blob?: unknown;
}

export interface Results<T = Record<string, unknown>> {
  rows: T[];
  fields: Array<{ name: string; dataTypeID: number }>;
  affectedRows: number;
}

export interface Transaction {
  query<T>(sql: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>>;
  exec(sql: string, options?: QueryOptions): Promise<Results[]>;
  rollback(): Promise<void>;
  readonly closed: boolean;
}

/** How long `close` waits for the host to confirm. */
const CLOSE_WAIT_MS = 2_000;

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** Name of the Web Lock a client holds while alive (see `storage-server.ts`). */
let lockSeq = 0;
function lockName(): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
  return `loom-storage-client:${rand}:${++lockSeq}`;
}

export class StorageClient {
  /** Resolves once the host answered `hello` (the client holds its lock). */
  readonly waitReady: Promise<void>;
  private nextId = 1;
  private readonly pending = new Map<number, (res: StorageWireResponse) => void>();
  private closed = false;
  private releaseLock: (() => void) | null = null;
  /** The tail of this client's transaction chain: statements wait for it. */
  private txTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly port: MessagePort,
    locks: LockManager | null = typeof navigator !== "undefined" ? (navigator.locks ?? null) : null,
  ) {
    port.onmessage = (ev: MessageEvent<StorageWireResponse | StorageWireClosed>) => {
      const msg = ev.data;
      if ("closed" in msg) {
        this.shut();
        return;
      }
      const settle = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      settle?.(msg);
    };
    this.waitReady = this.hello(locks);
  }

  private async hello(locks: LockManager | null): Promise<void> {
    let lock: string | null = null;
    if (locks) {
      lock = lockName();
      const name = lock;
      // Granted at once (the name is unique); held until `close`, or until
      // this worker ends, which is the host's signal that it is gone.
      await new Promise<void>((granted) => {
        void locks.request(name, () => {
          granted();
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        });
      });
    }
    await this.send({ op: "hello", lock });
  }

  private send(req: DistributiveOmit<StorageWireRequest, "id">): Promise<WireResultSet[]> {
    if (this.closed) return Promise.reject(new Error("Storage connection closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (res) => (res.ok ? resolve(res.sets) : reject(toError(res.error))));
      this.port.postMessage({ id, ...req } as StorageWireRequest);
    });
  }

  private async runQuery<T>(sql: string, params: unknown[], options: QueryOptions | undefined, begin: boolean) {
    refuseUnsupported(options);
    try {
      const sets = await this.send({
        op: "query",
        sql,
        params,
        paramTypes: options?.paramTypes,
        rawOids: rawOids(options),
        ...(begin ? { begin } : {}),
      });
      return shape<T>(sets[0], options);
    } catch (err) {
      throw annotate(err, sql, params);
    }
  }

  private async runExec(sql: string, options: QueryOptions | undefined, begin: boolean): Promise<Results[]> {
    refuseUnsupported(options);
    try {
      const sets = await this.send({ op: "exec", sql, rawOids: rawOids(options), ...(begin ? { begin } : {}) });
      return sets.map((s) => shape(s, options));
    } catch (err) {
      throw annotate(err, sql, undefined);
    }
  }

  /** Wait for any running transaction of this client, then run `fn`. */
  private afterTx<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.txTail.then(fn, fn);
    return run;
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = [], options?: QueryOptions): Promise<Results<T>> {
    await this.waitReady;
    return this.afterTx(() => this.runQuery<T>(sql, params, options, false));
  }

  async exec(sql: string, options?: QueryOptions): Promise<Results[]> {
    await this.waitReady;
    return this.afterTx(() => this.runExec(sql, options, false));
  }

  async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    // Runs after this client's own awaits: keep the caller's request context.
    callback = bindToCallerContext(callback);
    await this.waitReady;
    const run = this.afterTx(async () => {
      let begun = false;
      let closed = false;
      const checkClosed = () => {
        if (closed) throw new Error("Transaction is closed");
      };
      /** True for the statement that opens the transaction. */
      const opening = () => {
        const first = !begun;
        begun = true;
        return first;
      };
      const end = async (sql: "COMMIT" | "ROLLBACK") => {
        closed = true;
        if (begun) await this.runExec(sql, undefined, false);
      };
      const tx: Transaction = {
        query: async <R>(sql: string, params: unknown[] = [], options?: QueryOptions) => {
          checkClosed();
          return this.runQuery<R>(sql, params, options, opening());
        },
        exec: async (sql: string, options?: QueryOptions) => {
          checkClosed();
          return this.runExec(sql, options, opening());
        },
        rollback: async () => {
          checkClosed();
          await end("ROLLBACK");
        },
        get closed() {
          return closed;
        },
      };
      try {
        const result = await callback(tx);
        if (!closed) await end("COMMIT");
        return result;
      } catch (err) {
        if (!closed) await end("ROLLBACK");
        throw err;
      }
    });
    this.txTail = run.catch(() => undefined);
    return run;
  }

  /** End the connection: the host rolls back anything left open.  Bounded:
   *  a host that is gone (its worker ended with the infra worker) never
   *  answers, and Reset must not wait on it. */
  async close(): Promise<void> {
    if (this.closed) return;
    await Promise.race([
      this.send({ op: "close" }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS)),
    ]);
    this.shut();
  }

  /** Nothing more will be answered: fail what is in flight, drop the lock. */
  private shut(): void {
    this.closed = true;
    this.port.onmessage = null;
    this.port.close();
    for (const settle of this.pending.values()) {
      settle({ id: 0, ok: false, error: { message: "Storage connection closed.", fields: {} } });
    }
    this.pending.clear();
    this.releaseLock?.();
    this.releaseLock = null;
  }
}

function refuseUnsupported(options: QueryOptions | undefined): void {
  if (options?.serializers) throw new Error("Storage connection: custom `serializers` are not supported.");
  if (options?.blob) throw new Error("Storage connection: `blob` is not supported.");
}

function rawOids(options: QueryOptions | undefined): number[] {
  return options?.parsers ? Object.keys(options.parsers).map(Number) : [];
}

/** Apply the client's own parsers to the columns the host left as text, and
 *  build objects when the caller asked for them. */
function shape<T>(set: WireResultSet | undefined, options: QueryOptions | undefined): Results<T> {
  if (!set) return { rows: [], fields: [], affectedRows: 0 };
  const parsers = options?.parsers;
  const own = parsers
    ? set.fields.map((f) => parsers[f.dataTypeID]).map((p, i) => (p ? [i, p] as const : null))
    : [];
  const apply = own.filter((x): x is readonly [number, Parser] => x !== null);
  const rows = set.rows.map((row) => {
    for (const [i, p] of apply) {
      const v = row[i];
      if (v !== null && v !== undefined) row[i] = p(v as string, set.fields[i]?.dataTypeID ?? 0);
    }
    if (options?.rowMode === "array") return row as T;
    return Object.fromEntries(set.fields.map((f, i) => [f.name, row[i]])) as T;
  });
  return { rows, fields: set.fields, affectedRows: set.affectedRows };
}

/** A host-side error, rebuilt with the Postgres fields it carried. */
function toError(err: WireError): Error {
  const e = new Error(err.message);
  for (const [k, v] of Object.entries(err.fields)) {
    if (k === "message" || k === "stack") continue;
    (e as unknown as Record<string, unknown>)[k] = v;
  }
  return e;
}

/** What PGlite adds to a query error: the statement and its parameters. */
function annotate(err: unknown, query: string, params: unknown[] | undefined): unknown {
  if (err instanceof Error) Object.assign(err, { query, params });
  return err;
}
