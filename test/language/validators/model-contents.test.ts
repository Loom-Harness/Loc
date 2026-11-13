// The validator's per-run contents cache (`src/language/validators/model-contents.ts`).
//
// `modelContents(root)` replays one flattened walk per document for every
// model-level check in a validation run.  These tests pin the two properties
// that make that a pure speed-up: it yields exactly what a fresh
// `AstUtils.streamAllContents` walk yields (same nodes, same order), and the
// cache never outlives the run that built it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AstNode, AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import {
  modelContents,
  withModelContentsCache,
} from "../../../src/language/validators/model-contents.js";
import { parseString } from "../../_helpers/index.js";

const SOURCE = `
system S {
  context Sales {
    aggregate Order {
      total: int
      note: string?
      operation bump(by: int) { total := total + by }
    }
    aggregate Customer { name: string }
  }
}
`;

const ids = (s: Iterable<AstNode>): AstNode[] => [...s];

describe("modelContents", () => {
  it("yields the same nodes in the same order as a fresh walk, inside and outside a run", async () => {
    const { model } = await parseString(SOURCE, { validate: false });
    const fresh = ids(AstUtils.streamAllContents(model));
    expect(fresh.length).toBeGreaterThan(10);

    expect(ids(modelContents(model))).toEqual(fresh);
    withModelContentsCache(() => {
      expect(ids(modelContents(model))).toEqual(fresh);
      // a second read in the same run is served from the cache, unchanged
      expect(ids(modelContents(model))).toEqual(fresh);
    });
  });

  it("walks a non-root node fresh, even inside a run", async () => {
    const { model } = await parseString(SOURCE, { validate: false });
    const order = ids(AstUtils.streamAllContents(model)).find((n) => n.$type === "Aggregate");
    expect(order).toBeDefined();
    withModelContentsCache(() => {
      modelContents(model); // populate the root's cache entry
      expect(ids(modelContents(order as AstNode))).toEqual(
        ids(AstUtils.streamAllContents(order as AstNode)),
      );
    });
  });

  it("does not carry a cached walk into the next run", async () => {
    const { model } = await parseString(SOURCE, { validate: false });
    const before = withModelContentsCache(() => ids(modelContents(model)).length);
    // Change the tree between runs — a stale cache would still report `before`.
    const removed = model.members.pop();
    expect(removed).toBeDefined();
    const after = withModelContentsCache(() => ids(modelContents(model)).length);
    expect(after).toBe(ids(AstUtils.streamAllContents(model)).length);
    expect(after).toBeLessThan(before);
  });

  it("reuses the enclosing run's cache when nested", async () => {
    const { model } = await parseString(SOURCE, { validate: false });
    const fresh = ids(AstUtils.streamAllContents(model));
    withModelContentsCache(() => {
      const outer = ids(modelContents(model));
      withModelContentsCache(() => expect(ids(modelContents(model))).toEqual(outer));
      // the inner run must not have cleared the outer one's cache
      expect(ids(modelContents(model))).toEqual(fresh);
    });
  });
});

// Source hygiene (absence): a whole-document walk inside a validator must go
// through `modelContents`, or the check re-walks the tree on every run and the
// shared walk silently erodes back to N walks.  No compile or booted tier can
// observe this — it is a performance property of the validator source.
describe("validators share one whole-document walk", () => {
  it("no validator walks a document root with AstUtils.streamAllContents directly", () => {
    const dir = join(process.cwd(), "src/language/validators");
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".ts") && f !== "model-contents.ts")
        .map((f) => join(dir, f)),
      join(process.cwd(), "src/language/ddd-validator.ts"),
    ];
    const rootWalk = /AstUtils\.streamAllContents\(\s*(model|root|AstUtils\.findRootNode\()/;
    const offenders = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ f, line: i + 1, text: line }))
        .filter(({ text }) => rootWalk.test(text))
        .map(({ f, line }) => `${f.replace(`${process.cwd()}/`, "")}:${line}`),
    );
    expect(offenders, "use modelContents(model) from validators/model-contents.ts").toEqual([]);
  });
});
