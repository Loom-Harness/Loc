// F-029 — generating into a CLEAN output directory silently re-baselines the
// migration history.
//
// The defect, end to end on a live stack: add ONE optional field to an
// aggregate, run `ddd generate system … -o <a clean dir>`, and the INITIAL
// migration is rewritten in place — new column, SAME version tag, journal
// still one entry.  Deployed against the database the earlier tree already
// migrated, the migrator matches the tag, considers it applied, and skips the
// changed content: the column never lands, `/ready` still says healthy, and
// every request that names the column 500s.
//
// The three M-T2.2 guards in `migration-artifacts.ts` are structurally blind
// to it, because ALL their evidence lives in the output tree: a clean `-o`
// has no snapshot and no migration files, which is indistinguishable from a
// genuine first run.  The evidence has to come from somewhere that travels
// with the MODEL, which is what `migration-ledger.ts` records beside the
// `.ddd` source.
//
// This suite pins both halves: the ledger itself (what it records, and that a
// deliberate `--allow-rebaseline` SHORTENS it rather than accumulating), and
// the guards it feeds — including the characterization test that says exactly
// what the output tree alone can and cannot see.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EnrichedLoomModel } from "../../src/ir/types/loom-ir.js";
import type { MigrationsIR, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { generateSystemsFromLoom } from "../../src/system/index.js";
import {
  checkMigrationBaseline,
  fsMigrationArtifactIndex,
  MigrationBaselineError,
  memoryMigrationArtifactIndex,
} from "../../src/system/migration-artifacts.js";
import {
  buildMigrationLedger,
  LEDGER_REL_PATH,
  type MigrationHistoryLedger,
  MigrationLedgerReadError,
  migrationLedgerPath,
  parseMigrationLedger,
  readMigrationLedger,
  schemaFingerprint,
  serializeMigrationLedger,
  writeMigrationLedger,
} from "../../src/system/migration-ledger.js";
import { fsSnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const shopSource = (extraField = ""): string => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order {
        total: int${extraField ? `\n        ${extraField}` : ""}
      }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
}
`;

function migrationsIR(over: Partial<MigrationsIR> & Pick<MigrationsIR, "module">): MigrationsIR {
  const emptyNext: SchemaSnapshot = { schemaVersion: 1, tables: [] };
  return {
    module: over.module,
    storageName: "",
    baseline: over.baseline ?? null,
    next: over.next ?? emptyNext,
    steps: over.steps ?? [],
    version: over.version ?? "20260101000000",
    name: over.name ?? "Initial",
  };
}

function snapshotWithHistory(versions: string[]): SchemaSnapshot {
  return {
    schemaVersion: 1,
    tables: [],
    lastVersion: versions.at(-1),
    migrationHistory:
      versions.length > 0 ? versions.map((v) => ({ version: v, name: "M" })) : undefined,
  };
}

function ledger(modules: Record<string, string[]>): MigrationHistoryLedger {
  return {
    schemaVersion: 1,
    modules: Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, { versions: v }])),
  };
}

/** A ledger whose record carries the schema fingerprint of `next` — what a
 *  ledger written by this toolchain actually looks like.  The bare `ledger()`
 *  above omits it on purpose: a record with no fingerprint cannot prove
 *  reproduction, and the guard reads that conservatively. */
function ledgerFor(
  module: string,
  versions: string[],
  next: SchemaSnapshot,
): MigrationHistoryLedger {
  return {
    schemaVersion: 1,
    modules: { [module]: { versions, schemaHash: schemaFingerprint(next) } },
  };
}

/** A one-table schema whose column list is the only thing that varies. */
function ordersSchema(columns: string[]): SchemaSnapshot {
  return {
    schemaVersion: 1,
    tables: [
      {
        name: "orders",
        ownerModule: "Sales",
        columns: columns.map((c) => ({ name: c, type: { kind: "text" } as const, nullable: true })),
        primaryKey: ["id"],
        foreignKeys: [],
        indexes: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The ledger itself
// ---------------------------------------------------------------------------

describe("buildMigrationLedger", () => {
  it("records every version a module's history carries", () => {
    const built = buildMigrationLedger([
      migrationsIR({
        module: "Sales",
        next: snapshotWithHistory(["20260101000000", "20260101500001"]),
      }),
    ]);
    expect(built.modules.Sales?.versions).toEqual(["20260101000000", "20260101500001"]);
  });

  it("keeps modules this run did not build", () => {
    const built = buildMigrationLedger(
      [migrationsIR({ module: "Sales", next: snapshotWithHistory(["20260101000000"]) })],
      ledger({ Retired: ["20250101000000"] }),
    );
    // A module dropped from the model still has its tables in whatever
    // database ran them — forgetting its history re-opens the window.
    expect(built.modules.Retired?.versions).toEqual(["20250101000000"]);
  });

  it("REPLACES a module's record rather than unioning it", () => {
    // The case that matters: `--allow-rebaseline` legitimately SHORTENS a
    // module's history.  Unioning would leave the discarded version recorded,
    // and guard (e) would then refuse the very next delta in the freshly
    // re-baselined tree — migration versions are derived from the baseline, so
    // the new tree re-issues exactly the numbers the old one used.
    const built = buildMigrationLedger(
      [migrationsIR({ module: "Sales", next: snapshotWithHistory(["20260101000000"]) })],
      ledger({ Sales: ["20260101000000", "20260101500001"] }),
    );
    expect(built.modules.Sales?.versions).toEqual(["20260101000000"]);
  });

  it("never erases a record for a run that emitted no history", () => {
    const built = buildMigrationLedger(
      [migrationsIR({ module: "Sales", next: { schemaVersion: 1, tables: [] } })],
      ledger({ Sales: ["20260101000000"] }),
    );
    expect(built.modules.Sales?.versions).toEqual(["20260101000000"]);
  });
});

describe("ledger serialization", () => {
  it("round-trips, sorted and deterministic", () => {
    const text = serializeMigrationLedger(ledger({ Sales: ["20260102000000", "20260101000000"] }));
    expect(text).toBe(
      serializeMigrationLedger(ledger({ Sales: ["20260101000000"].concat(["20260102000000"]) })),
    );
    const parsed = parseMigrationLedger(text);
    expect("ledger" in parsed && parsed.ledger.modules.Sales?.versions).toEqual([
      "20260101000000",
      "20260102000000",
    ]);
  });

  it("reports a ledger written by a newer toolchain instead of reading it as empty", () => {
    const parsed = parseMigrationLedger(JSON.stringify({ schemaVersion: 2, modules: {} }));
    expect(parsed).toEqual({ unsupportedVersion: 2 });
  });

  it("rejects a malformed ledger", () => {
    expect(() => parseMigrationLedger("{}")).toThrow(/schemaVersion/);
    expect(() => parseMigrationLedger('{"schemaVersion":1}')).toThrow(/modules/);
    expect(() => parseMigrationLedger('{"schemaVersion":1,"modules":{"S":{}}}')).toThrow(
      /versions/,
    );
  });
});

describe("readMigrationLedger / writeMigrationLedger", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });
  const mkTmp = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "loom-ledger-"));
    tmpDirs.push(d);
    return d;
  };

  it("is null when there is none (a project that has never generated)", () => {
    expect(readMigrationLedger(mkTmp())).toBeNull();
  });

  it("writes beside the source, then reads back what it wrote", () => {
    const dir = mkTmp();
    expect(writeMigrationLedger(dir, ledger({ Sales: ["20260101000000"] })).written).toBe(true);
    expect(fs.existsSync(path.join(dir, LEDGER_REL_PATH))).toBe(true);
    expect(readMigrationLedger(dir)?.modules.Sales?.versions).toEqual(["20260101000000"]);
  });

  it("does not rewrite an unchanged ledger", () => {
    const dir = mkTmp();
    writeMigrationLedger(dir, ledger({ Sales: ["20260101000000"] }));
    expect(writeMigrationLedger(dir, ledger({ Sales: ["20260101000000"] })).written).toBe(false);
  });

  it("fails loudly on a corrupt ledger rather than reading it as 'no history'", () => {
    // Same reasoning as SnapshotReadError: silently reading a truncated file
    // as "no history" would disable the guard it exists to feed.
    const dir = mkTmp();
    fs.mkdirSync(path.dirname(migrationLedgerPath(dir)), { recursive: true });
    fs.writeFileSync(migrationLedgerPath(dir), '{"schemaVersion": 1, "modu');
    expect(() => readMigrationLedger(dir)).toThrow(MigrationLedgerReadError);
  });

  it("reports a write it could not make instead of throwing", () => {
    const dir = mkTmp();
    // `.loom` is a FILE — the directory create fails, and generation (which
    // already succeeded) must not be failed by it.
    fs.writeFileSync(path.join(dir, ".loom"), "not a directory");
    const result = writeMigrationLedger(dir, ledger({ Sales: ["20260101000000"] }));
    expect(result.written).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Guard (d) — the F-029 refusal
// ---------------------------------------------------------------------------

describe("checkMigrationBaseline — guard (d) recorded history over a tree with no baseline", () => {
  it("refuses an Initial for a module the ledger records, with an EMPTY output tree", () => {
    // The F-029 shape exactly: nothing on disk, no snapshot — the run that
    // used to look like a first run.
    const migrations = [migrationsIR({ module: "Sales", baseline: null })];
    const index = memoryMigrationArtifactIndex();
    const run = (): void =>
      checkMigrationBaseline(migrations, index, {
        recordedHistory: ledger({ Sales: ["20260101000000"] }),
        ledgerPath: "app/.loom/migration-history.json",
      });
    expect(run).toThrow(MigrationBaselineError);
    expect(run).toThrow(/refusing to re-baseline module 'Sales'/);
    // The message must name the file that made the claim and what it claims…
    expect(run).toThrow(/app\/\.loom\/migration-history\.json/);
    expect(run).toThrow(/1 migration\(s\).*up to version 20260101000000/s);
    // …and both recoveries, since the operator has to pick one.
    expect(run).toThrow(/point -o at the output tree/s);
    expect(run).toThrow(/--allow-rebaseline/s);
  });

  it("still refuses when the tree has files but no snapshot", () => {
    const migrations = [migrationsIR({ module: "Sales", baseline: null })];
    const index = memoryMigrationArtifactIndex({ Sales: ["20260101000000"] });
    expect(() =>
      checkMigrationBaseline(migrations, index, {
        recordedHistory: ledger({ Sales: ["20260101000000"] }),
      }),
    ).toThrow(MigrationBaselineError);
  });

  it("lets --allow-rebaseline through", () => {
    const migrations = [migrationsIR({ module: "Sales", baseline: null })];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledger({ Sales: ["20260101000000"] }),
        allowRebaseline: true,
      }),
    ).not.toThrow();
  });

  it("stays silent on a genuine first run — the ledger records nothing", () => {
    // `ddd new` → first `generate system` must not grow a warning, or every
    // starter flow gets noisy.
    const migrations = [migrationsIR({ module: "Sales", baseline: null })];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledger({}),
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Guard (d) compares CONTENT, not presence
// ---------------------------------------------------------------------------

describe("checkMigrationBaseline — guard (d) is content-aware", () => {
  // The two runs guard (d) sees are IDENTICAL from inside the output tree —
  // clean dir, no snapshot, no files, a fresh "Initial".  Only the schema the
  // Initial carries tells them apart, so a presence-only guard would have to
  // refuse both, and refusing the first one breaks every reproducible build
  // that does not carry its output tree (CI, a second environment, a clone).
  const unchanged = ordersSchema(["id", "total"]);
  const changed = ordersSchema(["id", "total", "phone"]);

  it("stays SILENT when the Initial reproduces the recorded one byte for byte", () => {
    // Same model, same version, same schema → the tree this run writes IS the
    // tree the ledger describes.  Nothing anywhere can be made wrong by it.
    const migrations = [migrationsIR({ module: "Sales", baseline: null, next: unchanged })];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledgerFor("Sales", ["20260101000000"], unchanged),
      }),
    ).not.toThrow();
  });

  it("REFUSES when the schema moved — the F-029 shape", () => {
    // Same version tag, different SQL under it. This is the outage.
    const migrations = [migrationsIR({ module: "Sales", baseline: null, next: changed })];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledgerFor("Sales", ["20260101000000"], unchanged),
      }),
    ).toThrow(/refusing to re-baseline module 'Sales'/);
  });

  it("REFUSES a multi-migration history even when the schema matches", () => {
    // The end state agrees, but one "Initial" cannot reproduce `Initial +
    // delta`: a database that applied only the Initial would never receive
    // the delta, and the file that would have delivered it is gone from the
    // tree.  Collapsing history is a re-baseline, not a reproduction.
    const migrations = [migrationsIR({ module: "Sales", baseline: null, next: changed })];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledgerFor("Sales", ["20260101000000", "20260101500001"], changed),
      }),
    ).toThrow(/refusing to re-baseline module 'Sales'/);
  });

  it("REFUSES when the module's version BLOCK has shifted under it", () => {
    // Schema identical, but this run would write the Initial at a different
    // version than the recorded one — it is not reproducing that tree.
    const migrations = [
      migrationsIR({ module: "Sales", baseline: null, next: unchanged, version: "20260102000000" }),
    ];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledgerFor("Sales", ["20260101000000"], unchanged),
      }),
    ).toThrow(/refusing to re-baseline module 'Sales'/);
  });

  it("REFUSES a record with no fingerprint — an unproven reproduction is not one", () => {
    const migrations = [migrationsIR({ module: "Sales", baseline: null, next: unchanged })];
    expect(() =>
      checkMigrationBaseline(migrations, memoryMigrationArtifactIndex(), {
        recordedHistory: ledger({ Sales: ["20260101000000"] }),
      }),
    ).toThrow(/refusing to re-baseline module 'Sales'/);
  });
});

describe("schemaFingerprint", () => {
  it("ignores the fields that move on every regen", () => {
    // The whole point: a fresh tree and an incremental one describe the same
    // schema with completely different `lastVersion` / `migrationHistory` /
    // `versionBlock`.  If those fed the digest it could never match.
    const base = ordersSchema(["id", "total"]);
    const stamped: SchemaSnapshot = {
      ...base,
      lastVersion: "20260101500001",
      migrationHistory: [{ version: "20260101000000", name: "Initial" }],
      versionBlock: 3,
      appliedDataMigrations: ["0#0"],
    };
    expect(schemaFingerprint(stamped)).toBe(schemaFingerprint(base));
  });

  it("ignores table ORDER but not table content", () => {
    const a = ordersSchema(["id", "total"]);
    const b = ordersSchema(["id", "total"]);
    const two = { ...a, tables: [...a.tables, { ...b.tables[0]!, name: "lines" }] };
    const twoReversed = { ...two, tables: [...two.tables].reverse() };
    expect(schemaFingerprint(twoReversed)).toBe(schemaFingerprint(two));
    expect(schemaFingerprint(ordersSchema(["id", "total", "phone"]))).not.toBe(
      schemaFingerprint(a),
    );
  });
});

// ---------------------------------------------------------------------------
// A brand-new module is not a lost baseline
// ---------------------------------------------------------------------------

describe("checkMigrationBaseline — a module with no recorded history is NEW, not lost", () => {
  it("allows a new module's Initial even though the deployable dir holds files", () => {
    // `fsMigrationArtifactIndex` can only ask "any migration file under this
    // deployable's directory?", and one deployable serves many modules — so
    // adding a subdomain to an existing tree used to be refused for ANOTHER
    // module's files, prescribing `--allow-rebaseline`, which would have
    // discarded that other module's history.  The ledger answers per module.
    const migrations = [
      migrationsIR({ module: "Sales", baseline: snapshotWithHistory(["20260101000000"]) }),
      migrationsIR({ module: "Billing", baseline: null, version: "20260102000000" }),
    ];
    const index = memoryMigrationArtifactIndex({
      Sales: ["20260101000000"],
      Billing: ["20260101000000"], // the SAME file, seen through the shared dir
    });
    expect(() =>
      checkMigrationBaseline(migrations, index, {
        recordedHistory: ledger({ Sales: ["20260101000000"] }),
      }),
    ).not.toThrow();
  });

  it("allows it without a ledger too — the version BLOCK is the discriminator", () => {
    // Pre-ledger projects (nothing recorded yet) are still answered exactly,
    // because migration versions are allocated in disjoint per-module blocks
    // and a brand-new module is allocated a block ABOVE every block in use.
    // Nothing on disk can fall inside it, whatever the shared directory holds.
    const migrations = [
      migrationsIR({ module: "Sales", baseline: snapshotWithHistory(["20260101000000"]) }),
      migrationsIR({ module: "Billing", baseline: null, version: "20260102000000" }),
    ];
    const index = memoryMigrationArtifactIndex({
      Sales: ["20260101000000"],
      Billing: ["20260101000000"], // the same shared directory, seen per module
    });
    expect(() => checkMigrationBaseline(migrations, index)).not.toThrow();
  });

  it("refuses a module whose snapshot ALONE was lost, sibling baseline or not", () => {
    // The case a "does any sibling still have a baseline?" discriminator gets
    // WRONG: Billing is not new — its files sit in its own block — and only
    // its snapshot went missing.  Re-baselining it would re-issue an applied
    // version, which is the whole defect.  The block narrowing sees it.
    const migrations = [
      migrationsIR({ module: "Sales", baseline: snapshotWithHistory(["20260101000000"]) }),
      migrationsIR({ module: "Billing", baseline: null, version: "20260102000000" }),
    ];
    const index = memoryMigrationArtifactIndex({
      Sales: ["20260101000000"],
      Billing: ["20260101000000", "20260102000000"],
    });
    expect(() => checkMigrationBaseline(migrations, index)).toThrow(/module 'Billing'/);
  });

  it("but still refuses when EVERY baseline is gone (the lost-snapshots case)", () => {
    const migrations = [
      migrationsIR({ module: "Sales", baseline: null }),
      migrationsIR({ module: "Billing", baseline: null, version: "20260102000000" }),
    ];
    const index = memoryMigrationArtifactIndex({
      Sales: ["20260101000000"],
      Billing: ["20260102000000"],
    });
    expect(() => checkMigrationBaseline(migrations, index)).toThrow(MigrationBaselineError);
  });
});

// ---------------------------------------------------------------------------
// Guard (e) — a tree behind the model's real history
// ---------------------------------------------------------------------------

describe("checkMigrationBaseline — guard (e) a version the ledger already spent", () => {
  it("refuses to re-issue a recorded version into a tree that lacks it", () => {
    // An older COPY of the output tree: its snapshot and its files agree
    // perfectly with each other, so (b) and (c) both pass — and the delta it
    // computes carries a version the real tree already used.
    const migrations = [
      migrationsIR({
        module: "Sales",
        baseline: snapshotWithHistory(["20260101000000"]),
        steps: [{ op: "sqlComment", comment: "x" }],
        version: "20260101500001",
      }),
    ];
    const index = memoryMigrationArtifactIndex({ Sales: ["20260101000000"] });
    const run = (): void =>
      checkMigrationBaseline(migrations, index, {
        recordedHistory: ledger({ Sales: ["20260101000000", "20260101500001"] }),
      });
    expect(run).toThrow(/version '20260101500001'.*already recorded/s);
    expect(() =>
      checkMigrationBaseline(migrations, index, {
        recordedHistory: ledger({ Sales: ["20260101000000", "20260101500001"] }),
        allowRebaseline: true,
      }),
    ).not.toThrow();
  });

  it("does not flag a no-op regen of an up-to-date tree", () => {
    const migrations = [
      migrationsIR({
        module: "Sales",
        baseline: snapshotWithHistory(["20260101000000"]),
        steps: [],
        version: "20260101000000",
      }),
    ];
    const index = memoryMigrationArtifactIndex({ Sales: ["20260101000000"] });
    expect(() =>
      checkMigrationBaseline(migrations, index, {
        recordedHistory: ledger({ Sales: ["20260101000000"] }),
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// End to end through `generate system` — the defect, and what closes it
// ---------------------------------------------------------------------------

describe("generate system into a CLEAN output directory (F-029)", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });
  const mkTmp = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "loom-f029-"));
    tmpDirs.push(d);
    return d;
  };
  const writeFiles = (outDir: string, files: Map<string, string>): void => {
    for (const [rel, content] of files) {
      const full = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  };
  const initialSql = (files: Map<string, string>): [string, string] => {
    const entry = [...files].find(([p]) => /db\/migrations\/\d+_sales_initial\.sql$/.test(p));
    if (!entry) throw new Error("no initial migration emitted");
    return entry;
  };

  it("refuses, and would otherwise rewrite the applied migration under its own tag", async () => {
    const v1 = (await buildLoomModel(shopSource())) as EnrichedLoomModel;
    const v2 = (await buildLoomModel(shopSource("note: string?"))) as EnrichedLoomModel;

    // Run 1 — a real first generate into dirA.
    const dirA = mkTmp();
    const first = generateSystemsFromLoom(v1, {
      snapshots: fsSnapshotStore(dirA),
      existingMigrations: fsMigrationArtifactIndex(dirA, v1),
    });
    writeFiles(dirA, first.files);
    const recordedHistory = first.migrationLedger;
    expect(recordedHistory?.modules.Sales?.versions).toHaveLength(1);
    const [initialPath, initialBefore] = initialSql(first.files);

    // Run 2 — the SAME model plus one nullable field, into a clean dirB.
    // WITHOUT the ledger this is what the tool did: a fresh "Initial" under
    // the very same tag, carrying a column the applied migration never had.
    // Nothing in dirB could tell anyone; this is the characterization of the
    // defect, and the reason the evidence has to come from the source side.
    const dirB = mkTmp();
    const blind = generateSystemsFromLoom(v2, {
      snapshots: fsSnapshotStore(dirB),
      existingMigrations: fsMigrationArtifactIndex(dirB, v2),
    });
    const [blindPath, blindAfter] = initialSql(blind.files);
    expect(blindPath).toBe(initialPath); // same tag …
    expect(blindAfter).not.toBe(initialBefore); // … different content
    expect(blindAfter).toContain('"note"');

    // With the recorded history, the same run refuses.
    expect(() =>
      generateSystemsFromLoom(v2, {
        snapshots: fsSnapshotStore(dirB),
        existingMigrations: fsMigrationArtifactIndex(dirB, v2),
        recordedHistory,
      }),
    ).toThrow(MigrationBaselineError);
  });

  it("still emits the correct incremental delta in place", async () => {
    const v1 = (await buildLoomModel(shopSource())) as EnrichedLoomModel;
    const v2 = (await buildLoomModel(shopSource("note: string?"))) as EnrichedLoomModel;
    const dir = mkTmp();
    const first = generateSystemsFromLoom(v1, {
      snapshots: fsSnapshotStore(dir),
      existingMigrations: fsMigrationArtifactIndex(dir, v1),
    });
    writeFiles(dir, first.files);

    const second = generateSystemsFromLoom(v2, {
      snapshots: fsSnapshotStore(dir),
      existingMigrations: fsMigrationArtifactIndex(dir, v2),
      recordedHistory: first.migrationLedger,
    });
    const delta = [...second.files].filter(([p]) =>
      /db\/migrations\/\d+_sales_(?!initial)/.test(p),
    );
    expect(delta).toHaveLength(1);
    expect(delta[0]![1]).toMatch(/ALTER TABLE .* ADD COLUMN "note"/);
    // The initial is untouched (not re-emitted at all) and the ledger grows.
    expect([...second.files].some(([p]) => /_sales_initial\.sql$/.test(p))).toBe(false);
    expect(second.migrationLedger?.modules.Sales?.versions).toHaveLength(2);
  });

  it("a genuine first run is silent and records the history it just created", async () => {
    const v1 = (await buildLoomModel(shopSource())) as EnrichedLoomModel;
    const dir = mkTmp();
    const emission = generateSystemsFromLoom(v1, {
      snapshots: fsSnapshotStore(dir),
      existingMigrations: fsMigrationArtifactIndex(dir, v1),
      recordedHistory: null,
    });
    expect(emission.migrationLedger?.modules.Sales?.versions).toHaveLength(1);
  });
});
