// `loom.callable-modifier-not-allowed-here` — the M-T5.21 callable legality
// gate.
//
// The grammar's three callable fragments (`CallableLeadModifiers` /
// `CallableSigModifiers` / `CallableGates`) accept the WHOLE modifier + clause
// surface at every callable site; `CALLABLE_SITES`
// (`src/language/callable-sites.ts`) declares what each site actually carries,
// and one validator reports the rest with the reason.
//
// THE TWO HALVES THAT BOTH HAVE TO HOLD, and why each leg exists:
//
//  1. THE WIDENING IS REAL.  Before this mission, `operation … audited` inside
//     a `domainService` was `loom.parse-error` — the author saw "expecting
//     token of type '{' but found `audited`" and had to read the grammar to
//     learn why.  A test that only asserted "an error is reported" would have
//     PASSED on the old code, because there was an error: the wrong one.  So
//     every negative leg asserts the parse SUCCEEDS (no `loom.parse-error`) and
//     the reported code is the explained one.
//
//  2. NOTHING WIDENED BY ACCIDENT.  Phase 1 adds no capability: a modifier a
//     site already carried must still validate clean, and one it did not must
//     still be refused.  The positive legs are what stop the table being
//     "relaxed" into a silent codegen gap on eleven targets.
//
// The table is exercised through its reason slugs (one catalog arm each), not
// through every (site × modifier) cell: the cells are data, the arms are code.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { CALLABLE_FEATURES, CALLABLE_SITES } from "../../../src/language/callable-sites.js";
import { printStructural } from "../../../src/language/print/print-structural.js";
import { parseString } from "../../_helpers/parse.js";

const CODE = "loom.callable-modifier-not-allowed-here";

const sys = (body: string) => `
system Demo {
  subdomain S {
    context C {
${body}
    }
  }
}`;

/** Phase-① parser errors live on `parseResult`, NOT in `doc.diagnostics` —
 *  the validation channel this suite otherwise reads.  Asserting "no
 *  `loom.parse-error` code" over the diagnostics would therefore pass on a
 *  source that never parsed at all (measured: the mutation that narrows the
 *  grammar back yields an EMPTY diagnostics array), which is exactly the
 *  vacuous-check shape `experience_gathered.md` §59/§63 records.  So the legs
 *  read the parser's own errors. */
async function report(
  body: string,
): Promise<{ codes: string[]; messages: string[]; parseErrors: string[] }> {
  const { diagnostics, doc } = await parseString(sys(body), { validate: true });
  return {
    codes: diagnostics.map((d) => d.code).filter((c): c is string => c !== undefined),
    messages: diagnostics.map((d) => d.message ?? ""),
    parseErrors: doc.parseResult.parserErrors.map((e) => e.message),
  };
}

/** The shape every negative leg asserts: the source PARSES (the widening is
 *  real) and the one complaint is the explained one. */
async function expectExplained(body: string, needle: string): Promise<void> {
  const { codes, messages, parseErrors } = await report(body);
  expect(
    parseErrors,
    "the widened spelling must PARSE — a parser error means the grammar never opened, " +
      "which is the state this mission replaced",
  ).toEqual([]);
  expect(codes).toContain(CODE);
  expect(messages.join("\n")).toContain(needle);
}

describe("loom.callable-modifier-not-allowed-here — the declared legality table", () => {
  it("explains `audited` on a domain-service operation (was an unexplained parse error)", async () => {
    await expectExplained(
      `      domainService Pricing {
        operation quote(base: int) audited : int { return base }
      }
      aggregate Thing { name: string }
      repository Things for Thing { }`,
      "A domain service is a stateless, context-internal calculator",
    );
  });

  it("explains a gate on a lifecycle `create`", async () => {
    await expectExplained(
      `      aggregate Thing {
        name: string
        create mk(name: string) requires true { name := name }
      }
      repository Things for Thing { }`,
      "A lifecycle action has no LOADED instance to gate",
    );
  });

  it("explains `audited` on an applier", async () => {
    await expectExplained(
      `      event Bumped { name: string }
      aggregate Thing persistedAs: eventLog {
        name: string
        operation bump() { emit Bumped { name: name } }
        apply(e: Bumped) audited { name := e.name }
      }
      repository Things for Thing { }`,
      "An applier is a PURE FOLD replayed from the event log",
    );
  });

  it("explains `private` on a `function`", async () => {
    await expectExplained(
      `      aggregate Thing {
        name: string
        private function twice(x: int): int = x + x
      }
      repository Things for Thing { }`,
      "A 'function' is a pure helper over its parameters",
    );
  });

  it("explains `audited` on a command handler", async () => {
    await expectExplained(
      `      aggregate Thing { name: string }
      repository Things for Thing { }
      command Rename { name: string }
      commandHandler rename(cmd: Rename) audited { }`,
      "A handler is dispatched by the API layer",
    );
  });

  it("explains `when` on a workflow handle", async () => {
    await expectExplained(
      `      aggregate Thing { name: string }
      repository Things for Thing { }
      workflow flow {
        create(name: string) { }
        handle touch(name: string) when true { }
      }`,
      "A workflow member is orchestration, not an aggregate method",
    );
  });

  it("explains `requires` on a page action", async () => {
    const { diagnostics, doc } = await parseString(
      `
system Demo {
  subdomain S { context C {
    aggregate Thing with crudish { name: string }
  } }
  ui Web {
    page Home {
      route: "/"
      action go() requires true { }
      body: Stack { }
    }
  }
}`,
      { validate: true },
    );
    const codes = diagnostics.map((d) => d.code).filter((c): c is string => c !== undefined);
    expect(doc.parseResult.parserErrors.map((e) => e.message)).toEqual([]);
    expect(codes).toContain(CODE);
    expect(diagnostics.map((d) => d.message ?? "").join("\n")).toContain("runs in the browser");
  });

  // --- the "nothing widened by accident" half ------------------------------

  it("leaves every modifier a site already carried alone", async () => {
    const { codes } = await report(
      `      event Bumped { name: string }
      aggregate Thing persistedAs: eventLog {
        name: string
        private operation rename(n: string) audited requires true when true { emit Bumped { name: n } }
        create mk(name: string) audited { name := name }
        destroy audited { }
        apply(e: Bumped) { name := e.name }
        function twice(x: int): int = x + x
      }
      repository Things for Thing { }
      workflow flow {
        create(name: string) requires true { }
        handle touch(name: string) requires true { }
      }`,
    );
    expect(codes.filter((c) => c === CODE)).toEqual([]);
  });

  it("keeps the legacy prefix `extern` spelling on a handler legal", async () => {
    const { codes } = await report(
      `      aggregate Thing { name: string }
      repository Things for Thing { }
      command Rename { name: string }
      extern commandHandler rename(cmd: Rename) ;`,
    );
    expect(codes.filter((c) => c === CODE)).toEqual([]);
  });
});

describe("the printer re-emits the whole callable header", () => {
  it("does not silently drop a refused modifier on unfold", async () => {
    // `src/language/lsp/unfold-macro.ts` promises the printed expansion
    // "re-parses to a working program".  A printer that dropped one of the
    // widened slots would turn source `CALLABLE_SITES` REFUSES into source it
    // accepts — the error would vanish on unfold rather than travel with the
    // code.  This is the cheap end of that contract: what goes in comes out.
    const { doc } = await parseString(
      sys(`      aggregate Thing {
        name: string
        private function twice(x: int) extern : int = x + x
      }
      repository Things for Thing { }`),
      { validate: false },
    );
    const printed = [...AstUtils.streamAllContents(doc.parseResult.value)]
      .filter((n) => n.$type === "FunctionDecl")
      .map(printStructural);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("private function twice");
    expect(printed[0]).toContain("extern");
  });
});

describe("CALLABLE_SITES is a table, not a list of special cases", () => {
  it("names only features the fragments can parse", () => {
    const known = new Set<string>(CALLABLE_FEATURES);
    for (const [type, site] of Object.entries(CALLABLE_SITES)) {
      for (const f of [...site.modifiers, ...site.clauses]) {
        expect(known.has(f), `${type} allows unknown feature '${f}'`).toBe(true);
      }
    }
  });

  it("gives every site a reason, so nothing can be refused without one", () => {
    for (const [type, site] of Object.entries(CALLABLE_SITES)) {
      expect(site.why, `${type} has no deny reason`).toBeTruthy();
      expect(site.label.length, `${type} has no label`).toBeGreaterThan(0);
    }
  });
});
