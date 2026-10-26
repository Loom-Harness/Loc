// Claims-eval D1 (python half): a field typed by an enum declared in a SIBLING
// context (`Clm.kind: Kind`, `Kind` declared in context `A`) is a legal, linked
// reference.  Python resolved such names against the context's OWN
// `ctx.enums`, so every import-candidate list missed `Kind`: the domain module,
// the repository and the routes named it without importing it (mypy
// name-defined, ImportError at boot), and the unit test's bare `Fire` became a
// NameError that a bare `toThrow()` then swallowed as a "passing" negative test.
//
// Every python import-candidate list (domain, repository, port, routes,
// workflows, dispatch, projections, handlers, seed, tests, wire models) now
// reads `enumPool(ctx)`, and the event-sourced saga's typed zero does too (it
// zeroed a sibling-enum state field to `cast(Kind, "")` when the sibling context
// is hosted by another deployable).  The invariant pinned here: the sibling
// placement emits what the own-context
// placement emits.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (deployables: string): string => `
system R {
  subdomain S {
    context A {
      enum Kind { Fire, Theft }
      aggregate Pol with crudish { name: string derived display: string = name }
      repository Pols for Pol { }
    }
    context B {
      aggregate Clm with crudish {
        kind: Kind
        title: string
        derived display: string = title
        invariant title.length > 2
        test "neg" { expect(Clm.create(kind: Fire, title: "x")).toThrow() }
        test "pos" { let c = Clm.create(kind: Fire, title: "abc")  expect(c.kind).toBe(Fire) }
      }
      repository Clms for Clm { find byKind(k: Kind): Clm? where this.kind == k }
      event Opened { clm: Clm id, kind: Kind }
      channel L { carries: Opened  delivery: broadcast  retention: ephemeral }
      workflow Track eventSourced {
        clm: Clm id
        kind: Kind
        n: int
        create(e: Opened) by e.clm { emit Opened { clm: e.clm, kind: e.kind } }
        apply(e: Opened) { n := n + 1 }
      }
    }
  }
  storage primary { type: postgres }
  resource a { for: A, kind: state, use: primary }
  resource b { for: B, kind: state, use: primary }
  ${deployables}
}
`;

// Both contexts on one deployable: python merges the hosted contexts, so the
// sibling enum is declared in this service's `app/domain/value_objects.py`.
const SRC = src(
  "deployable api { platform: python, contexts: [A, B], dataSources: [a, b], port: 3000 }",
);
// The sibling context on ANOTHER deployable: the merged context carries `Kind`
// only through `siblingEnums`, so a `ctx.enums` lookup misses it.
const SRC_SPLIT = src(
  `deployable api { platform: python, contexts: [B], dataSources: [b], port: 3000 }
  deployable api2 { platform: python, contexts: [A], dataSources: [a], port: 3002 }`,
);

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

const IMPORT_KIND = /^from app\.domain\.value_objects import (?:[^\n]*\b)?Kind\b/m;

describe("a sibling-context enum resolves on python (claims D1)", () => {
  it("the domain module, repository, port and routes import the sibling enum", async () => {
    const files = await generateSystemFiles(SRC);
    for (const suffix of [
      "app/domain/clm.py",
      "app/db/repositories/clm_repository.py",
      "app/domain/repository_ports.py",
      "app/http/clm_routes.py",
    ]) {
      const text = bySuffix(files, suffix);
      expect(text, `${suffix} names Kind`).toMatch(/\bKind\b/);
      expect(text, `${suffix} names Kind without importing it`).toMatch(IMPORT_KIND);
    }
  });

  it("the unit test imports the enum and qualifies the bare sibling value", async () => {
    const files = await generateSystemFiles(SRC);
    const test = bySuffix(files, "tests/test_clm.py");
    expect(test).toMatch(IMPORT_KIND);
    expect(test).toContain("Clm.create(kind=Kind.Fire, title=");
    expect(test).not.toMatch(/kind=Fire\b/);
  });

  it("the event-sourced saga zeroes a sibling-enum state field to its first member", async () => {
    const files = await generateSystemFiles(SRC_SPLIT);
    const dispatch = bySuffix(files, "api/app/dispatch.py");
    expect(dispatch).toContain("state = TrackState(clm=ClmId(key), kind=Kind.Fire, n=0)");
    expect(dispatch).not.toContain('cast(Kind, "")');
    expect(dispatch).toMatch(IMPORT_KIND);
  });
});
