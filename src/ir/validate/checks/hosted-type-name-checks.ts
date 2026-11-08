// -------------------------------------------------------------------------
// Cross-context type-name collisions on one deployable
// (`loom.hosted-type-name-collision`).
//
// A deployable generates ONE project for every context it hosts, and every
// backend lays the domain types of that project out in a flat, per-kind
// namespace: `Domain/Enums/Status.cs`, `domain/order.ts`, `app/domain/order.py`,
// a single `value-objects.ts` / `events.py` module.  Two hosted contexts that
// each declare an `aggregate Order`, a `valueobject Money`, an `enum Status`,
// an `event Done`, a `workflow place`, a handler or a payload therefore write the same output path (java / .NET refuse
// with an emission-clobber crash) or the same module-level symbol (node /
// python / elixir silently keep one declaration and drop the other's fields).
// The names are legal within their own context, so no per-context check sees
// the clash; this one compares them across the contexts a deployable hosts.
//
// The names are compared case-insensitively: the emitted paths and file names
// are derived from them, and a case-insensitive filesystem merges two files
// whose names differ only by case.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, SystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

type TypeKind =
  | "aggregate"
  | "value object"
  | "enum"
  | "event"
  | "workflow"
  | "handler"
  | "payload";

/** The domain types a context declares, by kind.  A value object or enum
 *  declared at the root of a file (the shared kernel) is folded into every
 *  context but is ONE declaration that every backend emits once, so it is not a
 *  per-context declaration. */
function declaredTypes(ctx: BoundedContextIR): [TypeKind, string][] {
  const out: [TypeKind, string][] = [];
  for (const a of ctx.aggregates) out.push(["aggregate", a.name]);
  for (const v of ctx.valueObjects) if (!v.systemLevel) out.push(["value object", v.name]);
  for (const e of ctx.enums) if (!e.systemLevel) out.push(["enum", e.name]);
  for (const e of ctx.events) out.push(["event", e.name]);
  for (const w of ctx.workflows) out.push(["workflow", w.name]);
  for (const h of [...(ctx.commandHandlers ?? []), ...(ctx.queryHandlers ?? [])])
    out.push(["handler", h.name]);
  // An event is reachable as a same-named payload (already reported as the
  // event); a synthesized `<Agg>Wire` follows its aggregate.
  const eventNames = new Set(ctx.events.map((e) => e.name));
  for (const p of ctx.payloads)
    if (!p.synthesized && !eventNames.has(p.name)) out.push(["payload", p.name]);
  return out;
}

export function validateHostedTypeNames(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) ctxByName.set(c.name, c);
  // One diagnostic per colliding (kind, name, context pair) — two deployables
  // hosting the same pair describe one defect.
  const seen = new Set<string>();
  for (const dep of sys.deployables) {
    const firstOwner = new Map<string, string>();
    for (const ctxName of dep.contextNames) {
      const ctx = ctxByName.get(ctxName);
      if (!ctx) continue;
      for (const [kind, name] of declaredTypes(ctx)) {
        const key = `${kind}/${name.toLowerCase()}`;
        const first = firstOwner.get(key);
        if (first === undefined) {
          firstOwner.set(key, ctxName);
          continue;
        }
        if (first === ctxName) continue;
        const id = `${key}/${first}/${ctxName}`;
        if (seen.has(id)) continue;
        seen.add(id);
        diags.push({
          severity: "error",
          message: diagMessage("loom.hosted-type-name-collision", {
            kind,
            name,
            ctxName,
            first,
            deployable: dep.name,
          }),
          source: `${sys.name}/${ctxName}/${name}`,
          code: "loom.hosted-type-name-collision",
        });
      }
    }
  }
}
