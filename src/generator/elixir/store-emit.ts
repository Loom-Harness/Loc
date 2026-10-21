// ---------------------------------------------------------------------------
// Phoenix LiveView store-module emitter — `store Cart { … }` → a dedicated
// `lib/<app>_web/stores/<store_snake>.ex` module (named-actions-and-stores.md
// §3, Stage 5).  The Elixir twin of the SPA's Zustand `stores/cart.ts`.
//
// v1 semantic = per-LiveView-process.  The store is its OWN module + struct:
//
//   defmodule StoreLiveViewWeb.Stores.Cart do
//     defstruct lines: [], count: 0
//
//     def add(%__MODULE__{} = state, sku) do
//       state = %{state | lines: state.lines ++ [sku]}
//       %{state | count: state.count + 1}
//     end
//
//     def clear(%__MODULE__{} = state) do
//       state = %{state | lines: []}
//       %{state | count: 0}
//     end
//   end
//
//   (A single-write action collapses to the `def … do: %{…}` one-liner form;
//   a multi-write body renders the `do…end` block shown above.)
//
//   - `defstruct` carries every state field with its declared default (or the
//     type's zero value: `[]` / `0` / `false` / `nil` / …).
//   - Each store `action` → one PUBLIC pure function
//     `def <action>(%__MODULE__{} = state, <params…>)` returning the updated
//     struct.  An own-state read of field `f` renders `state.f`; a write
//     `f := v` / `f += v` rebinds `state = %{state | f: <v>}` (sequential
//     writes chain via rebinding, so a later statement sees the earlier one),
//     and the last statement's struct is the return value.
//   - A same-store action calling another action → `state = <other>(state)` /
//     `<other>(state)` (a pure in-module call).  Cross-store calls are gated
//     on LiveView by `loom.store-cross-store-on-liveview-invalid`.
//
// The page seam (assign(:cart, %Cart{}) in mount + the @cart.field reads +
// the `update(socket, :cart, …)` calls) lives in liveview-emit / heex-walker;
// this module owns only the per-store FILE.
// ---------------------------------------------------------------------------

import type { ActionIR, ExprIR, StateFieldIR, StmtIR } from "../../ir/types/loom-ir.js";
import { mapExprChildren, walkStmtExprsDeep } from "../../ir/util/walk.js";
import { escapeElixirIdent, snake, upperFirst } from "../../util/naming.js";
import { defaultInitFor } from "./heex-walker.js";
import { type RenderCtx, renderExpr } from "./render-expr.js";

/** Render one `StoreIR` as its `lib/<app>_web/stores/<snake>.ex` content.
 *  `webModule` is the `<App>Web` prefix (e.g. "StoreLiveViewWeb"). */
export function renderStoreModule(
  store: { name: string; state: StateFieldIR[]; actions: ActionIR[] },
  webModule: string,
): string {
  const moduleName = `${webModule}.Stores.${upperFirst(store.name)}`;
  const fieldNames = new Set(store.state.map((f) => snake(f.name)));

  // `defstruct field: default, …` — declared `= init` else the type zero.
  const structFields = store.state
    .map((f) => `${snake(f.name)}: ${storeFieldDefault(f)}`)
    .join(", ");
  const defstruct = store.state.length > 0 ? `  defstruct ${structFields}` : `  defstruct []`;

  const actionDefs = store.actions.map((a) => renderStoreAction(a, fieldNames));

  return `# Auto-generated store module (per-LiveView-process, in-memory).
defmodule ${moduleName} do
${defstruct}

${actionDefs.join("\n\n")}
end
`;
}

/** A store field's struct default — its declared `= init` (lowered into the
 *  field's `init` ExprIR) or the type's zero value via `defaultInitFor`. */
function storeFieldDefault(f: StateFieldIR): string {
  if (f.init) return renderStoreExpr(f.init, new Set());
  return defaultInitFor(f.type);
}

/** Render one store action as a public pure function over the struct.  A body
 *  is a sequence of own-state writes (`:=` / `+=` / `-=`) and same-store
 *  action calls; each rebinds `state`, and the final statement's value is the
 *  function's return.  A single-write body collapses to a `def … do: %{…}`
 *  one-liner. */
function renderStoreAction(action: ActionIR, fieldNames: ReadonlySet<string>): string {
  const fn = snake(action.name);
  // A param the body never reads is bound `_<name>` — Elixir warns on an
  // unused variable, and the generated project compiles with
  // `--warnings-as-errors` (an `action push(sku: string) { count += 1 }` is
  // valid `.ddd`; the SPA twins simply ignore the argument).
  const read = new Set<string>();
  for (const s of action.body) {
    walkStmtExprsDeep(s, (e) => {
      if (e.kind === "ref") read.add(snake(e.name));
    });
  }
  const params = action.params.map((p) => {
    const nm = snake(p.name);
    return read.has(nm) ? escapeElixirIdent(nm) : `_${nm}`;
  });
  const head = ["%__MODULE__{} = state", ...params].join(", ");

  const stmtForms = action.body.map((s) => renderStoreStmt(s, fieldNames));

  if (stmtForms.length === 0) {
    // Empty action body — return the struct unchanged.
    return `  def ${fn}(${head}), do: state`;
  }
  if (stmtForms.length === 1) {
    // Single transform — inline `do:` form, no rebinding needed.
    return `  def ${fn}(${head}), do: ${stmtForms[0]!.value}`;
  }
  // Multi-statement — rebind `state` for every step but the last, whose value
  // is the return.  Sequential rebinding lets a later step read an earlier
  // write (`state.f`) just like the SPA's chained `set` calls.
  const lines: string[] = [];
  for (let i = 0; i < stmtForms.length; i++) {
    const last = i === stmtForms.length - 1;
    lines.push(`    ${last ? "" : "state = "}${stmtForms[i]!.value}`);
  }
  return `  def ${fn}(${head}) do
${lines.join("\n")}
  end`;
}

/** A rendered store-action statement — its Elixir value expression (a new
 *  struct, or an in-module action call returning a struct). */
interface StoreStmtForm {
  value: string;
}

/** Render one store-action statement as a struct-producing value.  Writes
 *  (`:=` / `+=` / `-=`) become `%{state | field: <v>}`; a same-store action
 *  call becomes `<other>(state, …)`; a `let` or a bare expression evaluates
 *  and passes the struct through. */
function renderStoreStmt(stmt: StmtIR, fieldNames: ReadonlySet<string>): StoreStmtForm {
  switch (stmt.kind) {
    case "assign": {
      const field = snake(stmt.target.segments[0] ?? "");
      const v = renderStoreExpr(stmt.value, fieldNames);
      return { value: `%{state | ${field}: ${v}}` };
    }
    case "add":
    case "remove": {
      const field = snake(stmt.target.segments[0] ?? "");
      const rhs = renderStoreExpr(stmt.value, fieldNames);
      const read = `state.${field}`;
      // Collection mutation → list append / reject; scalar → compound arith.
      const next = stmt.collection
        ? stmt.kind === "add"
          ? `${read} ++ [${rhs}]`
          : `Enum.reject(${read}, &(&1 == ${rhs}))`
        : `${read} ${stmt.kind === "add" ? "+" : "-"} ${rhs}`;
      return { value: `%{state | ${field}: ${next}}` };
    }
    case "call": {
      // Same-store sibling action call (`reset()`) → an in-module pure call
      // threading the struct.  (Cross-store calls are gated upstream on
      // LiveView, so `target: "store-action"` never reaches here.)
      if (stmt.target === "action") {
        const args = [`state`, ...stmt.args.map((a) => renderStoreExpr(a, fieldNames))];
        return { value: `${snake(stmt.name)}(${args.join(", ")})` };
      }
      // A bare function call — evaluate for effect, struct flows through.
      const args = stmt.args.map((a) => renderStoreExpr(a, fieldNames)).join(", ");
      return { value: `(${snake(stmt.name)}(${args}); state)` };
    }
    case "let": {
      // A `let x = …` in a store action is rare; bind then thread the struct.
      const v = renderStoreExpr(stmt.expr, fieldNames);
      return { value: `(${snake(stmt.name)} = ${v}; state)` };
    }
    case "expression":
      return { value: `(_ = ${renderStoreExpr(stmt.expr, fieldNames)}; state)` };
    case "precondition":
    case "requires":
    case "return":
    case "variant-match":
      // A store module is a pure per-process struct transform: no socket to
      // flash or halt on, no value sink, no remote-call seam.
      // `loom.ui-body-statement-kind` refuses all four in a LiveView store
      // action at phase ⑦ (ui-framework-checks.ts#validateUiBodyStatementKinds).
      throw new Error(
        `internal: store action statement '${stmt.kind}' reached the LiveView store emitter; ` +
          "loom.ui-body-statement-kind should have refused it. Please file a bug.",
      );
    case "if":
      // Refused in every ui body by `loom.if-stmt-page-body-unsupported`.
      throw new Error(
        "internal: an `if` statement reached the LiveView store emitter; " +
          "loom.if-stmt-page-body-unsupported should have refused it. Please file a bug.",
      );
    case "emit":
      // Scope resolution gives a ui body no aggregate to emit from.
      throw new Error(
        "internal: an `emit` statement reached the LiveView store emitter. Please file a bug.",
      );
    default: {
      const _exhaustive: never = stmt;
      return _exhaustive;
    }
  }
}

/** The store module's render context: an own-state read is a `this-prop` off
 *  the threaded `state` struct (`state.<field>`).  A store has no context
 *  module of its own. */
const STORE_RENDER_CTX: RenderCtx = { thisName: "state", contextModule: "" };

/** Render a store-action RHS expression to Elixir through the backend's
 *  shared expression renderer — the same leaves a domain body uses, so a
 *  method call (`lines.count()`), a conversion (`string(n)`), a `match` or
 *  `Decimal` arithmetic renders exactly as it does in an operation.  The one
 *  store-specific seam is the state read: an own-store field arrives as a bare
 *  `let` ref (lowering binds each field as a local) and is retargeted to a
 *  `this-prop` read of `state`. */
function renderStoreExpr(expr: ExprIR, fieldNames: ReadonlySet<string>): string {
  return renderExpr(storeStateReads(expr, fieldNames), STORE_RENDER_CTX);
}

/** Rewrite every own-store field ref in `e`, at any depth, to a `this-prop`
 *  ref — rendered `state.<field>` under {@link STORE_RENDER_CTX}. */
function storeStateReads(e: ExprIR, fieldNames: ReadonlySet<string>): ExprIR {
  if (e.kind === "ref") return fieldNames.has(snake(e.name)) ? { ...e, refKind: "this-prop" } : e;
  return mapExprChildren(e, (c) => storeStateReads(c, fieldNames));
}
