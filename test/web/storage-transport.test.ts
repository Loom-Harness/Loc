import { afterEach, describe, expect, it } from "vitest";
import { StorageClient } from "../../web/src/runtime/storage-client.js";
import { StorageScheduler } from "../../web/src/runtime/storage-scheduler.js";
import { type StatementEngine, StorageServer } from "../../web/src/runtime/storage-server.js";
import type { WireResultSet } from "../../web/src/runtime/storage-wire.js";

// The playground's storage transport: one PGlite session in the storage
// host, shared by every deployable over a MessagePort each.  The scheduler
// gives each deployable the isolation separate connections would.  These
// tests drive the real client and server over real MessageChannels against
// `FakeSession`, a single session with PGlite's defining property: a
// transaction one statement opens is open for EVERY later statement on the
// session, whoever sends it.  A scheduler that let another client's statement
// in while a transaction is open would therefore read its uncommitted rows.

const TEXT = 25;

class FakeSession implements StatementEngine {
  readonly committed = new Map<string, string>();
  /** Writes of the open transaction, one frame per savepoint level. */
  private frames: Array<Map<string, string>> | null = null;
  private savepoints: string[] = [];
  /** Every statement in the order the session ran it. */
  readonly log: string[] = [];

  inTransaction(): boolean {
    return this.frames !== null;
  }

  async rollback(): Promise<void> {
    await this.run("ROLLBACK");
  }

  private read(key: string): string | null {
    for (const f of [...(this.frames ?? [])].reverse()) if (f.has(key)) return f.get(key) ?? null;
    return this.committed.get(key) ?? null;
  }

  /** `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT s` / `RELEASE SAVEPOINT s` /
   *  `ROLLBACK TO SAVEPOINT s` / `SET k v` / `GET k` / `FAIL code`. */
  private async run(sql: string): Promise<WireResultSet> {
    await new Promise((r) => setTimeout(r, 1));
    this.log.push(sql);
    const [verb, a, b] = sql.split(" ");
    const empty = { fields: [], rows: [], affectedRows: 0 };
    if (sql === "BEGIN") {
      this.frames = [new Map()];
      return empty;
    }
    if (sql === "COMMIT") {
      for (const f of this.frames ?? []) for (const [k, v] of f) this.committed.set(k, v);
      this.frames = null;
      this.savepoints = [];
      return empty;
    }
    if (sql === "ROLLBACK") {
      this.frames = null;
      this.savepoints = [];
      return empty;
    }
    if (verb === "SAVEPOINT") {
      this.savepoints.push(a ?? "");
      this.frames?.push(new Map());
      return empty;
    }
    if (sql.startsWith("RELEASE SAVEPOINT")) {
      const top = this.frames?.pop();
      this.savepoints.pop();
      for (const [k, v] of top ?? []) this.frames?.at(-1)?.set(k, v);
      return empty;
    }
    if (sql.startsWith("ROLLBACK TO SAVEPOINT")) {
      this.frames?.pop();
      this.frames?.push(new Map());
      return empty;
    }
    if (verb === "SET") {
      // Autocommit outside a transaction, like Postgres.
      if (this.frames) this.frames.at(-1)?.set(a ?? "", b ?? "");
      else this.committed.set(a ?? "", b ?? "");
      return { ...empty, affectedRows: 1 };
    }
    if (verb === "GET") {
      return {
        fields: [{ name: "v", dataTypeID: TEXT }],
        rows: [[this.read(a ?? "")]],
        affectedRows: 0,
      };
    }
    if (verb === "FAIL") {
      throw Object.assign(new Error(`duplicate key value violates unique constraint`), {
        code: a,
        constraint: "things_pkey",
        severity: "ERROR",
      });
    }
    throw new Error(`fake session: unknown statement ${sql}`);
  }

  async query(sql: string): Promise<WireResultSet[]> {
    return [await this.run(sql)];
  }

  async exec(sql: string): Promise<WireResultSet[]> {
    return [await this.run(sql)];
  }
}

/** A Web Lock stand-in: `release(name)` is the client's worker ending. */
class FakeLocks {
  private readonly waiting = new Map<string, () => void>();
  readonly watch = (name: string) =>
    new Promise<void>((resolve) => this.waiting.set(name, resolve));
  readonly manager = {
    request: (name: string, cb: () => Promise<void>) => {
      this.names.push(name);
      return cb();
    },
  } as unknown as LockManager;
  readonly names: string[] = [];
  release(name: string): void {
    this.waiting.get(name)?.();
  }
}

const opened: Array<StorageClient> = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

function setup(locks: FakeLocks | null = null) {
  const db = new FakeSession();
  const server = new StorageServer(db, locks?.watch ?? null);
  const connect = (owner: string) => {
    const { port1, port2 } = new MessageChannel();
    server.attach(owner, port1);
    const client = new StorageClient(port2, locks?.manager ?? null);
    opened.push(client);
    return client;
  };
  return { db, server, connect };
}

const get = async (c: StorageClient | { query: StorageClient["query"] }, key: string) =>
  (await c.query<{ v: string | null }>(`GET ${key}`)).rows[0]?.v ?? null;

/** Resolves once `fn` holds, polling the event loop. */
async function until(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !fn(); i++) await new Promise((r) => setTimeout(r, 2));
  expect(fn()).toBe(true);
}

describe("storage transport", () => {
  it("one round trip per statement; BEGIN rides on a transaction's first statement", async () => {
    const { db, connect } = setup();
    const a = connect("admin");
    await a.query("SET k 1");
    await a.transaction(async (tx) => {
      await tx.query("SET k 2");
      await tx.query("SET j 3");
    });
    await a.transaction(async () => undefined);
    expect(db.log).toEqual(["SET k 1", "BEGIN", "SET k 2", "SET j 3", "COMMIT"]);
    expect(await get(a, "k")).toBe("2");
  });

  it("another client's statement waits for an open transaction, then runs in arrival order", async () => {
    const { db, connect } = setup();
    const a = connect("admin");
    const b = connect("shop");
    const c = connect("ops");
    let commit!: () => void;
    const inTx = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const txDone = a.transaction(async (tx) => {
      await tx.query("SET x 1");
      await inTx;
      await tx.query("SET y 1");
    });
    await until(() => db.log.includes("SET x 1"));
    const readX = get(b, "x");
    const writeZ = c.query("SET z 1");
    await new Promise((r) => setTimeout(r, 20));
    // Neither ran inside admin's transaction: it still holds the session.
    expect(db.log).toEqual(["BEGIN", "SET x 1"]);
    commit();
    await txDone;
    expect(await readX).toBe("1");
    await writeZ;
    expect(db.log).toEqual(["BEGIN", "SET x 1", "SET y 1", "COMMIT", "GET x", "SET z 1"]);
  });

  it("a transaction that throws rolls back and frees the session", async () => {
    const { connect } = setup();
    const a = connect("admin");
    const b = connect("shop");
    await expect(
      a.transaction(async (tx) => {
        await tx.query("SET x 1");
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    expect(await get(b, "x")).toBeNull();
    expect(await get(a, "x")).toBeNull();
  });

  it("nested transactions use savepoints inside the one transaction", async () => {
    const { db, connect } = setup();
    const a = connect("admin");
    await a.transaction(async (tx) => {
      await tx.query("SET outer 1");
      // drizzle's nested `tx.transaction` — savepoint, then roll back to it.
      await tx.exec("SAVEPOINT sp1");
      await tx.query("SET inner 1");
      await tx.exec("ROLLBACK TO SAVEPOINT sp1");
      await tx.exec("RELEASE SAVEPOINT sp1");
      await tx.exec("SAVEPOINT sp1");
      await tx.query("SET kept 1");
      await tx.exec("RELEASE SAVEPOINT sp1");
    });
    expect(await get(a, "outer")).toBe("1");
    expect(await get(a, "inner")).toBeNull();
    expect(await get(a, "kept")).toBe("1");
    expect(db.log.filter((s) => s === "BEGIN" || s === "COMMIT")).toEqual(["BEGIN", "COMMIT"]);
  });

  it("the client's own statements wait for its running transaction", async () => {
    const { db, connect } = setup();
    const a = connect("admin");
    let commit!: () => void;
    const gate = new Promise<void>((r) => {
      commit = r;
    });
    const tx = a.transaction(async (t) => {
      await t.query("SET x 1");
      await gate;
    });
    await until(() => db.log.includes("SET x 1"));
    const outside = a.query("SET y 1");
    await new Promise((r) => setTimeout(r, 20));
    expect(db.log).toEqual(["BEGIN", "SET x 1"]);
    commit();
    await tx;
    await outside;
    expect(db.log).toEqual(["BEGIN", "SET x 1", "COMMIT", "SET y 1"]);
  });

  it("a client dropped mid-transaction is rolled back BEFORE the next client's queued statement", async () => {
    const { db, server, connect } = setup();
    const a = connect("admin");
    const b = connect("shop");
    // admin opens a transaction, writes, and never finishes: its worker dies.
    void a
      .transaction(async (tx) => {
        await tx.query("SET x dirty");
        await new Promise(() => undefined);
      })
      .catch(() => undefined);
    await until(() => db.log.includes("SET x dirty"));
    const read = get(b, "x");
    // shop's read is queued behind admin's transaction before admin dies.
    await new Promise((r) => setTimeout(r, 10));
    server.detach("admin");
    expect(await read).toBeNull();
    expect(db.log).toEqual(["BEGIN", "SET x dirty", "ROLLBACK", "GET x"]);
    expect(server.attached).toEqual(["shop#2"]);
  });

  it("the liveness lock's release drops the client like an explicit detach", async () => {
    const locks = new FakeLocks();
    const { db, server, connect } = setup(locks);
    const a = connect("admin");
    const b = connect("shop");
    void a
      .transaction(async (tx) => {
        await tx.query("SET x dirty");
        await new Promise(() => undefined);
      })
      .catch(() => undefined);
    await until(() => db.log.includes("SET x dirty"));
    const read = get(b, "x");
    // shop's read is queued behind admin's transaction before admin dies.
    await new Promise((r) => setTimeout(r, 10));
    // The browser ended admin's worker: its lock is released, nobody said so.
    const [adminLock] = locks.names;
    locks.release(adminLock ?? "");
    expect(await read).toBeNull();
    expect(db.log).toEqual(["BEGIN", "SET x dirty", "ROLLBACK", "GET x"]);
    expect(server.attached).toEqual(["shop#2"]);
  });

  it("close rolls back what the client left open", async () => {
    const { db, connect, server } = setup();
    const a = connect("admin");
    const b = connect("shop");
    void a
      .transaction(async (tx) => {
        await tx.query("SET x dirty");
        await new Promise(() => undefined);
      })
      .catch(() => undefined);
    await until(() => db.log.includes("SET x dirty"));
    await a.close();
    expect(await get(b, "x")).toBeNull();
    expect(server.attached).toEqual(["shop#2"]);
  });

  it("a Postgres error keeps its fields and names the statement", async () => {
    const { connect } = setup();
    const a = connect("admin");
    const err = (await a.query("FAIL 23505").catch((e) => e)) as Record<string, unknown>;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/unique constraint/);
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("things_pkey");
    expect(err.query).toBe("FAIL 23505");
  });

  it("applies the caller's parsers to its own types and builds objects or arrays", async () => {
    const { connect } = setup();
    const a = connect("admin");
    await a.query("SET d 2026-01-01");
    const parsers = { [TEXT]: (v: string) => `parsed:${v}` };
    expect((await a.query("GET d", [], { parsers })).rows).toEqual([{ v: "parsed:2026-01-01" }]);
    expect((await a.query("GET d", [], { rowMode: "array" })).rows).toEqual([["2026-01-01"]]);
    await expect(a.query("GET d", [], { serializers: {} })).rejects.toThrow(/serializers/);
  });
});

describe("storage scheduler", () => {
  it("a host job waits for an open transaction and rolls back what it leaves open", async () => {
    const db = new FakeSession();
    const s = new StorageScheduler(db);
    let commit!: () => void;
    const gate = new Promise<void>((r) => {
      commit = r;
    });
    await s.submit("a", () => db.exec("BEGIN"));
    expect(s.transactionHolder).toBe("a");
    const hostJob = s.exclusive(async () => {
      await db.exec("BEGIN");
      await db.exec("SET h 1");
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(db.log).toEqual(["BEGIN"]);
    void gate.then(() => s.submit("a", () => db.exec("COMMIT")));
    commit();
    await hostJob;
    expect(db.log).toEqual(["BEGIN", "COMMIT", "BEGIN", "SET h 1", "ROLLBACK"]);
    expect(s.transactionHolder).toBeNull();
  });

  it("a dropped client's queued statements are rejected", async () => {
    const db = new FakeSession();
    const s = new StorageScheduler(db);
    await s.submit("b", () => db.exec("BEGIN"));
    const queued = s.submit("a", () => db.exec("SET x 1"));
    s.drop("a");
    await expect(queued).rejects.toThrow(/closed/);
    await expect(s.submit("a", () => db.exec("SET x 1"))).rejects.toThrow(/closed/);
  });
});
