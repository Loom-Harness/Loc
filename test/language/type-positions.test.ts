// The type-position table is the one place a form × position pair is decided
// (`src/language/type-positions.ts`).  This witness writes every form into
// every position it can be written in and checks the compiler raises exactly
// what the table says: the cell's code where the table refuses the pair, and
// not the form's code where it admits it.  A check that decides a pair on its
// own — or a scope that hides a name the table means to refuse honestly —
// fails here.

import { describe, expect, it } from "vitest";
import {
  positionRule,
  TYPE_FORMS,
  TYPE_POSITIONS,
  type TypeForm,
  type TypePosition,
} from "../../src/language/type-positions.js";
import { parseString } from "../_helpers/parse.js";

/** The source text of each form. */
const FORM_TEXT: Record<TypeForm, string> = {
  "inline-union": "Ok or Bad",
  "named-union": "Outcome",
  "transport-record": "Ok",
  carrier: "int paged",
  slot: "slot",
  action: "action",
};

/** The code each form's refusals raise. */
const FORM_CODE: Record<TypeForm, string> = {
  "inline-union": "loom.union-position",
  "named-union": "loom.union-position",
  "transport-record": "loom.transport-type-position",
  carrier: "loom.generic-position",
  slot: "loom.slot-out-of-position",
  action: "loom.action-out-of-position",
};

interface Site {
  /** The position sits outside every context, where a context's records are
   *  not in scope: an event or payload name there does not resolve at all. */
  outsideContext?: true;
  user?: string;
  ctx?: string;
  agg?: string;
  sys?: string;
}

/** One declaration per position, with `%T` where the type goes. */
const SITES: Record<Exclude<TypePosition, "other">, Site> = {
  "aggregate-field": { agg: "f: %T" },
  "part-field": { agg: "contains ls: L[]\n entity L { q: int  f: %T }" },
  "valueobject-field": { ctx: "valueobject V { f: %T }" },
  "payload-field": { ctx: "payload P { f: %T }" },
  "event-field": { ctx: "event E { f: %T }" },
  "user-field": { outsideContext: true, user: "user { id: guid  f: %T }" },
  "operation-param": { agg: "operation go(f: %T) { n := 1 }" },
  "operation-return": { agg: "operation go(): %T { return Ok { n: 1 } }" },
  "domain-service-param": { ctx: "domainService D { operation go(f: %T): int { return 1 } }" },
  "domain-service-return": { ctx: "domainService D { operation go(): %T { return Ok { n: 1 } } }" },
  "function-param": { agg: "function fx(f: %T): int = 1" },
  "function-return": { agg: "function fy(): %T = n" },
  "create-param": { ctx: "workflow W { create(c: %T) { let x = X.create(n: 1) } }" },
  "create-return": { ctx: "workflow W { create(k: int): %T { return Ok { n: k } } }" },
  "command-handler-param": { ctx: "commandHandler H(c: %T): int { return 1 }" },
  "command-handler-return": { ctx: "commandHandler H(c: Go): %T { return Ok { n: c.n } }" },
  "query-handler-param": { ctx: "queryHandler H(c: %T): int { return 1 }" },
  "query-handler-return": { ctx: "queryHandler H(c: int): %T { return Ok { n: c } }" },
  "component-param": {
    outsideContext: true,
    sys: 'ui W { component Cp(f: %T) { body: Text { "x" } } page Home { route: "/" body: Text { "x" } } }',
  },
  "page-param": {
    outsideContext: true,
    sys: 'ui W { page Home(f: %T) { route: "/:f" body: Text { "x" } } }',
  },
  // The atom after `or`: a variant of an operation's return union.
  "union-variant": { agg: "operation go(): Bad or %T { return Ok { n: 1 } }" },
};

function source(site: Site, type: string): string {
  const put = (s: string | undefined) => (s ?? "").replaceAll("%T", type);
  return `system U {
  ${put(site.user)}
  subdomain S { context C {
    response Ok { n: int }
    error Bad { resource: string }
    command Go { n: int }
    payload Outcome = Ok | Bad
    ${put(site.ctx)}
    aggregate X with crudish { n: int
      ${put(site.agg)}
    }
    repository Xs for X { }
  } }
  ${put(site.sys)}
}`;
}

async function codesOf(src: string): Promise<string[]> {
  const { diagnostics } = await parseString(src, { validate: true });
  return (diagnostics ?? []).map((d) =>
    String(d.code ?? (d.data as { code?: string } | undefined)?.code ?? ""),
  );
}

describe("type-position table", () => {
  it("names every position it classifies", () => {
    expect(TYPE_POSITIONS.map((p) => p.position).sort()).toEqual(
      [...Object.keys(SITES), "other"].sort(),
    );
  });

  for (const form of TYPE_FORMS) {
    describe(form, () => {
      for (const [position, site] of Object.entries(SITES) as [TypePosition, Site][]) {
        const rule = positionRule(form, position);
        if (rule.verdict === "unwritable") continue;
        it(`${position}: ${rule.verdict === "refused" ? rule.code : rule.verdict}`, async () => {
          const codes = await codesOf(source(site, FORM_TEXT[form]));
          const unresolved =
            site.outsideContext && (form === "named-union" || form === "transport-record");
          if (rule.verdict === "refused") {
            expect(codes).toContain(unresolved ? "linking-error" : rule.code);
          } else expect(codes).not.toContain(FORM_CODE[form]);
        });
      }
    });
  }
});
