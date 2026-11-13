// ---------------------------------------------------------------------------
// LiveView handler bodies — the `handle_event/3` clauses a HEEx page hoists.
//
// A LiveView keeps every handler apart from the markup: the template names an
// event (`phx-click="event_1"`), and the clause that runs it lives in the
// LiveView module.  The shared walker core binds a use site through
// `heexTarget.bindEventHandler`; this module renders what runs there — a
// named page `action`, an inline lambda, a store action, an awaited `match`
// over an operation's result — as a socket pipe-chain, the Elixir twin of
// Feliz's `update-emit.ts`.
// ---------------------------------------------------------------------------

import { variantTag } from "../../ir/stdlib/unions.js";
import type { ExprIR, PageIR, StmtIR } from "../../ir/types/loom-ir.js";
import { CONSTANT_FORBIDDEN_DETAIL } from "../../ir/util/denial-detail.js";
import { elixirString, snake, upperFirst } from "../../util/naming.js";
import { floorRuleText } from "../_i18n/rule-text.js";
import { heexTarget } from "./heex-target.js";
import {
  hostStateAssignIfOwned,
  renderExpr,
  renderNavigate,
  renderToastArgs,
  type WalkContext,
} from "./heex-walker-core.js";

/** Pre-hoist the handlers a body's markup refers to by name: its declared
 *  `action`s and its bare store-action handler refs.  Runs before the body
 *  renders so synthesized lambda events number after them: a component walked
 *  standalone and the same component inlined into a page therefore name their
 *  lambda handlers identically. */
export function seedHoistedHandlers(
  ctx: WalkContext,
  page: PageIR,
  body: ExprIR | undefined,
): void {
  // Hoist named page `action`s (named-actions-and-stores.md, Proposal A
  // Stage 1) into `handle_event` clauses named `snake(action.name)`, so a
  // bare `onClick: next` reference — lowered to an `action-ref` ExprIR that
  // renders to `snake(name)` — binds to a real clause.  Mirrors the inline-
  // lambda hoist (`hoistLambdaToHandler`) but keyed by the declared name.
  // Guarded with `?? []`: component synth-pages carry no `actions`.
  for (const action of page.actions ?? []) {
    const bodyLines: string[] = [`    socket =`, `      socket`];
    for (const s of action.body) bodyLines.push(`      ${renderStmt(s, ctx)}`);
    bodyLines.push(`    {:noreply, socket}`);
    ctx.handlers.push({ name: snake(action.name), paramsPattern: "_params", body: bodyLines });
  }

  // Direct store-action handlers (`onClick: Cart.clear`) — a bare store-action
  // reference used as a handler has no matching page `action`, so the button's
  // `phx-click` would dangle without a clause.  Synthesize the clause
  // (dispatch the store action over its per-page assign) exactly like a page
  // action whose body is the single store-action call.  The event is named
  // `storeActionEvent(store, action)` — a hyphenated name no `snake(action)`
  // can spell — so it never shares a clause with a page or component action
  // of the same name (`Cart.clear` beside a component's own `action clear()`
  // is two handlers, not one).  Deduped by event name so a store action
  // onClicked twice emits one clause.
  const existingHandlers = new Set(ctx.handlers.map((h) => h.name));
  for (const { store, action } of collectStoreActionRefs(body)) {
    const name = storeActionEvent(store, action);
    if (existingHandlers.has(name)) continue;
    existingHandlers.add(name);
    ctx.usedStores.add(store);
    const call: StmtIR = {
      kind: "call",
      target: "store-action",
      name: action,
      args: [],
      store,
    };
    ctx.handlers.push({
      name,
      paramsPattern: "_params",
      body: [
        `    socket =`,
        `      socket`,
        `      ${renderStmt(call, ctx)}`,
        `    {:noreply, socket}`,
      ],
    });
  }
}

/** The `handle_event` name of a bare store-action handler (`onClick:
 *  Cart.clear` → `"store-cart-clear"`).  Hyphenated like the emitter's other
 *  synthesized events (`loom-sort`), so it cannot equal a `snake(action)`
 *  clause a page or component action hoists. */
export function storeActionEvent(store: string, action: string): string {
  return `store-${snake(store)}-${snake(action)}`;
}

/** Collect the bare store-action handler references (`action-ref` with a
 *  `storeName`, e.g. `onClick: Cart.clear`) reachable in a page body, deduped
 *  by `<store>.<action>`.  Used to synthesize their `handle_event` clauses —
 *  the LiveView analogue of the JSX shell binding a store-action
 *  local. */
function collectStoreActionRefs(root: ExprIR | undefined): { store: string; action: string }[] {
  const out: { store: string; action: string }[] = [];
  const seen = new Set<string>();
  const visit = (e: ExprIR | undefined): void => {
    if (!e || typeof e !== "object") return;
    if (e.kind === "action-ref" && e.storeName) {
      const key = `${e.storeName}.${e.actionName}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ store: e.storeName, action: e.actionName });
      }
    }
    // Recurse structurally — visit every ExprIR-typed child field.
    for (const v of Object.values(e as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const el of v) visit(el as ExprIR);
      else if (v && typeof v === "object" && "kind" in (v as object)) visit(v as ExprIR);
    }
  };
  visit(root);
  return out;
}

export function hoistLambdaToHandler(arg: ExprIR, ctx: WalkContext): string {
  if (arg.kind !== "lambda") {
    // Not a lambda — try to lower as expression in handler context.
    // Caller will get back something it can put in `phx-click="…"`.
    return "noop";
  }
  // Event name is scoped to this page's walk: each hoist pushes exactly one
  // handler onto ctx.handlers (shared by reference across nested renders), so
  // its length gives a per-page sequence that resets for the next page and is
  // deterministic regardless of how many pages were walked before.
  // Namespaced by the owning component so a component's inline lambda and the
  // host page's own `event_1` don't collide once the host hoists both.  A page
  // body keeps the bare `event_<n>` (byte-identical).
  const eventName = ctx.stateOwner
    ? `${snake(ctx.stateOwner)}_event_${ctx.handlers.length + 1}`
    : `event_${ctx.handlers.length + 1}`;
  // Lambda body — either single-expression or block.
  const bodyLines: string[] = [];
  bodyLines.push(`    socket =`);
  if (arg.block) {
    const stmtLines = arg.block.map((s) => renderStmt(s, ctx));
    bodyLines.push(`      socket`);
    for (const line of stmtLines) bodyLines.push(`      ${line}`);
  } else if (arg.body) {
    // Single-expression lambda — typically `() => navigate(...)`.
    const expr = renderExpr(arg.body, { ...ctx, position: "handler" });
    bodyLines.push(`      ${expr}`);
  } else {
    bodyLines.push(`      socket`);
  }
  bodyLines.push(`    {:noreply, socket}`);
  ctx.handlers.push({
    name: eventName,
    paramsPattern: "_params",
    body: bodyLines,
  });
  return eventName;
}

export function renderStmt(stmt: StmtIR, ctx: WalkContext): string {
  switch (stmt.kind) {
    case "assign": {
      // state.field := value  →  |> assign(:field, value)
      // Path's first segment is the state field name.  Delegates
      // the pipe-assign shape to `heexTarget.renderStateWrite`
      // (cross-framework contract — see src/generator/_walker/target.ts).
      // We don't carry the full `StateFieldIR` at this site, so pass
      // a minimal-shape StateRef — the target's `renderStateWrite`
      // consumes only the `.name` slot.  When/if the contract grows
      // a method that consults the field's type, this site threads
      // the full StateFieldIR via `ctx.page.state` lookup.
      const fieldName = stmt.target.segments[0];
      if (!fieldName) return `# bad assign`;
      const value = renderExpr(stmt.value, { ...ctx, position: "handler" });
      const stateRef = {
        field: { name: fieldName, type: { kind: "primitive" as const, name: "string" as const } },
        name: hostStateAssignIfOwned(fieldName, ctx),
      };
      return heexTarget.renderStateWrite(stateRef, value);
    }
    case "let": {
      const value = renderExpr(stmt.expr, { ...ctx, position: "handler" });
      return `|> tap(fn _ -> ${snake(stmt.name)} = ${value} end)`;
    }
    case "expression": {
      const e = renderExpr(stmt.expr, { ...ctx, position: "handler" });
      // If this is a navigate/toast call, route the socket through it.
      if (
        stmt.expr.kind === "call" &&
        (stmt.expr.name === "navigate" || stmt.expr.name === "toast")
      ) {
        return `|> then(fn socket -> ${e} end)`;
      }
      return `|> tap(fn _ -> ${e} end)`;
    }
    case "add":
    case "remove": {
      // `count += 1` / `count -= 1` lower to `add` / `remove` (the same
      // IR kinds collection mutations use).  In a LiveView page handler
      // the only meaningful target is a page-`state` field: emit a
      // pipe-assign whose value reads the field's current handler-scope
      // value (`socket.assigns.<f>`) and either does compound arithmetic
      // (scalar) or list append/remove (collection).  Mirrors the React
      // walker's `emitStmt` add/remove arm, re-shaped to the socket pipe.
      const fieldName = stmt.target.segments[0];
      if (!fieldName) return `# bad ${stmt.kind}`;
      const stateRef = {
        field: { name: fieldName, type: { kind: "primitive" as const, name: "string" as const } },
        name: hostStateAssignIfOwned(fieldName, ctx),
      };
      const rhs = renderExpr(stmt.value, { ...ctx, position: "handler" });
      // Nested target (`order.total += v`) reads the dotted handler path;
      // a single-segment field reads via the state seam.
      const read =
        stmt.target.segments.length === 1
          ? heexTarget.renderStateRead(stateRef, "handler")
          : `socket.assigns.${[stateRef.name, ...stmt.target.segments.slice(1).map((s) => snake(s))].join(".")}`;
      const value = stmt.collection
        ? stmt.kind === "add"
          ? `${read} ++ [${rhs}]`
          : `Enum.reject(${read}, &(&1 == ${rhs}))`
        : `${read} ${stmt.kind === "add" ? "+" : "-"} ${rhs}`;
      return heexTarget.renderStateWrite(stateRef, value);
    }
    case "precondition":
    case "requires": {
      // Guard statement in a handler body → keep the socket when the
      // predicate holds, otherwise flash and halt the rest of the chain.
      // `requires` is an authorization gate (forbidden); `precondition`
      // is a domain check.  Both surface as a server-side flash since a
      // page handler can't raise the way a domain action does.
      const pred = renderExpr(stmt.expr, { ...ctx, position: "handler" });
      // The flash is user-facing, so it never carries the guard's `.ddd`
      // source: a refused gate answers the constant `Forbidden`, a refused
      // precondition its rule's text (a named rule's own, else the generic
      // sentence) — what the REST rungs answer too.  Through the escaping
      // funnel: a translator's override can carry a `#{`.
      const msg = stmt.kind === "requires" ? CONSTANT_FORBIDDEN_DETAIL : floorRuleText(stmt);
      return `|> then(fn socket -> if ${pred}, do: socket, else: put_flash(socket, :error, ${elixirString(msg)}) end)`;
    }
    case "emit": {
      // Broadcast a domain event over Phoenix.PubSub.  No changeset in a
      // page handler, so the struct is built inline and piped via `tap`
      // (the socket flows through unchanged).  Module prefix uses the
      // app module — page handlers don't carry a per-context module.
      const fields = stmt.fields
        .map((f) => `${snake(f.name)}: ${renderExpr(f.value, { ...ctx, position: "handler" })}`)
        .join(", ");
      const moduleName = upperFirst(stmt.eventName);
      return `|> tap(fn _ -> Phoenix.PubSub.broadcast(${ctx.appModule}.PubSub, "events", %${ctx.appModule}.Events.${moduleName}{${fields}}) end)`;
    }
    case "call": {
      if (stmt.target === "store-action" && stmt.store) {
        // `Cart.clear()` / `Cart.add(sku)` from a page/component action body
        // (Stage 5).  A pipe step over the socket: `|> update(:cart, …)`
        // applies the pure store-module fn to the store's per-page assign.
        // (Same-store action→action composition is pure and handled inside the
        // store module; a page calling a store action lands here.)  Record the
        // use so the LiveView emitter seeds the `:cart` assign + alias.
        ctx.usedStores.add(stmt.store);
        const assign = snake(stmt.store);
        const module = upperFirst(stmt.store);
        const fn = snake(stmt.name);
        if (stmt.args.length === 0) {
          return `|> update(:${assign}, &${module}.${fn}/1)`;
        }
        const callArgs = stmt.args
          .map((a) => renderExpr(a, { ...ctx, position: "handler" }))
          .join(", ");
        return `|> update(:${assign}, fn c -> ${module}.${fn}(c, ${callArgs}) end)`;
      }
      if (stmt.target === "action") {
        // Sibling action→action call (Proposal A Stage 1, Fix 1).  LiveView
        // can't cleanly call one `handle_event` clause from another — the
        // callee is a clause, not a callable function that returns a piped
        // socket.  Inline the callee action's body pipe-steps at the call site
        // instead (the same shape the hoist at `walkBodyToHeex` emits), so the
        // socket flows through the callee's effects and back.  This is the
        // HEEx analogue of the JS frontends marking the callee used.
        if (ctx.actionInlineStack?.has(stmt.name)) {
          // Cycle — already inlining this action higher in the chain.  Emit a
          // no-op marker rather than recurse (the validator owns the cycle
          // diagnostic; codegen just must not loop).
          return `|> tap(fn _ -> :ok end) # action '${snake(stmt.name)}' cycle (HEEx)`;
        }
        const callee = ctx.page.actions?.find((a) => a.name === stmt.name);
        if (!callee) {
          // No such action in scope — the validator owns the diagnostic; codegen
          // must not emit a call to a function that does not exist.
          return `|> tap(fn _ -> :ok end) # action '${snake(stmt.name)}' not found`;
        }
        if (callee.body.length === 0) return "|> tap(fn _ -> :ok end)";
        // A PARAMETERISED callee inlines the same way, with its parameters
        // bound to the caller's arguments — rendered here, in the CALLER's
        // scope, and substituted at each `ref` inside the callee body
        // (`ctx.actionArgSubst`).  Elixir has no way to introduce a binding
        // mid-pipe, so substitution is the inline; the arguments are pure
        // expressions, so evaluating them once per use is equivalent.
        const subst = new Map<string, string>();
        callee.params.forEach((p, i) => {
          const arg = stmt.args[i];
          if (arg) subst.set(p.name, renderExpr(arg, { ...ctx, position: "handler" }));
        });
        const innerCtx: WalkContext = {
          ...ctx,
          actionInlineStack: new Set([...(ctx.actionInlineStack ?? []), stmt.name]),
          // Replaces (never merges) the caller's substitutions: the callee's
          // body resolves ITS parameter names, and the arguments that carried
          // the caller's own parameters were already rendered above.
          actionArgSubst: subst,
        };
        return callee.body.map((s) => renderStmt(s, innerCtx)).join("\n      ");
      }
      // `navigate(<Page>)` — the DOCUMENTED navigation shape (docs/actions.md).
      // It is a `private-operation` call, so the bare-call line below would
      // emit `|> tap(fn _ -> navigate(other) end)`: an undefined function AND
      // an unbound `other`, i.e. an Elixir CompileError.  Routed through the
      // SAME resolver the expression position uses; `then/2` gives
      // the mid-pipe socket the `push_navigate(socket, …)` shape needs.
      if (stmt.name === "navigate" && stmt.target === "private-operation") {
        return `|> then(fn socket -> ${renderNavigate(stmt.args, ctx)} end)`;
      }
      // `toast(<msg>)` is the exact twin of the `navigate` case above: also a
      // `private-operation` call, so the bare-call line would emit
      // `|> tap(fn _ -> toast("Saved") end)` — an undefined function, i.e. an
      // Elixir CompileError on a page whose only sin is a documented effect.
      // `then/2` for the same reason: `put_flash/3` RETURNS the new socket, so
      // `tap` would evaluate it and throw the result away even if the function
      // existed.
      if (stmt.name === "toast" && stmt.target === "private-operation") {
        return `|> then(fn socket -> ${renderToastArgs(stmt.args, ctx)} end)`;
      }
      // Bare function / private-operation call statement.  Evaluated for
      // its effect; the socket flows through unchanged via `tap`.
      const args = stmt.args.map((a) => renderExpr(a, { ...ctx, position: "handler" })).join(", ");
      return `|> tap(fn _ -> ${snake(stmt.name)}(${args}) end)`;
    }
    case "return": {
      // Elixir has no `return`; a page handler has no value sink, so the
      // expression is evaluated for effect and the socket flows through.
      const e = renderExpr(stmt.value, { ...ctx, position: "handler" });
      return `|> tap(fn _ -> ${e} end)`;
    }
    case "variant-match":
      // `match await <api>.<Agg>.<op>(args) { … }` (async-actions-and-effects.md
      // Stage 2).  On LiveView the async boundary is server-side, not the
      // client-side await the JS frontends emit: load the route-id record, run
      // the aggregate's returning-op context fn, and `case` on its tagged Result
      // tuple — the SAME `{:ok, v}` / `{:error, "<tag>", data}` shape the
      // returning-op controller action produces (operation-returns-emit), here
      // re-shaped to a socket-piped `then/2` step so each arm threads assigns.
      return renderVariantMatchStmt(stmt, ctx);
    case "if":
      // A plain `if` statement is a BACKEND-body form (node/.NET/java/python).
      // A LiveView handler is a socket pipe-chain, and a page body expresses a
      // condition with `match` or a ternary, so the statement is refused for
      // every frontend by `loom.if-stmt-page-body-unsupported`
      // (ir/validate/checks/if-stmt-checks.ts).  Defensive fail-fast, not a
      // silent drop — unreachable on validated `.ddd`.
      throw new Error(
        `platform: elixir — an \`if\` statement reached the LiveView handler emitter on page ` +
          `'${ctx.page.name}'; it is refused at validation ` +
          `(loom.if-stmt-page-body-unsupported).`,
      );
    default: {
      // EXHAUSTIVENESS — see the twin note on `renderExpr` above.
      const _exhaustive: never = stmt;
      return _exhaustive;
    }
  }
}

/** Extract `{aggregate, operation, args}` from an awaited variant-match subject.
 *  Handles both the api-param-prefixed form (`<api>.<Agg>.<op>(args)`, Pattern
 *  B/A) and the bare-aggregate form (`<Agg>.<op>(args)`, Pattern E/D) — for the
 *  awaited match the aggregate name is all we need (the api handle only selected
 *  the bounded context, which `contextModuleByAggName` already resolves). */
function detectAwaitedOp(
  subject: ExprIR,
): { aggName: string; opName: string; args: ExprIR[] } | null {
  if (subject.kind === "method-call") {
    const aggName = qualifierName(subject.receiver);
    if (aggName) return { aggName, opName: subject.member, args: subject.args };
  }
  if (subject.kind === "member") {
    const aggName = qualifierName(subject.receiver);
    if (aggName) return { aggName, opName: subject.member, args: [] };
  }
  return null;
}

/** The aggregate name a `match await` subject is qualified by: the LAST segment
 *  of the receiver chain, whatever its depth.  `Order` in each of `Order.op()`,
 *  `Api.Order.op()` and any deeper `a.b.Order.op()` qualification — only the
 *  aggregate matters here, since `contextModuleByAggName` already resolves the
 *  bounded context the api handle would have selected. */
function qualifierName(recv: ExprIR): string | null {
  if (recv.kind === "member") return recv.member;
  if (recv.kind === "ref") return recv.name;
  return null;
}

/** Render an awaited `match await <op>() { … }` as a socket-piped `then/2` step.
 *  Mirrors the returning-op controller action (operation-returns-emit): load the
 *  route-id record, run the op's context fn, `case` on the `{:ok, v}` /
 *  `{:error, "<tag>", data}` tuple.  Each arm is a socket pipe-chain; `else` and
 *  any unmatched outcome (`{:error, %Ecto.Changeset{}}`) fall through to the
 *  socket unchanged, keeping the `case` total.
 *
 *  The op is dispatched through `apply/3` on purpose: Elixir 1.18's type checker
 *  narrows a direct cross-module call's result to the op body's inferred variants
 *  and would flag the `{:ok, _}` arm as unreachable for an always-rejecting op
 *  (the exact pitfall the controller sidesteps with a public `_result/2` helper —
 *  operation-returns-emit §"unused clause").  `apply/3` returns `term()`, so
 *  every arm stays reachable under `--warnings-as-errors`. */
function renderVariantMatchStmt(
  stmt: Extract<StmtIR, { kind: "variant-match" }>,
  ctx: WalkContext,
): string {
  // An unrecognised subject must not render a `tap(fn _ -> :ok end)` marker —
  // valid Elixir that silently does nothing at runtime.  Fail at CODEGEN
  // instead: the awaited call is the whole point of the statement, so dropping
  // it is never the right answer.
  const detected = detectAwaitedOp(stmt.subject);
  if (!detected) {
    throw new Error(
      `platform: elixir — a variant \`match\` statement on page '${ctx.page.name}' has a subject the LiveView emitter cannot resolve to an aggregate operation (ExprIR kind '${stmt.subject.kind}'). A LiveView discriminates a union by RUNNING the operation server-side, so the subject must be the awaited call itself: \`match await <Aggregate>.<operation>(…)\` (optionally api-qualified).`,
    );
  }
  const { aggName, opName, args } = detected;
  const agg = ctx.aggregatesByName.get(aggName);
  if (!agg) {
    throw new Error(
      `platform: elixir — \`match await\` on page '${ctx.page.name}' resolves to '${aggName}.${opName}', but '${aggName}' is not an aggregate served by this deployable, so there is no context function to run.`,
    );
  }
  const ctxModule = ctx.contextModuleByAggName.get(aggName) ?? ctx.appModule;
  const aggSnake = snake(aggName);
  const opSnake = snake(opName);
  const op = agg?.operations.find((o) => o.name === opName);
  const hctx: WalkContext = { ...ctx, position: "handler" };
  // op params → string-keyed attrs map (mirrors the controller's
  // `attrs = Map.drop(params, ["id"])`, string keys from the JSON body).
  const params = op?.params ?? [];
  const attrs =
    params.length === 0
      ? "%{}"
      : `%{${params
          .map(
            (p, i) =>
              `${JSON.stringify(snake(p.name))} => ${args[i] ? renderExpr(args[i]!, hctx) : "nil"}`,
          )
          .join(", ")}}`;
  // One `case` clause per arm; the arm body is a socket pipe-chain (empty ⇒ bare
  // `socket`).  `binder`/`snake(binding)` match render-expr's `match-binding`
  // fallback so `o.code` inside the arm resolves to the bound clause var.
  const armClause = (pattern: string, body: readonly StmtIR[]): string => {
    const steps = body.map((s) => renderStmt(s, hctx));
    const piped = steps.length ? ["socket", ...steps].join("\n              ") : "socket";
    return `            ${pattern} ->\n              ${piped}`;
  };
  // Classify each variant by what the aggregate's context declares: a tag
  // declared as an `error` comes back as `{:error, tag, data}`, any other —
  // the aggregate itself, a payload / response, a scalar — as `{:ok, value}`.
  // The lowered `arm.isError` hint is unreliable from a UI body (a
  // context-local `error` type doesn't resolve in the page's lowering env), so
  // the context decides; a `true` hint is honoured too.  Without the context
  // (a caller that threads none) only the aggregate's own tag is a success.
  const bc = ctx.bcByAggregate.get(aggName);
  const isErrorTag = (tag: string): boolean =>
    bc ? bc.payloads.some((p) => p.name === tag && p.kind === "error") : tag !== aggName;
  const clauses = stmt.arms.map((arm) => {
    const tag = variantTag(arm.varType);
    const isError = arm.isError === true || isErrorTag(tag);
    const steps = arm.body.map((s) => renderStmt(s, hctx));
    // Elixir's `--warnings-as-errors` rejects a bound-but-unused pattern var, so
    // prefix the binder with `_` when the arm body never references it (e.g.
    // `Blocked _b -> assign(:message, "blocked")`).
    const raw = arm.binding ? snake(arm.binding) : "_";
    const used = arm.binding ? steps.some((st) => new RegExp(`\\b${raw}\\b`).test(st)) : false;
    const binder = arm.binding && !used ? `_${raw}` : raw;
    // A success variant other than the aggregate is a tagged map
    // (`%{type: "Ok", …}`), so its arm matches on the tag and two success arms
    // stay apart; the aggregate itself comes back as its untagged struct.
    const pattern = isError
      ? `{:error, ${JSON.stringify(tag)}, ${binder}}`
      : tag === aggName
        ? `{:ok, ${binder}}`
        : `{:ok, %{type: ${JSON.stringify(tag)}} = ${binder}}`;
    const piped = steps.length ? ["socket", ...steps].join("\n              ") : "socket";
    return `            ${pattern} ->\n              ${piped}`;
  });
  // Catch-all keeps the inner `case` total (unmatched error variants + the
  // audited-op `{:error, %Ecto.Changeset{}}`): run the `else` body if present,
  // else thread the socket through unchanged.
  clauses.push(armClause("_", stmt.elseBody ?? []));
  const notFoundMsg = JSON.stringify(`${upperFirst(aggName)} not found`);
  return [
    `|> then(fn socket ->`,
    `        case ${ctxModule}.get_${aggSnake}(socket.assigns.id) do`,
    `          {:ok, record} ->`,
    `            case apply(${ctxModule}, :${opSnake}_${aggSnake}, [record, ${attrs}]) do`,
    ...clauses,
    `            end`,
    `          {:error, :not_found} ->`,
    `            put_flash(socket, :error, ${notFoundMsg})`,
    `        end`,
    `      end)`,
  ].join("\n");
}
