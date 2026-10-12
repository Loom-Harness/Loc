// The TYPING ENVIRONMENT inside a `domainService` operation body
// (testability audit F1, language half — the twin of the IR half in #2968).
//
// `DomainServiceOperation` is its own grammar rule (`stmts+=Statement*`), NOT an
// `Operation` (`body+=Statement*`).  `envForNode` had arms for Operation,
// FunctionDecl, FindDecl, Create, HandleDecl, Page, Component, Criterion,
// Retrieval and PolicyDecl — and none for it, so inside a service body NO
// parameter was bound and NO `let` was typed.  Every receiver came back
// `unknown`, and because each type-based validator suppresses on `unknown`
// (the deliberate anti-double-reporting rule), EVERY type gate failed open
// there: `loom.unknown-member`, the bare-collection-accessor check, the
// nullable-deref checks, the binary-operand checks and the arg-type checks
// all silently skipped `domainService` bodies.
//
// WHY THIS PINS THE ENVIRONMENT AND NOT A RENDERED STRING.  Same reasoning as
// `test/ir/domain-service-repo-read-binding.test.ts` on the IR side: the
// reported symptom was `f.totallyInvented > 0` emitted verbatim into every
// backend, but asserting on emitted text would pass again the day someone
// special-cases one member name while every other read off the same binding
// stayed unchecked.  The defect is what the ENV resolves each name to, so that
// is what these assertions read — `envForNode(...).resolve(name).type`.
//
// The two-position tests are the load-bearing ones: an aggregate `operation`
// already worked on `main`, so it is the control.  Parity between the two
// columns is the property being fixed, not any single type.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import type { Model } from "../../../src/language/generated/ast.js";
import { isDomainServiceOperation, isOperation } from "../../../src/language/generated/ast.js";
import type { DddType } from "../../../src/language/type-system.js";
import { envForNode } from "../../../src/language/type-system.js";
import { parseString } from "../../_helpers/index.js";

// A stable rendering of a `DddType`.  Deep-equality is not usable here: the
// aggregate / valueobject / entity arms hold the AST node itself, so `toEqual`
// walks `$container` back into the document and throws on the cycle.  This
// renders the same information the union carries, and nothing else.
function show(t: DddType | undefined): string {
  if (!t) return "(unbound)";
  switch (t.kind) {
    case "primitive":
      return `primitive:${t.name}`;
    case "id":
      return `id<${t.target.name}>`;
    case "enum":
      return `enum:${t.ref.name}`;
    case "valueobject":
      return `valueobject:${t.ref.name}`;
    case "aggregate":
      return `aggregate:${t.ref.name}`;
    case "entity":
      return `entity:${t.ref.name}`;
    case "payload":
      return `payload:${t.ref.name}`;
    case "array":
      return `array<${show(t.element)}>`;
    case "optional":
      return `optional<${show(t.inner)}>`;
    default:
      return t.kind;
  }
}

const SRC = `
  context Fleet {
    aggregate Owner with crudish {
      tier: string
      label: string

      // THE CONTROL.  An aggregate 'operation' — envForNode already bound
      // these on main, so whatever this column reports is the correct answer
      // the service column must match.
      operation inAggregate(t: string, oid: Owner id) {
        let arr = Owners.byTier(t)
        let maybeOwner = Owners.byLabel(t)
        let one = Owners.getById(oid)
        label := t
      }
    }

    repository Owners for Owner {
      find byTier(tier: string): Owner[] where this.tier == tier
      find byLabel(label: string): Owner? where this.label == label
    }

    domainService Probe {
      // THE SUBJECT.  Byte-for-byte the same params and lets, in a
      // 'domainService' operation instead.
      operation inService(t: string, oid: Owner id): bool {
        let arr = Owners.byTier(t)
        let maybeOwner = Owners.byLabel(t)
        let one = Owners.getById(oid)
        return t != null
      }
    }
  }
`;

/** The env as seen from inside the named body, keyed by binding name. */
function envIn(model: Model, opName: string) {
  for (const node of AstUtils.streamAllContents(model)) {
    const named = isOperation(node) || isDomainServiceOperation(node);
    if (!named || node.name !== opName) continue;
    const stmts = isOperation(node) ? node.body : node.stmts;
    const anchor = stmts[0];
    if (!anchor) throw new Error(`operation '${opName}' has an empty body`);
    return envForNode(anchor);
  }
  throw new Error(`operation '${opName}' not found`);
}

const NAMES = ["t", "oid", "arr", "maybeOwner", "one"] as const;

describe("domainService operation body: the typing environment (F1, language half)", () => {
  it("the fixture is CLEAN — the hole is that this model validates, then misgenerates", async () => {
    // Same guard as the IR-side test: a model the validator rejected would
    // never reach an emitter, and the audit's whole point is that this one
    // passes validation with every receiver untyped.
    const { errors } = await parseString(SRC);
    expect(errors).toEqual([]);
  });

  it.each([
    // name   expected resolved type
    ["t", "primitive:string"],
    ["oid", "id<Owner>"],
    ["arr", "array<aggregate:Owner>"],
    ["maybeOwner", "optional<aggregate:Owner>"],
    ["one", "aggregate:Owner"],
  ])("binds '%s' to %s inside the service body", async (name, expected) => {
    const { model } = await parseString(SRC);
    expect(show(envIn(model, "inService").resolve(name)?.type)).toBe(expected);
  });

  it("resolves every name in the service body exactly as the aggregate body does", async () => {
    // The parity property proper, and the reason this test is two-position.
    // Before the arm the service column was five `unknown`s against the
    // aggregate column's five real types.
    const { model } = await parseString(SRC);
    const agg = envIn(model, "inAggregate");
    const svc = envIn(model, "inService");
    const render = (e: ReturnType<typeof envIn>) =>
      Object.fromEntries(NAMES.map((n) => [n, show(e.resolve(n)?.type)]));
    expect(render(svc)).toEqual(render(agg));
  });

  it("never leaves a binding `unknown` (the regression guard)", async () => {
    // The guard proper.  `unknown` is what EVERY one of these resolved to
    // before the arm, and it is the value every type-based validator
    // suppresses on — so a future refactor that drops the arm, or renames
    // `stmts`, fails here first whatever it does to any single type.
    const { model } = await parseString(SRC);
    const svc = envIn(model, "inService");
    for (const n of NAMES) {
      expect(show(svc.resolve(n)?.type), `binding '${n}'`).not.toBe("unknown");
      expect(show(svc.resolve(n)?.type), `binding '${n}'`).not.toBe("(unbound)");
    }
  });
});

// ---------------------------------------------------------------------------
// The consequence: gates that were failing open now reach a service body.
// Typing the env is only worth doing if the suppressed checks re-engage, so
// assert the observable behaviour too — with the aggregate position as the
// control on every case, so a gate that never fired ANYWHERE cannot read as
// a pass here.
// ---------------------------------------------------------------------------

function twoPositionSrc(expr: string): { agg: string; svc: string } {
  const body = `let one = Owners.getById(oid)`;
  const mk = (aggStmt: string, svcStmt: string) => `
  context Fleet {
    aggregate Owner with crudish {
      tier: string
      label: string
      operation probe(oid: Owner id) { ${body}  ${aggStmt} }
    }
    repository Owners for Owner {
      find byTier(tier: string): Owner[] where this.tier == tier
    }
    domainService Probe {
      operation probe(oid: Owner id): bool { ${body}  ${svcStmt} }
    }
  }
`;
  return {
    agg: mk(`label := ${expr}`, `return true`),
    svc: mk(`label := ""`, `return ${expr} != null`),
  };
}

describe("domainService body: the suppressed type gates now reach it", () => {
  it("an invented member on a let-bound aggregate is rejected in BOTH positions", async () => {
    const { agg, svc } = twoPositionSrc("one.totallyInvented");
    const aggErrors = (await parseString(agg)).errors.join("\n");
    const svcErrors = (await parseString(svc)).errors.join("\n");
    // The control must fire — otherwise this case proves nothing.
    expect(aggErrors).toMatch(/'totallyInvented' is not a member of 'Owner'/);
    // The subject: silent on `main`, rejected now.
    expect(svcErrors).toMatch(/'totallyInvented' is not a member of 'Owner'/);
  });

  it("a REAL member on the same binding stays clean in both positions", async () => {
    // The false-positive guard: the arm must not turn a valid body red.
    const { agg, svc } = twoPositionSrc("one.tier");
    expect((await parseString(agg)).errors).toEqual([]);
    expect((await parseString(svc)).errors).toEqual([]);
  });
});
