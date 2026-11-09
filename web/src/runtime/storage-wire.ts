// The wire between a deployable worker and its storage host: one
// `MessagePort` per (deployable, storage), transferred by the engine
// (main thread → infra worker → storage host, and main thread → deployable
// worker).  One request is one statement, and it gets exactly one response.
//
// The port carries nothing but SQL.  Broker pushes and resource-fake calls
// ride the deployable's `InfraPort` instead, so a statement never queues
// behind a broker delivery, and it skips the infra worker's relay.
//
// Results cross as plain data. The host parses every column with PGlite's
// own parsers, except the type ids the client lists in `rawOids`.  Those
// columns stay as the text Postgres sent, and the client runs its own
// parsers on them.  A parser is a function and cannot be cloned; drizzle
// overrides a handful of types this way (dates, intervals and their arrays).

/** One result set, rows in array mode. */
export interface WireResultSet {
  fields: Array<{ name: string; dataTypeID: number }>;
  rows: unknown[][];
  affectedRows: number;
}

/** The fields of a Postgres `DatabaseError` (code, detail, constraint, …),
 *  kept so generated code that reads `err.code` sees what it would against
 *  a real server. */
export interface WireError {
  message: string;
  fields: Record<string, unknown>;
}

export type StorageWireRequest =
  /** First message on a port: names the client and the Web Lock it holds
   *  while alive (see `storage-server.ts` → liveness). */
  | { id: number; op: "hello"; lock: string | null }
  /** An extended-protocol statement.  `begin` opens a transaction first —
   *  the client folds a transaction's `BEGIN` into its first statement. */
  | {
      id: number;
      op: "query";
      sql: string;
      params: unknown[];
      paramTypes?: number[];
      rawOids: number[];
      begin?: boolean;
    }
  /** Simple-protocol SQL (may hold several statements). */
  | { id: number; op: "exec"; sql: string; rawOids: number[]; begin?: boolean }
  /** The client is done: roll back whatever it left open, release its lock. */
  | { id: number; op: "close" };

export type StorageWireResponse =
  | { id: number; ok: true; sets: WireResultSet[] }
  | { id: number; ok: false; error: WireError };

/** Sent unasked when the host drops the client (detached, storage closed):
 *  nothing more will be answered on this port. */
export interface StorageWireClosed {
  closed: true;
}
