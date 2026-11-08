import { describe, expect, it } from "vitest";
import { initialPipelineState, pipelineReducer } from "../../web/src/pipeline/reducer.js";
import {
  bootError,
  bootedDDL,
  bootPending,
  type PipelineState,
  pendingMigration,
} from "../../web/src/pipeline/state.js";

// ---------------------------------------------------------------------------
// Pipeline reducer — invariants the playground UI depends on.
//
// Most stage transitions are covered indirectly by the e2e suite,
// but RUNTIME_LOST is hard to drive there (we'd need a backgrounded
// tab + a browser that actually kills idle workers).  This file
// pins the transition explicitly: a fresh runtime worker should
// drop the booted slot to a labelled failure and clear dispatch,
// while leaving generate + bundle intact (they're main-thread
// state, unaffected by worker death).
// ---------------------------------------------------------------------------

const SAMPLE_BUNDLE = {
  ok: true as const,
  kind: "hono" as const,
  code: "export const x = 1;",
  size: 20,
  durationMs: 5,
  fetchedUrls: [],
  diagnostics: [],
};

const SAMPLE_GENERATE = {
  ok: true as const,
  mode: "system" as const,
  files: [{ path: "http/index.ts", content: "", size: 0 }],
  diagnostics: [],
};

const SAMPLE_DISPATCH = {
  ok: true as const,
  durationMs: 5,
  response: {
    status: 200,
    statusText: "OK",
    headers: {},
    body: "[]",
  },
};

function bootedState(persistent: boolean) {
  let s = pipelineReducer(initialPipelineState, { type: "GENERATE_START" });
  s = pipelineReducer(s, { type: "GENERATE_DONE", result: SAMPLE_GENERATE });
  s = pipelineReducer(s, { type: "BUNDLE_START" });
  s = pipelineReducer(s, { type: "BUNDLE_DONE", hono: SAMPLE_BUNDLE, react: null });
  s = pipelineReducer(s, { type: "BOOT_START" });
  s = pipelineReducer(s, {
    type: "BOOT_OK",
    ddl: "CREATE TABLE foo();",
    persistent,
    applied: [],
    head: null,
  });
  s = pipelineReducer(s, { type: "DISPATCH_START" });
  s = pipelineReducer(s, { type: "DISPATCH_DONE", result: SAMPLE_DISPATCH });
  return s;
}

describe("pipelineReducer — BOOT_PENDING", () => {
  it("records why the boot stopped on a migration, without a DDL or an error", () => {
    let s = pipelineReducer(initialPipelineState, { type: "BOOT_START" });
    const migration = {
      kind: "unrecorded" as const,
      head: null,
      initial: true,
      modules: ["Sales"],
      steps: 2,
      destructive: false,
    };
    s = pipelineReducer(s, { type: "BOOT_PENDING", migration, message: "Migration required" });
    expect(s.booting).toBe(false);
    expect(s.boot).toEqual({ kind: "pending", migration, message: "Migration required" });
    expect(bootPending(s)).toEqual({ migration, message: "Migration required" });
    expect(bootedDDL(s)).toBeNull();
    expect(bootError(s)).toBeNull();
    // A later boot clears it.
    expect(bootPending(pipelineReducer(s, { type: "BOOT_START" }))).toBeNull();
  });
});

describe("pipelineReducer — RUNTIME_LOST", () => {
  it("flips boot to fail with the persisted-restored message when the prior boot was OPFS-backed", () => {
    // Persistent boot: PGlite's data island lives in OPFS, keyed
    // by workspace (see App.runBootStep).  When the
    // worker respawns, the next Boot reattaches the same island
    // and the rows come back.  The message has to reflect that —
    // misleading the user into thinking their data is gone was
    // the bug this commit corrects.
    const after = pipelineReducer(bootedState(true), { type: "RUNTIME_LOST" });
    expect(after.boot.kind).toBe("fail");
    if (after.boot.kind === "fail") {
      expect(after.boot.message).toMatch(/runtime worker.*terminated/i);
      expect(after.boot.message).toMatch(/persisted in OPFS/i);
      expect(after.boot.message).toMatch(/will be restored/i);
      expect(after.boot.message).toMatch(/click Boot/i);
    }
  });

  it("flips boot to fail with the in-memory-lost message when the prior boot was ephemeral", () => {
    // In-memory boot (Safari private mode, hostile-storage
    // policies — `persistent: false`): the data lived in the dead
    // worker's heap.  Genuinely gone, and the message says so.
    const after = pipelineReducer(bootedState(false), { type: "RUNTIME_LOST" });
    expect(after.boot.kind).toBe("fail");
    if (after.boot.kind === "fail") {
      expect(after.boot.message).toMatch(/in-memory only/i);
      expect(after.boot.message).toMatch(/are gone/i);
      // The persistent-restored phrase MUST NOT appear — that
      // would falsely promise recovery.
      expect(after.boot.message).not.toMatch(/will be restored/i);
    }
  });

  it("clears dispatch (the old worker's reply will never arrive)", () => {
    const after = pipelineReducer(bootedState(true), { type: "RUNTIME_LOST" });
    expect(after.dispatch.kind).toBe("none");
  });

  it("leaves generate + bundle intact (they're main-thread state)", () => {
    const before = bootedState(true);
    const after = pipelineReducer(before, { type: "RUNTIME_LOST" });
    expect(after.generate).toEqual(before.generate);
    expect(after.bundle).toEqual(before.bundle);
  });

  it("does not flip the booting / dispatching flags on its own", () => {
    // RUNTIME_LOST fires on a respawn that's external to any
    // in-flight pipeline call.  If a Boot was somehow mid-flight,
    // its own DONE/FAIL action is the one that flips `booting`
    // back — we don't want RUNTIME_LOST to silently swallow that.
    const after = pipelineReducer(bootedState(true), { type: "RUNTIME_LOST" });
    expect(after.booting).toBe(false);
    expect(after.dispatching).toBe(false);
  });

  it("from a never-booted state, RUNTIME_LOST still produces a labelled fail", () => {
    // Defence in depth: even if some external trigger fires the
    // action on a fresh pipeline, the reducer must produce a
    // consistent state (no `undefined`s, no half-booted slot).
    // No prior `persistent` to read, so the message falls into
    // the in-memory branch (no promise of recovery).
    const after = pipelineReducer(initialPipelineState, { type: "RUNTIME_LOST" });
    expect(after.boot.kind).toBe("fail");
    if (after.boot.kind === "fail") {
      expect(after.boot.message).not.toMatch(/will be restored/i);
    }
  });
});

// ---------------------------------------------------------------------------
// The pending-migration state — the strip's badge.  It is derived from the
// last chain check (re-run on every source change) and the database head the
// last boot reported, never stored, so a regenerate cannot strand it.
// ---------------------------------------------------------------------------

describe("pendingMigration", () => {
  const UNRECORDED = { initial: false, modules: ["Sales"], steps: 1, destructive: false };
  const check = (units: string[], unrecorded: typeof UNRECORDED | null = null): PipelineState =>
    pipelineReducer(initialPipelineState, {
      type: "MIGRATION_CHECKED",
      check: { kind: "chain", units, unrecorded },
    });
  const boot = (s: PipelineState, head: string | null): PipelineState =>
    pipelineReducer(pipelineReducer(s, { type: "BOOT_START" }), {
      type: "BOOT_OK",
      ddl: "",
      persistent: true,
      applied: [],
      head,
    });

  it("is unknown until a check finishes, and for a source without a system", () => {
    expect(pendingMigration(initialPipelineState)).toBeNull();
    const s = pipelineReducer(initialPipelineState, {
      type: "MIGRATION_CHECKED",
      check: { kind: "unversioned" },
    });
    expect(pendingMigration(s)).toBeNull();
  });

  it("an example with no chain reads unrecorded, initial — before any generate or boot", () => {
    const s = check([], { ...UNRECORDED, initial: true, modules: ["Sales", "Billing"], steps: 9 });
    expect(pendingMigration(s)).toEqual({
      kind: "unrecorded",
      initial: true,
      modules: ["Sales", "Billing"],
      steps: 9,
      destructive: false,
    });
  });

  it("unrecorded changes win over the database's head, destructive flag included", () => {
    let s = boot(check(["v1_sales_initial"]), "v1_sales_initial");
    s = pipelineReducer(s, {
      type: "MIGRATION_CHECKED",
      check: {
        kind: "chain",
        units: ["v1_sales_initial"],
        unrecorded: { ...UNRECORDED, destructive: true },
      },
    });
    expect(pendingMigration(s)).toMatchObject({ kind: "unrecorded", steps: 1, destructive: true });
  });

  it("recorded, not applied: the chain moved past the head the last boot reached — and a boot to the head clears it", () => {
    let s = boot(check(["v1_sales_initial"]), "v1_sales_initial");
    expect(pendingMigration(s)).toEqual({ kind: "up-to-date" });
    s = pipelineReducer(s, {
      type: "MIGRATION_CHECKED",
      check: { kind: "chain", units: ["v1_sales_initial", "v2_sales_add_phone"], unrecorded: null },
    });
    expect(pendingMigration(s)).toEqual({
      kind: "recorded-not-applied",
      units: ["v2_sales_add_phone"],
    });
    // A regenerate clears the boot slot but not what the database is at.
    s = pipelineReducer(s, { type: "GENERATE_START" });
    expect(pendingMigration(s)).toEqual({
      kind: "recorded-not-applied",
      units: ["v2_sales_add_phone"],
    });
    s = boot(s, "v2_sales_add_phone");
    expect(pendingMigration(s)).toEqual({ kind: "up-to-date" });
  });

  it("a boot that stopped on unrecorded changes records the head it read; recording them leaves them to apply", () => {
    let s = check([], { ...UNRECORDED, initial: true });
    s = pipelineReducer(s, { type: "BOOT_START" });
    s = pipelineReducer(s, {
      type: "BOOT_PENDING",
      migration: { kind: "unrecorded", head: null, ...UNRECORDED, initial: true },
      message: "Migration required",
    });
    s = pipelineReducer(s, {
      type: "MIGRATION_CHECKED",
      check: { kind: "chain", units: ["v1_sales_initial"], unrecorded: null },
    });
    expect(pendingMigration(s)).toEqual({
      kind: "recorded-not-applied",
      units: ["v1_sales_initial"],
    });
  });

  it("a re-check that confirms the slot keeps the state object, so the app does not re-render", () => {
    const s = check(["v1_sales_initial"], UNRECORDED);
    const same = pipelineReducer(s, {
      type: "MIGRATION_CHECKED",
      check: { kind: "chain", units: ["v1_sales_initial"], unrecorded: { ...UNRECORDED } },
    });
    expect(same).toBe(s);
    const moved = pipelineReducer(s, {
      type: "MIGRATION_CHECKED",
      check: {
        kind: "chain",
        units: ["v1_sales_initial"],
        unrecorded: { ...UNRECORDED, steps: 2 },
      },
    });
    expect(moved).not.toBe(s);
    expect(pendingMigration(moved)).toMatchObject({ kind: "unrecorded", steps: 2 });
  });

  it("not booted this session: a chain that records the model is up to date (Boot applies it)", () => {
    expect(pendingMigration(check(["v1_sales_initial"]))).toEqual({ kind: "up-to-date" });
  });

  it("an in-memory database lost with its worker forgets its head; a persisted one keeps it", () => {
    const persisted = pipelineReducer(boot(check(["a", "b"]), "a"), { type: "RUNTIME_LOST" });
    expect(pendingMigration(persisted)).toEqual({ kind: "recorded-not-applied", units: ["b"] });
    let mem = pipelineReducer(check(["a", "b"]), { type: "BOOT_START" });
    mem = pipelineReducer(mem, {
      type: "BOOT_OK",
      ddl: "",
      persistent: false,
      applied: [],
      head: "a",
    });
    mem = pipelineReducer(mem, { type: "RUNTIME_LOST" });
    expect(pendingMigration(mem)).toEqual({ kind: "up-to-date" });
  });

  it("RESET (a project switch) forgets the check and the database", () => {
    const s = pipelineReducer(boot(check(["a"]), "a"), { type: "RESET" });
    expect(s.migrationCheck).toEqual({ kind: "none" });
    expect(s.database).toEqual({ kind: "unknown" });
  });
});
