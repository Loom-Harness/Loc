// The write-path concurrency fact (`src/ir/enrich/version-check.ts`): for every
// write path, whether its save is checked against a version and which one.
// These pin the fact itself — independent of any backend that renders it.

import { describe, expect, it } from "vitest";
import {
  aggregateCanConflict,
  anyRouteReadsIfMatch,
  bodySaveChecks,
  createVersionCheck,
  destroyVersionCheck,
  operationVersionCheck,
  rowVersionGuarded,
  writePathsFor,
} from "../../src/ir/enrich/version-check.js";
import type { AggregateIR, EnrichedAggregateIR } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/index.js";

const SRC = `
system V {
  subdomain D {
    context C {
      event Opened { account: Account id, owner: string }
      event Renamed { account: Account id, owner: string }
      aggregate Doc with crudish {
        title: string
        operation rename(t: string) { title := t }
        operation retitle(t: string): string { title := t  return title }
      }
      aggregate Memo shape: document with crudish {
        body: string
        operation rewrite(b: string) { body := b }
      }
      aggregate Account persistedAs: eventLog {
        owner: string
        create open(owner: string) { emit Opened { account: id, owner: owner } }
        operation rename(owner: string) { emit Renamed { account: id, owner: owner } }
        apply(e: Opened) { owner := e.owner }
        apply(e: Renamed) { owner := e.owner }
      }
      repository Docs for Doc { }
      repository Memos for Memo { }
      repository Accounts for Account { }

      workflow touch {
        create(doc: Doc id, t: string) {
          let d = Docs.getById(doc)
          d.rename(t)
          let fresh = Doc.create({ title: t })
        }
      }
      workflow relabel {
        create(acct: Account id, owner: string) {
          let a = Accounts.getById(acct)
          a.rename(owner)
        }
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  resource log { for: C, kind: eventLog, use: pg }
  deployable d { platform: node, contexts: [C], dataSources: [st, log], port: 4000 }
}
`;

async function context() {
  const ctx = enrichedContexts(await buildLoomModel(SRC))[0]!;
  const agg = (n: string): EnrichedAggregateIR => ctx.aggregates.find((a) => a.name === n)!;
  const pool = new Map<string, AggregateIR>(ctx.aggregates.map((a) => [a.name, a]));
  return { ctx, agg, pool };
}

const op = (a: AggregateIR, n: string) => a.operations.find((o) => o.name === n)!;

describe("checksVersion — route write paths", () => {
  it("every named operation of a versioned row reads If-Match, void or returning, not only `update`", async () => {
    const { agg } = await context();
    const doc = agg("Doc");
    for (const name of ["update", "rename", "retitle"]) {
      expect(operationVersionCheck(doc, op(doc, name))).toEqual({
        checksVersion: "if-match",
        guard: "row-version",
        store: "relational",
      });
    }
  });

  it("a `shape: document` row has the same contract, on its document store", async () => {
    const { agg } = await context();
    const memo = agg("Memo");
    expect(operationVersionCheck(memo, op(memo, "rewrite"))).toEqual({
      checksVersion: "if-match",
      guard: "row-version",
      store: "document",
    });
    expect(rowVersionGuarded(memo)).toBe(true);
  });

  it("an event-sourced operation is checked against the handle's stream version, not the header", async () => {
    const { agg } = await context();
    const acct = agg("Account");
    expect(operationVersionCheck(acct, op(acct, "rename"))).toEqual({
      checksVersion: "handle",
      guard: "stream-version",
      store: "eventLog",
    });
    expect(rowVersionGuarded(acct)).toBe(false);
    expect(aggregateCanConflict(acct)).toBe(true);
  });

  it("a create is an unchecked insert, and a destroy is unchecked on every backend", async () => {
    const { agg } = await context();
    for (const n of ["Doc", "Memo", "Account"]) {
      expect(createVersionCheck(agg(n))).toMatchObject({ checksVersion: "none", reason: "insert" });
      expect(destroyVersionCheck(agg(n))).toMatchObject({
        checksVersion: "none",
        reason: "destroy",
      });
    }
  });

  it("a versioned row's destroy carries the ruled If-Match contract as pending; a stream's does not", async () => {
    const { agg } = await context();
    for (const n of ["Doc", "Memo"]) {
      expect(destroyVersionCheck(agg(n))).toMatchObject({
        checksVersion: "none",
        pending: { checksVersion: "if-match", guard: "row-version", issue: "#4341" },
      });
    }
    expect(destroyVersionCheck(agg("Account"))).not.toHaveProperty("pending");
  });

  it("enumerates every route write path with its contract", async () => {
    const { agg } = await context();
    const paths = writePathsFor(agg("Doc")).map(
      (p) => `${p.path.kind}:${p.path.op.name}=${p.check.checksVersion}`,
    );
    expect(paths).toEqual([
      "create:create=none",
      "operation:rename=if-match",
      "operation:retitle=if-match",
      "operation:update=if-match",
      "destroy:destroy=none",
    ]);
  });

  it("the project needs the entity-tag parser iff some route reads If-Match", async () => {
    const { agg } = await context();
    expect(anyRouteReadsIfMatch([agg("Account")])).toBe(false);
    expect(anyRouteReadsIfMatch([agg("Account"), agg("Memo")])).toBe(true);
  });
});

describe("checksVersion — workflow / handler saves (from the body's effects)", () => {
  it("a loaded row is checked against its handle; a row the body created is an unchecked insert", async () => {
    const { ctx, pool } = await context();
    const body = ctx.workflows.find((w) => w.name === "touch")!.creates[0]!;
    expect(bodySaveChecks(body, pool).map((s) => [s.persist.name, s.check.checksVersion])).toEqual([
      ["d", "handle"],
      ["fresh", "none"],
    ]);
  });

  it("a loaded stream is checked against the stream version it was folded to", async () => {
    const { ctx, pool } = await context();
    const body = ctx.workflows.find((w) => w.name === "relabel")!.creates[0]!;
    expect(bodySaveChecks(body, pool).map((s) => s.check)).toEqual([
      { checksVersion: "handle", guard: "stream-version", store: "eventLog" },
    ]);
  });
});
