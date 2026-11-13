import type { ExprIR } from "../../ir/types/loom-ir.js";
import { snake } from "../../util/naming.js";
import { sourceText } from "../_i18n/source-text.js";
import { sentenceChromeName } from "../_walker/i18n-chrome.js";
import { attrValue, heexChromeAttr, namedArg, testIdAttr } from "./heex-markup.js";
import {
  escapeHeexAttr,
  hostStateAssign,
  indent,
  localizedHeexAttr,
  registerBinding,
  renderChild,
  renderExpr,
  type WalkContext,
} from "./heex-walker-core.js";
import { pgettextCall } from "./i18n.js";

/** The aggregate a `Table` `rows:` / `For` `each:` collection's rows are: a
 *  list QueryView's data param (`rows`), or its server-paged envelope's
 *  `rows.items`. */
function collectionRowType(coll: ExprIR | undefined, ctx: WalkContext): string | undefined {
  if (coll?.kind === "ref") return ctx.listTypes?.get(coll.name);
  if (coll?.kind === "member" && coll.member === "items" && coll.receiver.kind === "ref") {
    return ctx.listTypes?.get(coll.receiver.name);
  }
  return undefined;
}

/** `ctx` with a row lambda's param typed as the collection's row aggregate. */
export function withRowType(
  ctx: WalkContext,
  coll: ExprIR | undefined,
  param: string,
): WalkContext {
  const agg = collectionRowType(coll, ctx);
  return agg ? { ...ctx, rowTypes: new Map([...(ctx.rowTypes ?? []), [param, agg]]) } : ctx;
}

/** `ctx` for one `Column`: its accessor lambda's param is the table's row. */
function withColumnRowType(
  ctx: WalkContext,
  rows: ExprIR | undefined,
  column: Extract<ExprIR, { kind: "call" }>,
): WalkContext {
  const lam = column.args.find(
    (a, i): a is Extract<ExprIR, { kind: "lambda" }> =>
      !column.argNames?.[i] && a.kind === "lambda",
  );
  return lam ? withRowType(ctx, rows, lam.param) : ctx;
}

/** `Table(Column(...), ..., rows: ref("rows"), ...)` →
 *  `<.table id="..." rows={@rows}>` with `<:col :let={row}>` slots. */
export function renderTable(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  let rowsExpr = "@items";
  const cols: ExprIR[] = [];
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (!name) {
      // positional — Column nodes
      cols.push(arg);
    } else if (name === "rows") {
      rowsExpr = renderExpr(arg, { ...ctx, position: "template" });
    }
    // testid handled via the shared helpers below; striped / highlight /
    // sticky / rowTestid / keyExpr — ignored in HEEx (Mantine-specific props;
    // CoreComponents.table doesn't use them)
  }
  // `<.table>` requires an `id` (Phoenix.Component hook contract); reuse
  // `testid:` for it, defaulting to "data-table".  When `testid:` is supplied
  // it ALSO emits as `data-testid` so Playwright/lvtest selectors match TSX.
  // A dynamic `testid:` rides `id={…}` / `data-testid={…}` expression
  // attributes — never quoted literals (see attrValue).
  const testidIdx = (expr.argNames ?? []).indexOf("testid");
  const testidArg = testidIdx >= 0 ? expr.args[testidIdx] : undefined;
  // Without an explicit `testid:`, each table on the page gets its own default
  // id — `data-table`, then `data-table-2`, … — because `<.table>`'s `id` must
  // be unique for LiveView's DOM patching (and for a11y).  The first keeps the
  // bare name, so a single-table page is byte-identical to before.
  const seq = ++ctx.tableSeq.value;
  const idAttr = testidArg ? attrValue(testidArg, ctx) : `"data-table${seq > 1 ? `-${seq}` : ""}"`;
  const testidAttr = testIdAttr(expr, ctx);

  // ---- Interactive controls (HEEx leg) -------------------------------------
  // `sortKey:`/`sortDir:`/`page:`/`filter:` are bare page-state refs;
  // `serverPaged:` + `totalPages:` come from the scaffold's paged `all`
  // QueryView.  Absent args ⇒ every branch below is skipped and the emitted
  // table is byte-identical to before.  There are two modes:
  //
  //  SERVER mode (`serverPaged: true`) — the bound rows are ALREADY the
  //    server's window.  The header buttons and the pager write state, and the
  //    hoisted `handle_event` clauses (liveview-emit.ts) re-run
  //    `list_<agg>s/4` with the new arguments, letting the repository's
  //    whitelisted `ORDER BY` + `LIMIT`/`OFFSET` do the work.
  //
  //  CLIENT mode (`serverPaged:` absent — a document / embedded /
  //    event-sourced / inheritance aggregate's non-paged `find all`, and every
  //    hand-written `Table`) — the bound rows are the WHOLE list, so the
  //    filter, the sort and the page window are applied IN THE TEMPLATE over
  //    the shared `LoomTable` helper module, which is what the four JSX
  //    frontends do in the browser for the very same `.ddd`.  Dropping these
  //    args here would render an unsorted, unpaged, unfiltered table for a
  //    model that sorts, pages and filters everywhere else (the
  //    `sort_key`/`sort_dir`/`page_num` mount assigns alone do nothing
  //    without them).  The refetch the hoisted clause performs is the one
  //    thing client mode must NOT do: `list_<agg>s/0` answers the same rows,
  //    which is why the clauses are emitted reload-less there
  //    (`TableControlBinding.server`).
  const serverPaged = isTrueLit(namedArg(expr, "serverPaged"));
  const sortKey = stateRefArg(expr, "sortKey", ctx);
  const sortDir = stateRefArg(expr, "sortDir", ctx);
  const pageRef = stateRefArg(expr, "page", ctx);
  // A client filter narrows the bound rows; a SERVER-paged table's rows are one
  // server window, so narrowing them would filter that page rather than the
  // result set — the shared walker gates it off the same way (`!serverPaged`),
  // and `loom.table-filter-server-paged` refuses the shape upstream.
  const filterRef = serverPaged ? undefined : stateRefArg(expr, "filter", ctx);
  const pageSize = intArg(expr, "pageSize") ?? 10;
  const helpers = `${ctx.appModule}Web.Components.LoomTable`;

  // Client-side transforms, in the SAME order the shared walker applies them
  // (filter → sort → slice), so both engines page over the same row set.
  let filterMarkup = "";
  // The row set the pager counts: after filtering, before slicing.  Sorting
  // reorders and never changes the count, so it is not in this expression.
  let countBase = rowsExpr;
  if (filterRef !== undefined) {
    ctx.tableHelpersUsed.value = true;
    countBase = `${helpers}.filter_rows(${rowsExpr}, @${filterRef})`;
    filterMarkup = `${renderTableFilterInput(filterRef, ctx)}\n`;
  }
  // A client sort needs a resolvable row field per sortable column — the
  // helper matches the clicked `sort_field` against this whitelist and leaves
  // the rows alone on anything else, so no atom is ever created from client
  // input.  With none resolvable the affordance is not advertised at all
  // (a header that cannot sort is the F2-MT640-SORT-DEAD defect in miniature).
  const sortPairs = serverPaged ? [] : sortableColumnFields(expr);
  const sortActive =
    sortKey !== undefined && sortDir !== undefined && (serverPaged || sortPairs.length > 0);
  let rowsAttr = countBase;
  if (sortActive && !serverPaged) {
    ctx.tableHelpersUsed.value = true;
    rowsAttr = `${helpers}.sort_rows(${countBase}, @${sortKey}, @${sortDir}, ${renderSortWhitelist(sortPairs)})`;
  }
  const pageActive = pageRef !== undefined && (serverPaged || pageSize > 0);
  if (pageActive && !serverPaged) {
    ctx.tableHelpersUsed.value = true;
    rowsAttr = `${helpers}.page_rows(${rowsAttr}, @${pageRef}, ${pageSize})`;
  }
  if (sortActive || pageActive) {
    registerBinding(ctx, ctx.tableControls, {
      sortKey: sortActive ? sortKey : undefined,
      sortDir: sortActive ? sortDir : undefined,
      page: pageActive ? pageRef : undefined,
      server: serverPaged,
    });
  }
  // The active sort feeds the header indicator + `aria-sort`.
  const sortAttrs = sortActive ? ` sort_key={@${sortKey}} sort_dir={@${sortDir}}` : "";

  const rowsArg = namedArg(expr, "rows");
  // A `Column` is numbered among the `Column` calls, any other child by its
  // position among all positionals — the numbering `fallbackColumnNames`
  // catalogues.
  let columnNo = 0;
  const colSlots = cols
    .map((c, i) =>
      c.kind === "call" && c.name === "Column"
        ? renderTableColumn(c, withColumnRowType(ctx, rowsArg, c), sortActive, columnNo++)
        : c.kind === "call"
          ? renderTableColumn(c, ctx, sortActive, i)
          : `<:col :let={_row} label=${heexChromeAttr(ctx, sentenceChromeName("column", String(i + 1)))}>${renderChild(c, ctx)}</:col>`,
    )
    .join("\n");
  const table = [
    `<.table id=${idAttr}${testidAttr}${sortAttrs} rows={${rowsAttr}}>`,
    colSlots.length > 0
      ? indent(colSlots, 2)
      : `  <:col :let={_row} label=${heexChromeAttr(ctx, "dataFallback")}></:col>`,
    `</.table>`,
  ].join("\n");

  // The filter box renders ABOVE the table and the pager BELOW it (HEEx
  // tolerates multiple roots, so no fragment wrapper is needed — the JSX
  // `wrapMultiRoot` seam has no HEEx analogue).  Server mode reads the page
  // count off the envelope's `totalPages`; client mode counts the filtered
  // rows itself, which is what `LoomTable.total_pages/2` exists for.
  const totalPagesArg = namedArg(expr, "totalPages");
  let pager = "";
  if (pageActive && serverPaged && totalPagesArg) {
    pager = `\n<.pager page={@${pageRef}} total_pages={${renderPagedEnvelopeRead(totalPagesArg, ctx)}} />`;
  } else if (pageActive && !serverPaged) {
    ctx.tableHelpersUsed.value = true;
    pager = `\n<.pager page={@${pageRef}} total_pages={${helpers}.total_pages(${countBase}, ${pageSize})} />`;
  }
  return `${filterMarkup}${table}${pager}`;
}

/** The search box a `Table { filter: <state> }` binds, rendered above the
 *  table — the HEEx leg of the shared walker's `renderFilterInput` seam
 *  (`loom.table-filter-unsupported`).
 *
 *  Same shape as every other bound input on this target (`bindStateInput`):
 *  an `<.input>` whose `phx-change` writes the bound assign, with the
 *  write-back clause hoisted once into the host LiveView.  The re-render that
 *  follows re-runs `LoomTable.filter_rows/2` in the template — there is
 *  nothing to refetch, which is why `withQueryReload` leaves this clause alone
 *  (no list read depends on the assign).
 *
 *  The attributes mirror the React seam's (`type="search"`, the `Filter…`
 *  placeholder, `aria-label`, `data-testid="table-filter"`) so one Playwright
 *  selector drives both frontends. */
function renderTableFilterInput(field: string, ctx: WalkContext): string {
  const eventName = `update_${field}`;
  if (!ctx.handlers.some((h) => h.name === eventName)) {
    ctx.handlers.push({
      name: eventName,
      paramsPattern: `%{"${field}" => value}`,
      body: [`    {:noreply, assign(socket, :${field}, value)}`],
    });
  }
  return (
    `<.input type="search" name="${field}" value={@${field}} placeholder="Filter…" ` +
    `aria-label=${heexChromeAttr(ctx, "tableFilterAria")} phx-change="${eventName}" data-testid="table-filter" />`
  );
}

/** Every `sortable:` column's `(wire key, Elixir struct field)` pair, in
 *  declaration order — the whitelist `LoomTable.sort_rows/4` matches the
 *  clicked `sort_field` against.  The two spellings differ: the header sends
 *  the `.ddd` field name (`unitPrice`, what the server path also receives),
 *  while the row is an Ecto struct keyed `:unit_price`. */
function sortableColumnFields(
  expr: Extract<ExprIR, { kind: "call" }>,
): { key: string; field: string }[] {
  const out: { key: string; field: string }[] = [];
  for (const c of expr.args) {
    if (c.kind !== "call" || c.name !== "Column") continue;
    const key = columnSortField(c);
    if (key !== undefined) out.push({ key, field: snake(key) });
  }
  return out;
}

/** `[{"unitPrice", :unit_price}, {"sku", :sku}]` — an Elixir list literal. */
function renderSortWhitelist(pairs: readonly { key: string; field: string }[]): string {
  return `[${pairs.map((p) => `{"${p.key}", :${p.field}}`).join(", ")}]`;
}

/** An integer-literal named arg (`pageSize: 10`), or undefined. */
function intArg(expr: Extract<ExprIR, { kind: "call" }>, name: string): number | undefined {
  const arg = namedArg(expr, name);
  if (arg?.kind !== "literal") return undefined;
  const n = Number(arg.value);
  return Number.isFinite(n) ? n : undefined;
}

/** Read a field off the paged envelope (`rows.totalPages` → `@items.totalPages`).
 *
 *  The envelope is a plain map whose keys are the CAMELCASE wire names every
 *  backend agrees on (`items` / `page` / `pageSize` / `total` / `totalPages` —
 *  see the repository emitter), NOT snake-cased Elixir idiom.  The generic
 *  member-access renderer snake-cases, which would emit `@items.total_pages`
 *  and raise a `KeyError` at render time, so the field name is preserved
 *  verbatim here and only the receiver goes through `renderExpr`. */
function renderPagedEnvelopeRead(arg: ExprIR, ctx: WalkContext): string {
  if (arg.kind === "member") {
    const receiver = renderExpr(arg.receiver, { ...ctx, position: "template" });
    return `${receiver}.${arg.member}`;
  }
  return renderExpr(arg, { ...ctx, position: "template" });
}

/** True when a named arg is the boolean literal `true`. */
function isTrueLit(arg: ExprIR | undefined): boolean {
  return arg?.kind === "literal" && arg.value === "true";
}

/** Read a named arg that must be a bare page-state reference (`sortKey:
 *  sortKey`), returning the snake-cased assign name.  Undefined when the arg is
 *  absent, isn't a plain ref, or doesn't name a declared `state {}` field — the
 *  last guard keeps a hand-written `Table(page: someLocal)` from emitting a
 *  `@some_local` that no assign backs. */
function stateRefArg(
  call: Extract<ExprIR, { kind: "call" }>,
  name: string,
  ctx: WalkContext,
): string | undefined {
  const arg = namedArg(call, name);
  if (arg?.kind !== "ref") return undefined;
  const assign = snake(arg.name);
  return ctx.stateNames.has(assign) ? hostStateAssign(ctx.stateOwner, arg.name) : undefined;
}

/** Render a `Column("label", accessor_lambda)` node as a
 *  `<:col :let={row} label="...">...</:col>` slot.  Called only from
 *  `renderTable` — never registered as a top-level primitive because
 *  Column nodes are always children of Table in the expander output. */
function renderTableColumn(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
  /** True when the enclosing Table carries an active `sortKey:`/`sortDir:`
   *  pair.  Only then does a `sortable:` column emit `sort_field`, which is
   *  what turns its header into a `phx-click="loom-sort"` button. */
  sortActive = false,
  /** 0-based position in the enclosing Table, for the `Column N` fallback
   *  header a non-literal label gets (see below). */
  index = 0,
): string {
  if (expr.name !== "Column") {
    // Unexpected shape — emit a stub slot.
    return `<:col :let={_row} label=${heexChromeAttr(ctx, sentenceChromeName("column", String(index + 1)))}>${renderChild(expr, ctx)}</:col>`;
  }
  // First positional arg: label string
  // Second positional arg: accessor lambda `fn cell -> renderCell(cell) end`
  //
  // The header is a STATIC attribute on the `<:col>` slot, so only a string
  // LITERAL can supply it, and it must be entity-escaped: an unescaped label
  // carrying a `"` closes the attribute mid-word (`label="Na"me"`) and the
  // whole template fails to parse.  A non-literal header (a state ref, a
  // concatenation) has no attribute spelling at all — splicing the rendered
  // Elixir expression inside the quotes (`label="@q"`) heads the column with a
  // variable name.  Both degrade to the JSX side's
  // `Column N` fallback (`_walker/primitives/table.ts`'s `emitColumn`), so the
  // two frontends show the same header for the same source.
  let cellHeex = "<%= row %>";
  const lambdaArg = expr.args.find((a, i) => !expr.argNames?.[i] && a.kind === "lambda");
  const positionals = expr.args.filter((_, i) => !expr.argNames?.[i]);
  const labelArg = positionals[0];
  const isLiteralLabel = labelArg?.kind === "literal" && labelArg.lit === "string";
  const label = isLiteralLabel
    ? labelArg.value
    : labelArg?.kind === "modelText"
      ? sourceText(labelArg.key, labelArg.defaultText)
      : "";
  // The header is a user-visible slot (`columnHeader`): a plain literal
  // rides `pgettext` through the `{…}` expression-attribute form the `<:col>`
  // slot's `label` takes.  Off i18n it is the quoted literal — byte-identical.
  // A NON-literal header keeps the escaped `Column N` fallback (HEEx has no
  // attribute interpolation for an arbitrary expression here).
  // A `label(…)` header is identity-keyed (`<Ctx>.<Type>.field.<f>`), not
  // role-keyed: under i18n it rides the same `{pgettext(…)}` attribute form.
  const labelAttrValue = isLiteralLabel
    ? localizedHeexAttr(labelArg, ctx, "columnHeader")
    : labelArg?.kind === "modelText" && ctx.i18nPrefix
      ? `{${pgettextCall(labelArg.key, labelArg.defaultText)}}`
      : labelArg?.kind === "modelText"
        ? undefined
        : heexChromeAttr(ctx, sentenceChromeName("column", String(index + 1)));
  const accessor = lambdaArg ?? positionals[1];
  if (accessor && accessor.kind === "lambda" && accessor.body) {
    // The row variable is a :let={o} slot binding — a local variable, NOT
    // a LiveView assign.  Do NOT add it to stateNames (which would give
    // it an `@` prefix).  The renderRef fall-through for "unknown" refKind
    // returns bare `snake(name)`, which is exactly what we want inside the
    // <:col :let={o}> slot.
    cellHeex = renderChild(accessor.body, ctx);
  }
  // A `sortable:` column sorts by its explicit `field:`, else by the accessor's
  // member (`o => o.name` → `"name"`) — the same resolution the JSX
  // `emitColumn` does.  A column whose field can't be resolved stays a plain
  // (unsortable) header rather than emitting a sort key the server can't map.
  const sortField = sortActive ? columnSortField(expr) : undefined;
  const sortAttr = sortField ? ` sort_field="${sortField}"` : "";
  const labelAttr = labelAttrValue ? `label=${labelAttrValue}` : `label="${escapeHeexAttr(label)}"`;
  return `<:col :let={${renderColLetVar(accessor, ctx)}} ${labelAttr}${sortAttr}>${cellHeex}</:col>`;
}

/** The field a `sortable:` Column sorts by: the explicit `field:` string arg,
 *  else the accessor lambda's simple member (`o => o.sku` → `"sku"`).
 *  Undefined for a non-sortable column or an accessor too complex to map. */
function columnSortField(expr: Extract<ExprIR, { kind: "call" }>): string | undefined {
  if (!isTrueLit(namedArg(expr, "sortable"))) return undefined;
  const fieldArg = namedArg(expr, "field");
  if (fieldArg?.kind === "literal" && fieldArg.lit === "string") return fieldArg.value;
  const accessor = expr.args.find((a, i) => !expr.argNames?.[i] && a.kind === "lambda");
  if (accessor?.kind === "lambda" && accessor.body?.kind === "member") {
    const body = accessor.body;
    if (body.receiver.kind === "ref") return body.member;
  }
  return undefined;
}

/** Extract the row variable name from a Column accessor lambda for the
 *  `:let={row}` binding.  Falls back to `"row"` when shape is unexpected. */
function renderColLetVar(accessor: ExprIR | undefined, _ctx: WalkContext): string {
  if (accessor && accessor.kind === "lambda") return snake(accessor.param);
  return "row";
}
