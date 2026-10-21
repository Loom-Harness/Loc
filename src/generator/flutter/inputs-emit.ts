// Controlled-input support for the Flutter frontend.
//
// The standalone input primitives (`Field` / `MultilineField` / `PasswordField`
// / `Toggle` / `SelectField`) render through the flutter pack (`pack.ts`
// `RENDERERS`), reading `state.<bind>` and writing via a bare `set<Field>(v)`
// call.  That setter resolves to a page-shell TEAR-OFF in a `ConsumerWidget`
// page (`final set<Field> = notifier.set<Field>;`) or an in-class method in a
// stateful component — both generated per state field.
//
// A page shell must know WHICH state fields a body binds so it emits exactly the
// tear-offs used (an unused `final` local is a Dart `analyze` warning → CI red).
// `collectBoundInputFields` walks the page/component body for that set — the
// Flutter twin of Feliz's `collectPageBoundState`; its child step is the
// shared `walkExprChildren`, so an input inside a `match` arm is found too.

import type { ExprIR } from "../../ir/types/loom-ir.js";
import { walkExprChildren } from "../../ir/util/walk.js";

/** Walker-primitive names of the controlled inputs the flutter pack renders —
 *  each binds a `state` field via `bind:`.  (FileUpload is still deferred; a
 *  `bind:` on it never reaches here because the validator gate rejects it on a
 *  flutter target.) */
export const FLUTTER_BOUND_INPUT_NAMES: ReadonlySet<string> = new Set([
  "Field",
  "MultilineField",
  "PasswordField",
  "Toggle",
  "SelectField",
  "NumberField",
  "FileUpload",
]);

/** The Notifier/State setter method name a bound input dispatches to.  A
 *  `NumberField` uses the string-parsing `set<Field>Text` variant (the text
 *  input hands a String; the setter parses per the field's numeric type); every
 *  other input uses the typed `set<Field>`. */
function setterFor(primitive: string, field: string): string {
  const base = `set${field[0]!.toUpperCase()}${field.slice(1)}`;
  return primitive === "NumberField" ? `${base}Text` : base;
}

/** Direct child expressions of `e`, from the shared `never`-checked walker —
 *  every expression slot, including each `match` arm (where a scaffolded filter
 *  bar hosts both of its reads).  Lambda-block statements are action bodies,
 *  never a read or form host, so the statement channel is not followed. */
function exprChildren(e: ExprIR): ExprIR[] {
  const out: ExprIR[] = [];
  walkExprChildren(e, { expr: (c) => out.push(c) });
  return out;
}

/** The state-field name a controlled-input call binds via `bind:`, when it is a
 *  `ref` to a known state field; otherwise undefined. */
function boundFieldOf(
  call: Extract<ExprIR, { kind: "call" }>,
  stateNames: ReadonlySet<string>,
): string | undefined {
  const names = call.argNames ?? [];
  const idx = names.indexOf("bind");
  if (idx < 0) return undefined;
  const arg = call.args[idx];
  return arg && arg.kind === "ref" && stateNames.has(arg.name) ? arg.name : undefined;
}

/** The setter tear-offs a page shell must bind — one per state field bound by a
 *  controlled input anywhere in `body` (deduped by setter name, first-seen
 *  order).  Each entry is the exact `notifier.<setter>` method to tear off. */
export function collectBoundInputFields(
  body: ExprIR | undefined,
  stateNames: ReadonlySet<string>,
): { field: string; setter: string }[] {
  const found: { field: string; setter: string }[] = [];
  const seen = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (e.kind === "call" && FLUTTER_BOUND_INPUT_NAMES.has(e.name)) {
      const field = boundFieldOf(e, stateNames);
      if (field) {
        const setter = setterFor(e.name, field);
        if (!seen.has(setter)) {
          seen.add(setter);
          found.push({ field, setter });
        }
      }
    }
    for (const c of exprChildren(e)) visit(c);
  };
  if (body) visit(body);
  return found;
}

/** True when any page or component body in `ui` hosts a `FileUpload` primitive —
 *  drives emitting the `FileRef` model + the `file_picker` dependency. */
export function uiUsesFileUpload(
  ui:
    | { pages?: readonly { body?: ExprIR }[]; components?: readonly { body?: ExprIR }[] }
    | undefined,
): boolean {
  if (!ui) return false;
  let found = false;
  const visit = (e: ExprIR): void => {
    if (found) return;
    if (e.kind === "call" && e.name === "FileUpload") {
      found = true;
      return;
    }
    for (const c of exprChildren(e)) visit(c);
  };
  for (const p of ui.pages ?? []) if (p.body) visit(p.body);
  for (const c of ui.components ?? []) if (c.body) visit(c.body);
  return found;
}
