// -------------------------------------------------------------------------
// Narrow single-backend host-identifier / call-position syntax gates:
// elixir (vanilla) in-class operation self-call position, and java reserved
// identifiers (F2-ADP-7).  Split out of system-checks.ts by packet 2.6
// (wave-2) — mechanical move, no logic change.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { platformFamily } from "../../../language/validators/data/platform-rules.js";
import { isJavaKeyword, upperFirst } from "../../../util/naming.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ContainmentIR,
  DerivedIR,
  ExprIR,
  FieldIR,
  OperationIR,
  StmtIR,
  SystemIR,
  TypeIR,
} from "../../types/loom-ir.js";
import { walkStmtExprsDeep, walkStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { walkExpr } from "./shared.js";

// ---------------------------------------------------------------------------
// In-class operation→operation self-call position on elixir (vanilla).
//
// An aggregate operation compiles to a context function `<op>_<agg>(record,
// params)` that returns a tagged `{:ok,_} | {:error,_}` tuple (exception-less.md
// — the same carrier the controller `case`s on).  A sibling-operation self-call
// can therefore only be PASSED THROUGH as the whole `return` value (the enclosing
// op returns the same tagged shape) — it cannot be composed into a larger
// expression or bound with `let`, because a tuple has no implicit unwrap in
// Elixir.  The other backends model an operation as a plain method returning its
// value directly, so they compose freely; on vanilla the non-tail case would
// silently emit a tuple into arithmetic / a struct field, so reject it up front.
// (A `function` self-call is unrestricted — functions are pure, arity-1, and
// return their value directly.)  Mirrors `loom.vanilla-document-unsupported`.
// ---------------------------------------------------------------------------

/** Is this expression a sibling-operation self-call (vs a pure `function` /
 *  value-object ctor / repo read)?  Operations — public and private — lower to
 *  the `private-operation` callKind. */

function isOperationSelfCall(e: ExprIR): e is ExprIR & { kind: "call" } {
  return e.kind === "call" && e.callKind === "private-operation";
}

/** Visit every expression a statement roots — the value-bearing arms only
 *  (mirrors the lowering's statement shapes); a bare `call` statement is itself
 *  a no-op op-call on vanilla and is handled there, so its receiver is not an
 *  expression to flag. */

function eachStmtExpr(s: StmtIR, visit: (e: ExprIR) => void): void {
  switch (s.kind) {
    case "precondition":
    case "requires":
    case "let":
    case "expression":
      walkExpr(s.expr, visit);
      break;
    case "return":
    case "assign":
    case "add":
    case "remove":
      walkExpr(s.value, visit);
      break;
    case "emit":
      for (const f of s.fields) walkExpr(f.value, visit);
      break;
  }
}

export function validateElixirOpSelfCallPosition(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) ctxByName.set(c.name, c);

  for (const dep of sys.deployables) {
    if (dep.platform !== "elixir") continue;
    for (const ctxName of dep.contextNames) {
      const ctx = ctxByName.get(ctxName);
      if (!ctx) continue;
      for (const agg of ctx.aggregates) {
        for (const op of agg.operations as OperationIR[]) {
          for (const s of op.statements) {
            // The single allowed site: an op-call that IS the whole value of a
            // `return` (tail passthrough).  Every other occurrence is rejected.
            const allowed =
              s.kind === "return" && isOperationSelfCall(s.value) ? s.value : undefined;
            eachStmtExpr(s, (e) => {
              if (e === allowed || !isOperationSelfCall(e)) return;
              diags.push({
                severity: "error",
                code: "loom.vanilla-op-call-position",
                message: diagMessage("loom.vanilla-op-call-position", {
                  ctxName,
                  name: agg.name,
                  opName: op.name,
                  eName: e.name,
                }),
                source: `${sys.name}/${dep.name}`,
              });
            });
          }
          // A BARE call statement to a private operation is emitted on vanilla
          // as `record = __op_<name>(record, …)` — a pure struct transform in
          // the caller's module (M-T6.55 F24).  That helper is `defp`-local and
          // takes no actor, and the CALLER binds `current_user` only when its
          // OWN body reads the principal, so a callee whose body reads
          // `currentUser` would render an unbound `current_user` —
          // `mix compile` fails with "undefined variable".  The threading is a
          // real feature (every actor-arg site in the elixir emitter would have
          // to become transitive over the private-op call graph); until then it
          // is an HONEST refusal here rather than an emitted body that does not
          // compile.  Independent of the call-position rule above: this one is
          // about the CALLEE's body, not the call's syntactic slot.
          for (const s of op.statements) {
            walkStmtsDeep(s, (inner) => {
              if (inner.kind !== "call" || inner.target !== "private-operation") return;
              const callee = (agg.operations as OperationIR[]).find((o) => o.name === inner.name);
              if (!callee || !callee.statements.some(stmtReadsCurrentUser)) return;
              diags.push({
                severity: "error",
                code: "loom.vanilla-op-call-actor",
                message: diagMessage("loom.vanilla-op-call-actor", {
                  ctxName,
                  name: agg.name,
                  opName: op.name,
                  eName: inner.name,
                }),
                source: `${sys.name}/${dep.name}`,
              });
            });
          }
        }
      }
    }
  }
}

/** True when any expression this statement roots (at any depth) reads the
 *  request principal. */
function stmtReadsCurrentUser(s: StmtIR): boolean {
  let found = false;
  walkStmtExprsDeep(s, (e) => {
    if (e.kind === "ref" && e.refKind === "current-user") found = true;
  });
  return found;
}

// `shape: embedded` reference collections (`X id[]`) map on java: the jsonb
// id-array column rides a per-target `AttributeConverter`
// (`<Target>IdJsonListConverter`, emitted in domain.ids) that unwraps the
// `List<XId>` to its bare `value`s, so the Jackson FormatMapper serialises
// `["v1","v2"]` — the same physical jsonb shape .NET / node / elixir produce.
// Nested part-in-part containments (single AND collection) likewise map
// (`directParentOf`).  There is no gate: `loom.java-embedded-refcoll-unsupported`
// has no raise site, and `test/generator/java/generator-java-shapes.test.ts`
// pins that it is never raised.

// ---------------------------------------------------------------------------
// M-T6.36 — the two `loom.java-{workflow-instance,projection}-field-unsupported`
// gates USED TO LIVE HERE, and were retired 2026-08-31 as PHANTOMS.
//
// Both refused an ENTITY (containment-part) typed read-model field.  The
// mission asked for the refused shapes to be emitted; probing the premise on
// fresh `main` showed there is nothing to emit, because the shape is
// UNREACHABLE.  A part type resolves only inside its own aggregate
// (`src/language/ddd-scope.ts`), so `projection P { line: Line }` and
// `workflow W { line: Line }` both fail at phase ③ with `Could not resolve
// reference to NamedDecl named 'Line'` — on EVERY platform, before any
// java-specific check runs.  A backend-named code for a shape the language
// refuses is the M-T5.21 §Symptom 1 lie in its purest form: it made java read
// as uniquely limited and carried two rows in the open-gap register that
// nothing could ever drain.
//
// The emitters keep their `guardInstanceField` / `guardProjectionField` throws
// as internal invariants (that is what an unreachable arm should be), and
// `test/generator/java/generator-java-readmodel-gates.test.ts` now pins the
// unreachability at the scope layer — so if that rule ever widens, the gap
// becomes visible again as a test failure rather than as silent output.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F2-ADP-7 (java arm) — a `.ddd` name that is a JAVA RESERVED WORD.
//
// The SQL half of this was closed by M-T6.42/M-T6.43: `@Column(name = …)` runs
// through `hbIdent`, so a column called `case` is quoted.  The HOST-IDENTIFIER
// half was left bare — `src/generator/java/emit/entity.ts` emits `String case;`
// and `public String case() {`, and the DTO records emit
// `record TicketResponse(String case, int do, …)`.  `javac` rejects all of it,
// and codegen reports zero diagnostics, so the failure surfaces only in a
// compile tier.
//
// WHY THIS REFUSES INSTEAD OF ESCAPING (probed, not assumed).  The .NET arm
// escapes — `@case` is a C# VERBATIM IDENTIFIER: lexically the identifier
// `case`, so the emitted member name, and therefore the JSON property
// System.Text.Json derives from it, are byte-identical to today.  Java has no
// verbatim-identifier syntax (JLS §3.9: a keyword is never an identifier), so
// the only "escape" available is a RENAME — which is what `escapeJavaIdent`
// does for LOCALS (`case` → `case_`).  Renaming a DECLARED field renames the
// Java record component, and a record component name IS the Jackson property
// name: `{"case": …}` would silently become `{"case_": …}` on java and java
// only.  A wire divergence introduced to fix a compile error is a worse bug
// than the compile error, so the honest answer at this layer is to refuse the
// name while a java deployable hosts the declaration.
//
// SCOPED TO THE AXIS THE LIMITATION LIVES ON: it fires only for a context
// hosted by a `platform: java` deployable.  The same model on node / python /
// elixir / dotnet is untouched — `get case()`, `def case`, `field :case` and
// `@case` are all legal there.
// ---------------------------------------------------------------------------

/** Every `.ddd`-declared name in `ctx` that the java emitters put in a bare
 *  Java identifier position, as `[what, owner, name]`. */

function javaIdentifierPositions(ctx: BoundedContextIR): [string, string, string][] {
  const out: [string, string, string][] = [];
  const members = (owner: string, fields: { name: string }[], what: string): void => {
    for (const f of fields) out.push([what, owner, f.name]);
  };
  const action = (owner: string, op: OperationIR): void => {
    // The canonical `create` / `destroy` are unnamed — they emit as `create` /
    // `destroy`, never as a `.ddd` name, so only their PARAMS are at risk.
    if (!op.canonical) out.push(["operation", owner, op.name]);
    for (const p of op.params) out.push(["parameter", `${owner}.${op.name}`, p.name]);
  };
  for (const agg of ctx.aggregates) {
    members(agg.name, agg.fields, "field");
    members(agg.name, agg.contains, "containment");
    members(agg.name, agg.derived, "derived field");
    for (const fn of agg.functions) {
      out.push(["function", agg.name, fn.name]);
      for (const p of fn.params) out.push(["parameter", `${agg.name}.${fn.name}`, p.name]);
    }
    for (const op of [...agg.operations, ...(agg.creates ?? []), ...(agg.destroys ?? [])])
      action(agg.name, op);
    for (const part of agg.parts) {
      members(`${agg.name}.${part.name}`, part.fields, "field");
      members(`${agg.name}.${part.name}`, part.contains, "containment");
      members(`${agg.name}.${part.name}`, part.derived, "derived field");
    }
  }
  for (const vo of ctx.valueObjects) {
    members(vo.name, vo.fields, "field");
    members(vo.name, vo.derived, "derived field");
  }
  for (const ev of ctx.events) members(ev.name, ev.fields, "field");
  for (const proj of ctx.projections) {
    members(proj.name, proj.stateFields, "field");
    for (const p of proj.params) out.push(["parameter", proj.name, p.name]);
  }
  for (const wf of ctx.workflows) {
    members(wf.name, wf.stateFields ?? [], "field");
    for (const p of wf.params) out.push(["parameter", wf.name, p.name]);
  }
  return out;
}

export function validateJavaReservedIdentifiers(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) ctxByName.set(c.name, c);
  // One diagnostic per offending NAME, not per hosting deployable — two java
  // deployables serving the same context describe one defect, not two.
  const seen = new Set<string>();
  for (const dep of sys.deployables) {
    if (platformFamily(dep.platform) !== "java") continue;
    for (const ctxName of dep.contextNames) {
      const ctx = ctxByName.get(ctxName);
      if (!ctx) continue;
      for (const [what, owner, name] of javaIdentifierPositions(ctx)) {
        if (!isJavaKeyword(name)) continue;
        const key = `${ctxName}/${owner}/${what}/${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diags.push({
          severity: "error",
          message: diagMessage("loom.java-reserved-identifier-unsupported", {
            what,
            owner,
            name,
            ctxName,
          }),
          source: `${sys.name}/${ctxName}/${owner}`,
          code: "loom.java-reserved-identifier-unsupported",
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// C# member-vs-type name collisions on the dotnet backend (F11).
//
// THE DEFECT.  `src/generator/dotnet/emit/entity.ts` puts every declared
// member of an aggregate into a bare C# member position on the aggregate
// class — `upperFirst(name)` for a field/derived/containment property, a
// function, or an operation method — while the SAME class body references its
// sibling TYPES by simple name (`Comment._Create(...)`, `CommentId.New()`,
// `new IssueOpened { … }`).  C# resolves a simple name in EXPRESSION position
// against the enclosing class's members FIRST, so a member whose C# name
// equals one of those type names hides the type and the reference stops
// compiling:
//
//   aggregate Issue { contains comments: Comment[]
//                     operation comment(author: string, body: string) { … }
//                     entity Comment { … } }
//
//   public void Comment(string author, string body) {
//       _comments.Add(Comment._Create(…));   // CS0119: 'Issue.Comment(string,
//   }                                        // string)' is a method, which is
//                                            // not valid in the given context
//
// A field-shaped collision fails the same way with a different code — a
// `comment: string` beside `entity Comment` makes `Comment._Create` read as
// `string._Create` (CS1061).  Both were reproduced under
// `dotnet build /warnaserror`; neither produces any diagnostic from codegen,
// so today the failure surfaces only in a compile tier (or, for a user, as a
// build error in generated code they did not write).
//
// WHY THIS REFUSES INSTEAD OF RENAMING.  The .NET emitter's only naming
// escape is `escapeCsharpIdent` — `@case`, a VERBATIM IDENTIFIER that is
// lexically the same identifier, so it renames nothing.  There is no
// member-renaming precedent to follow, and inventing one would move more
// than the C# member: an operation's name is also its route segment, its
// `<Op>Command` / `<Op>Handler` type names and its wire path, so a silent
// `comment` → `AddComment` would move the HTTP surface on dotnet alone.  A
// rename that changes the wire to fix a compile error is the same trade
// `loom.java-reserved-identifier-unsupported` rejected above.
//
// WHERE THE LINE IS, AND WHY IT IS NOT "ANY EQUAL NAME".  C# deliberately
// permits the "Color Color" case (§12.8.7.2): a FIELD or PROPERTY whose own
// type is the type it shadows still resolves both ways, so `public Kind Kind`
// beside `enum Kind` and `public Money Money` beside a `Money` value object
// compile — probed, not assumed.  Firing on those would refuse models that
// build today, so a property-shaped member is exempt exactly when its emitted
// C# type IS the colliding type.  A method never gets that rescue (the rule
// covers fields/properties only), and a COLLECTION property does not either:
// `IReadOnlyList<Comment> Comment` has type `IReadOnlyList<Comment>`, not
// `Comment`.
//
// SCOPED TO THE AXIS THE LIMITATION LIVES ON: it fires only for a context
// hosted by a `platform: dotnet` deployable.  The same model on node / python
// / elixir / java is untouched — none of them scope member names against type
// names this way.
// ---------------------------------------------------------------------------

/** Simple C# type name the dotnet emitter renders for `t`, or null when it
 *  is not a user-declared type (a primitive, a collection wrapper, …).  Used
 *  ONLY for the "Color Color" exemption, so a null answer just means "no
 *  exemption" — it never widens what the gate refuses. */
function csDeclaredTypeName(t: TypeIR): string | null {
  if (t.kind === "optional") return csDeclaredTypeName(t.inner);
  // A collection property's C# type is `IReadOnlyList<T>`, not `T`, so the
  // Color-Color rule does not apply to it.
  if (t.kind === "array") return null;
  if (t.kind === "id") return `${t.targetName}Id`;
  if (t.kind === "enum" || t.kind === "valueobject" || t.kind === "entity") return t.name;
  return null;
}

/** Every C# type name an aggregate class body in `ctx` can reach by SIMPLE
 *  name: its own part classes (same namespace) plus everything reachable
 *  through the four `using` directives every emitted aggregate file carries
 *  (`Api.Domain.Ids` / `.Events` / `.ValueObjects` / `.Enums`).  Other
 *  aggregates and THEIR parts are deliberately absent — each aggregate gets
 *  its own `Api.Domain.<Plural>` namespace, which this file does not import,
 *  so a name equal to a foreign part is not a collision. */
function csVisibleTypeNames(ctx: BoundedContextIR, agg: AggregateIR): Set<string> {
  const names = new Set<string>([agg.name]);
  for (const p of agg.parts) names.add(p.name);
  for (const e of ctx.enums) names.add(e.name);
  for (const v of ctx.valueObjects) names.add(v.name);
  for (const ev of ctx.events) names.add(ev.name);
  // `Api.Domain.Ids` holds an id class per aggregate AND per part.
  for (const a of ctx.aggregates) {
    names.add(`${a.name}Id`);
    for (const p of a.parts) names.add(`${p.name}Id`);
  }
  return names;
}

/** Every `.ddd`-declared member of `agg` (and of its parts) the dotnet
 *  emitter puts in a bare C# MEMBER position, as
 *  `[what, owner, name, exemptType]`.  `exemptType` is the type name that
 *  rescues the member under the Color-Color rule, or null for a method-shaped
 *  member, which never gets one. */
function csMemberPositions(agg: AggregateIR): [string, string, string, string | null][] {
  const out: [string, string, string, string | null][] = [];
  const holder = (
    owner: string,
    h: { fields: FieldIR[]; contains: ContainmentIR[]; derived: DerivedIR[] },
  ): void => {
    for (const f of h.fields) out.push(["field", owner, f.name, csDeclaredTypeName(f.type)]);
    for (const c of h.contains)
      out.push(["containment", owner, c.name, c.collection ? null : c.partName]);
    for (const d of h.derived)
      out.push(["derived field", owner, d.name, csDeclaredTypeName(d.type)]);
  };
  holder(agg.name, agg);
  for (const fn of agg.functions) out.push(["function", agg.name, fn.name, null]);
  // The canonical `create` / `destroy` never emit a `.ddd` name as a method —
  // they are `Create` / the repository's `DeleteAsync` — so only NAMED
  // operations are at risk.
  for (const op of agg.operations)
    if (!op.canonical) out.push(["operation", agg.name, op.name, null]);
  for (const part of agg.parts) {
    holder(`${agg.name}.${part.name}`, part);
    for (const fn of part.functions)
      out.push(["function", `${agg.name}.${part.name}`, fn.name, null]);
  }
  return out;
}

export function validateDotnetNameCollisions(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) ctxByName.set(c.name, c);
  // One diagnostic per offending NAME, not per hosting deployable — two dotnet
  // deployables serving the same context describe one defect, not two.
  const seen = new Set<string>();
  for (const dep of sys.deployables) {
    if (platformFamily(dep.platform) !== "dotnet") continue;
    for (const ctxName of dep.contextNames) {
      const ctx = ctxByName.get(ctxName);
      if (!ctx) continue;
      for (const agg of ctx.aggregates) {
        const types = csVisibleTypeNames(ctx, agg);
        for (const [what, owner, name, exemptType] of csMemberPositions(agg)) {
          const member = upperFirst(name);
          if (!types.has(member)) continue;
          // "Color Color": a property whose own C# type IS the shadowed type
          // still resolves both ways, so it is not a collision.
          if (exemptType === member) continue;
          const key = `${ctxName}/${owner}/${what}/${name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          diags.push({
            severity: "error",
            message: diagMessage("loom.dotnet-name-collision", {
              what,
              owner,
              name,
              member,
              ctxName,
            }),
            source: `${sys.name}/${ctxName}/${owner}`,
            code: "loom.dotnet-name-collision",
          });
        }
      }
    }
  }
}
