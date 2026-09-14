import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type {
  DomainServiceIR,
  LetStmtIR,
  LoomModel,
  StmtIR,
  TypeIR,
} from "../../src/ir/types/loom-ir.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";

// ---------------------------------------------------------------------------
// The IR TYPE of a `let` that binds a repository READ inside a `domainService`
// operation body (testability audit F1, `docs/audits/2026-09-13-testability-audit.md`).
//
// WHY THIS PINS THE TYPE AND NOT THE RENDERED STRING.  The reported symptom was
// `return found.count > 0` emitted verbatim — TS2339 on `Owner[]`, `found.count()`
// on a java `List<Owner>`, and on .NET `found.Count > 0`, which COMPILES by C#
// naming coincidence alone.  A test that asserts `f.count` renders `.length`
// would pass again the day someone special-cases the member name, while every
// other member read off the same binding stayed wrong.  The defect is the
// BINDING'S TYPE: it was `string` (`memberType`'s default fallback), so the
// grapheme-safe STRING lowering of `.length` (`[...f].length`) came out of a
// binding holding an array — that spread is the tell, and it is what these
// assertions are really guarding.
//
// Lowering only (`lowerModel`), deliberately: this is a phase-⑤ fact, and
// reading it off the IR keeps the test blind to which backend renders what.
// ---------------------------------------------------------------------------

const services = createDddServices(NodeFileSystem);
const parse = parseHelper<Model>(services.Ddd);

const OWNER: TypeIR = { kind: "entity", name: "Owner" };

const SRC = `
system RosterSys {
  subdomain Fleet { context Fleet {
    aggregate Owner with crudish { tier: string  label: string }

    criterion InTier(tier: string) of Owner = this.tier == tier
    retrieval TopOwners of Owner { where: InTier("gold") }

    repository Owners for Owner {
      find byTier(tier: string): Owner[] where this.tier == tier
      find byLabel(label: string): Owner? where this.label == label
    }

    domainService Roster {
      // 'named' — a DECLARED find carries its own return type.
      operation declaredList(t: string): bool { let f = Owners.byTier(t)  return f.count > 0 }
      operation declaredOptional(l: string): bool { let f = Owners.byLabel(l)  return f == null }
      // 'named' — the BUILT-IN verbs every repository auto-emits.  None is in
      // 'finds', so none has a declared return type to read, and they do NOT
      // share one shape: getById/findById load one row, findAll/all return the
      // whole collection.  Collapsing them either way reintroduces the bug for
      // the other half.
      operation builtinGetById(o: Owner id): string { let f = Owners.getById(o)  return f.label }
      operation builtinFindById(o: Owner id): string { let f = Owners.findById(o)  return f.label }
      operation builtinFindAll(): bool { let f = Owners.findAll()  return f.count > 0 }
      operation builtinAll(): bool { let f = Owners.all()  return f.count > 0 }
      // the criterion / retrieval shapes
      operation criterionAll(t: string): bool { let f = Owners.findAll(InTier(t))  return f.count > 0 }
      operation criterionOne(t: string): bool { let f = Owners.find(InTier(t))  return f == null }
      operation retrievalRun(): bool { let f = Owners.run(TopOwners)  return f.count > 0 }
    }
  } }

  api FleetApi from Fleet
  storage primary { type: postgres }
  resource fleetState { for: Fleet, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [Fleet]
    dataSources: [fleetState]
    serves: FleetApi
    port: 4000
  }
}`;

async function lower(): Promise<LoomModel> {
  const doc = await parse(SRC, { validation: true });
  const errors = (doc.diagnostics ?? []).filter((d) => d.severity === 1);
  // The model must be CLEAN: a mistyped binding that the validator rejected
  // would never reach an emitter, and the audit's whole point is that this one
  // parses, validates and then misgenerates.
  expect(errors.map((d) => d.message)).toEqual([]);
  return lowerModel(doc.parseResult.value);
}

function serviceFrom(ir: LoomModel, name: string): DomainServiceIR {
  for (const sys of ir.systems)
    for (const sub of sys.subdomains)
      for (const ctx of sub.contexts) {
        const svc = ctx.domainServices?.find((s) => s.name === name);
        if (svc) return svc;
      }
  throw new Error(`domainService '${name}' not lowered`);
}

/** The type the operation's single `let` binds. */
function bindingType(svc: DomainServiceIR, opName: string): TypeIR | undefined {
  const op = svc.operations.find((o) => o.name === opName);
  if (!op) throw new Error(`operation '${opName}' not lowered`);
  const isLet = (s: StmtIR): s is LetStmtIR => s.kind === "let";
  const lets = op.body.filter(isLet);
  expect(lets).toHaveLength(1);
  return lets[0]!.type;
}

describe("domainService: the IR type of a let-bound repository read (F1)", () => {
  it.each([
    // op                  expected binding type
    ["declaredList", { kind: "array", element: OWNER }],
    ["declaredOptional", { kind: "optional", inner: OWNER }],
    ["builtinGetById", OWNER],
    ["builtinFindById", OWNER],
    ["builtinFindAll", { kind: "array", element: OWNER }],
    ["builtinAll", { kind: "array", element: OWNER }],
    ["criterionAll", { kind: "array", element: OWNER }],
    ["criterionOne", { kind: "optional", inner: OWNER }],
    ["retrievalRun", { kind: "array", element: OWNER }],
  ] as const)("%s binds the read's real type", async (opName, expected) => {
    const svc = serviceFrom(await lower(), "Roster");
    expect(bindingType(svc, opName)).toEqual(expected);
  });

  it("never falls back to the `string` default", async () => {
    // The regression guard proper.  `string` is `memberType`'s fallback, and it
    // is what EVERY one of these bound before the fix — so a future refactor
    // that reintroduces the fall-through fails here first, whatever it does to
    // any single member's rendering.
    const svc = serviceFrom(await lower(), "Roster");
    for (const op of svc.operations) {
      expect(bindingType(svc, op.name)).not.toEqual({ kind: "primitive", name: "string" });
    }
  });

  it("agrees with the workflow tier about the same read", async () => {
    // `lower-workflow.ts` lowers these same shapes on its own path (`repo-run` /
    // `repo-let`).  The two tiers reading one repository differently is the
    // drift this shared rule exists to prevent, so pin the agreement.
    const ir = await lower();
    const ctx = ir.systems[0]!.subdomains[0]!.contexts[0]!;
    const repo = ctx.repositories.find((r) => r.name === "Owners");
    expect(repo?.finds.find((f) => f.name === "byTier")?.returnType).toEqual({
      kind: "array",
      element: OWNER,
    });
    expect(bindingType(serviceFrom(ir, "Roster"), "declaredList")).toEqual(
      repo?.finds.find((f) => f.name === "byTier")?.returnType,
    );
  });
});
