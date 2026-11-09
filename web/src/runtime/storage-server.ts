// The storage host's end of every deployable's storage port (see
// `storage-wire.ts`): it reads statements off the ports, runs them through
// the `StorageScheduler` and answers each with one message.
//
// Liveness. A deployable worker can vanish mid-transaction: the engine
// terminates it, the browser kills it, or it is respawned. A `MessagePort`
// does not tell its peer that it closed, so the host learns of it in one of
// two ways. Whichever comes first drops the client, which rolls back its
// transaction before any other client's queued statement runs.
// 1. **Explicit:** the main thread terminates a deployable worker only
//    through the engine. The engine then sends `infra.disconnect`, which the
//    infra worker forwards here as `detach` for that deployable.
// 2. **Backstop:** the client holds a Web Lock for as long as it lives and
//    names it in `hello`. The host queues a request for the same lock. The
//    browser grants it only when the holder releases it, by closing or by
//    its worker ending (a terminated worker releases its locks), so the
//    grant means the client is gone.  This also covers a worker the browser
//    killed with no word to anyone.

import { StorageScheduler, type SessionState } from "./storage-scheduler.js";
import type {
  StorageWireClosed,
  StorageWireRequest,
  StorageWireResponse,
  WireError,
  WireResultSet,
} from "./storage-wire.js";

/** How the host runs SQL — PGlite in the storage host, a fake in tests. */
export interface StatementEngine extends SessionState {
  query(sql: string, params: unknown[], opts: { paramTypes?: number[]; rawOids: number[] }): Promise<WireResultSet[]>;
  exec(sql: string, opts: { rawOids: number[] }): Promise<WireResultSet[]>;
}

/** Waits until nobody holds the named Web Lock (`navigator.locks`). */
export type LockWatch = (lock: string) => Promise<void>;

export const webLockWatch: LockWatch | null =
  typeof navigator !== "undefined" && navigator.locks
    ? (lock) => navigator.locks.request(lock, () => undefined).then(() => undefined)
    : null;

interface Attachment {
  /** The deployable the engine attached (`detach` names it). */
  owner: string;
  port: MessagePort;
}

export class StorageServer {
  readonly scheduler: StorageScheduler;
  private readonly clients = new Map<string, Attachment>();
  private nextClient = 1;

  constructor(
    private readonly engine: StatementEngine,
    private readonly watch: LockWatch | null = webLockWatch,
  ) {
    this.scheduler = new StorageScheduler(engine);
  }

  /** Serve a deployable's storage port. */
  attach(owner: string, port: MessagePort): void {
    const client = `${owner}#${this.nextClient++}`;
    this.clients.set(client, { owner, port });
    port.onmessage = (ev: MessageEvent<StorageWireRequest>) => this.receive(client, ev.data);
  }

  /** Drop every client `owner` attached (the engine stopped it). */
  detach(owner: string): void {
    for (const [client, a] of this.clients) if (a.owner === owner) this.drop(client);
  }

  /** Drop every client (the storage is closing). */
  detachAll(): void {
    for (const client of [...this.clients.keys()]) this.drop(client);
  }

  /** Ids of the attached clients (tests). */
  get attached(): string[] {
    return [...this.clients.keys()];
  }

  private drop(client: string): void {
    const a = this.clients.get(client);
    if (!a) return;
    this.clients.delete(client);
    a.port.onmessage = null;
    a.port.postMessage({ closed: true } satisfies StorageWireClosed);
    a.port.close();
    this.scheduler.drop(client);
  }

  private receive(client: string, req: StorageWireRequest): void {
    const a = this.clients.get(client);
    if (!a) return;
    const reply = (res: StorageWireResponse) => {
      if (this.clients.has(client)) a.port.postMessage(res);
    };
    switch (req.op) {
      case "hello":
        if (req.lock && this.watch) void this.watch(req.lock).then(() => this.drop(client));
        reply({ id: req.id, ok: true, sets: [] });
        return;
      case "close":
        reply({ id: req.id, ok: true, sets: [] });
        this.drop(client);
        return;
      case "query":
      case "exec": {
        const run = async () => {
          if (req.begin) await this.engine.exec("BEGIN", { rawOids: [] });
          return req.op === "query"
            ? this.engine.query(req.sql, req.params, { paramTypes: req.paramTypes, rawOids: req.rawOids })
            : this.engine.exec(req.sql, { rawOids: req.rawOids });
        };
        this.scheduler.submit(client, run).then(
          (sets) => reply({ id: req.id, ok: true, sets }),
          (err) => reply({ id: req.id, ok: false, error: wireError(err) }),
        );
        return;
      }
    }
  }
}

/** A thrown error as plain data: the message plus every own field a
 *  Postgres `DatabaseError` carries (code, detail, constraint, …). */
export function wireError(err: unknown): WireError {
  if (!(err instanceof Error)) return { message: String(err), fields: {} };
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(err)) {
    if (v === undefined || typeof v === "function") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") fields[k] = v;
  }
  return { message: err.message, fields };
}

// -- PGlite ------------------------------------------------------------------

/** The parts of `@electric-sql/pglite`'s module the engine reads. */
export interface PgliteProtocolModule {
  protocol: {
    serialize: {
      parse(opts: { text: string; types?: number[] }): Uint8Array;
      describe(opts: { type: "S" | "P" }): Uint8Array;
      bind(opts: { values: unknown[] }): Uint8Array;
      execute(opts: Record<string, never>): Uint8Array;
      sync(): Uint8Array;
      query(text: string): Uint8Array;
    };
  };
  parse: {
    parseResults(
      messages: unknown[],
      parsers: Record<number, unknown>,
      options?: { rowMode?: "array" | "object"; parsers?: Record<number, unknown> },
    ): Array<{ fields: Array<{ name: string; dataTypeID: number }>; rows: unknown[][]; affectedRows?: number }>;
    parseDescribeStatementResults(messages: unknown[]): number[];
  };
}

/** The parts of a `PGlite` instance the engine reads. */
export interface PgliteSession {
  execProtocolStream(message: Uint8Array, opts: { syncToFs: boolean }): Promise<unknown[]>;
  isInTransaction(): boolean;
  syncToFs(): Promise<void>;
  serializers: Record<number, ((x: unknown) => string) | undefined>;
  parsers: Record<number, unknown>;
}

const keepText = (x: unknown) => x;

/** Run statements on PGlite the way its own `query` / `exec` do, without its
 *  locks (the scheduler serialises), parsing every column except `rawOids`.
 *  The data dir is flushed whenever the session is outside a transaction. */
export function pgliteEngine(pg: PgliteSession, mod: PgliteProtocolModule): StatementEngine {
  const { serialize } = mod.protocol;
  const step = (msg: Uint8Array) => pg.execProtocolStream(msg, { syncToFs: false });
  const parse = (messages: unknown[], rawOids: number[]): WireResultSet[] =>
    mod.parse
      .parseResults(messages, pg.parsers, {
        rowMode: "array",
        parsers: Object.fromEntries(rawOids.map((oid) => [oid, keepText])),
      })
      .map((s) => ({ fields: s.fields, rows: s.rows, affectedRows: s.affectedRows ?? 0 }));
  /** Run `steps`, always ending with Sync (also after an error), then flush. */
  const run = async (steps: (out: unknown[]) => Promise<void>): Promise<unknown[]> => {
    const out: unknown[] = [];
    try {
      await steps(out);
    } finally {
      out.push(...(await step(serialize.sync())));
    }
    if (!pg.isInTransaction()) await pg.syncToFs();
    return out;
  };
  return {
    inTransaction: () => pg.isInTransaction(),
    async rollback() {
      await run(async (out) => {
        out.push(...(await step(serialize.query("ROLLBACK"))));
      });
    },
    async query(sql, params, { paramTypes, rawOids }) {
      const messages = await run(async (out) => {
        out.push(...(await step(serialize.parse({ text: sql, types: paramTypes }))));
        const oids = mod.parse.parseDescribeStatementResults(await step(serialize.describe({ type: "S" })));
        const values = params.map((p, i) => {
          if (p === null || p === undefined) return null;
          const ser = pg.serializers[oids[i] ?? -1];
          return ser ? ser(p) : String(p);
        });
        out.push(...(await step(serialize.bind({ values }))));
        out.push(...(await step(serialize.describe({ type: "P" }))));
        out.push(...(await step(serialize.execute({}))));
      });
      return parse(messages, rawOids).slice(0, 1);
    },
    async exec(sql, { rawOids }) {
      const messages = await run(async (out) => {
        out.push(...(await step(serialize.query(sql))));
      });
      return parse(messages, rawOids);
    },
  };
}
