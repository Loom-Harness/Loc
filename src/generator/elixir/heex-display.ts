// ---------------------------------------------------------------------------
// The display primitives whose HEEx reads an assign the LiveView loads:
// `IdLink` (the `@<agg>_labels` map), `FileLink`, `ProvenanceInfo`,
// `Timeline`, `FileUpload` (`allow_upload/3`), `Chart` (a projection assign
// plotted by `LoomChart`), and an `EnumBadge`'s label lookup.  `heexTarget`
// reaches each through its whole-primitive seam.
// ---------------------------------------------------------------------------

import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { snake } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import { tryDetectApiHook } from "../_walker/api-hook-detector.js";
import { giveUpText } from "../_walker/give-up.js";
import { simpleAccessorField } from "../_walker/primitives/data-grid-shape.js";
import { heexChromeAttr, heexChromeText, namedArg, testIdAttr } from "./heex-markup.js";
import { enumLabelLookup } from "./heex-model-text.js";
import {
  escapeHeexAttr,
  hostStateAssign,
  registerBinding,
  renderExpr,
  renderInTemplate,
  type WalkContext,
} from "./heex-walker-core.js";

/** `IdLink(value, of: Aggregate)` → `<.link navigate={...}>value</.link>`.
 *
 *  Null-guarded when the reference is OPTIONAL (`lastKnownLocation: Location
 *  id?`), like the six JSX-family targets (`_walker/primitives/id-link.ts`):
 *  an absent reference renders an em dash and no link, rather than
 *  `~p"/locations/#{nil}"` — a link to `/locations/` (L1-E / E6, #2885).  A
 *  REQUIRED reference stays byte-identical. */
export function renderIdLink(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  let aggName = "";
  let target = "";
  const positionals = expr.args.filter((_, i) => !expr.argNames?.[i]);
  const valueExpr = positionals[0];
  let valueHeex = valueExpr ? renderInTemplate(valueExpr, ctx) : "";
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (name === "of" && arg.kind === "ref") {
      target = arg.name;
      aggName = routeSegmentFor(arg.name);
    }
  }
  const testidAttr = testIdAttr(expr, ctx);
  if (aggName && valueExpr) {
    const idVal = renderExpr(valueExpr, { ...ctx, position: "template" });
    // The link TEXT is the target's `display` when its façade serves the batch
    // label seam — the LiveView loads `@<x>_labels` (one query per page,
    // `ref-label.ts`).  An id the map lacks falls back to the id itself.
    // A link from the row's OWN id (`IdLink(row.id, of: Self)`, the list's ID
    // column) keeps the id — the label already has its own column.
    const selfId = valueExpr.kind === "member" && valueExpr.member === "id";
    if (!selfId && ctx.refLabelTargets?.has(target)) {
      ctx.refLabelBindings.add(target);
      valueHeex = `<%= Map.get(@${snake(target)}_labels, ${idVal}) || ${idVal} %>`;
    }
    const link = `<.link navigate={~p"/${aggName}/#{${idVal}}"}${testidAttr}>${valueHeex}</.link>`;
    if (!isOptionalReference(valueExpr, target, ctx)) return link;
    return `<%= if ${idVal} do %>${link}<% else %><span${testidAttr}>—</span><% end %>`;
  }
  return `<span${testidAttr}>${valueHeex}</span>`;
}

/** Whether an `IdLink`'s value reads a field the model declares as an
 *  OPTIONAL reference to `ofAggregate`.
 *
 *  The IR does not type a page body's record chain (a row binding's
 *  `o.last_known_location` carries the placeholder `string`), and the HEEx
 *  walk context carries no row-binding → aggregate map the way the JSX walker's
 *  does.  So the member name is resolved against the model instead: the value
 *  is optional when some aggregate or part declares a field of that name typed
 *  `<ofAggregate> id?`.  A false positive only adds a guard whose else-arm never
 *  runs; a value that is not a member read (a route param, a literal) is
 *  treated as required, which is the output this primitive always emitted. */
function isOptionalReference(valueExpr: ExprIR, ofAggregate: string, ctx: WalkContext): boolean {
  if (valueExpr.kind !== "member" || !ofAggregate) return false;
  const isOptionalRef = (t: TypeIR): boolean =>
    t.kind === "optional" && t.inner.kind === "id" && t.inner.targetName === ofAggregate;
  for (const agg of ctx.aggregatesByName.values()) {
    const shapes = [agg.fields, ...agg.parts.map((p) => p.fields)];
    for (const fields of shapes) {
      if (fields.some((f) => f.name === valueExpr.member && isOptionalRef(f.type))) return true;
    }
  }
  return false;
}

/** `FileLink(<file-ref>)` → a plain download anchor for a `File` field.  The
 *  `File` wire value is a JSON map (`%{"url" => …, "key" => …}`, string keys —
 *  Ecto `:map`), so `url`/`key` read via bracket access.  Null-guarded: an
 *  optional `File?` that is `nil` renders an em-dash (a required `File` is
 *  always truthy). */
export function renderFileLink(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  const testidAttr = testIdAttr(expr, ctx);
  const positionals = expr.args.filter((_, i) => !expr.argNames?.[i]);
  const valueArg = namedArg(expr, "value") ?? positionals[0];
  if (!valueArg) return `<span${testidAttr}>—</span>`;
  const recv = renderExpr(valueArg, { ...ctx, position: "template" });
  return `<%= if ${recv} do %><a href={${recv}["url"]} download${testidAttr}><%= ${recv}["key"] %></a><% else %><span>—</span><% end %>`;
}

/** `ProvenanceInfo(of: <record>, field: "<name>")` → a native `<details>`
 *  disclosure over the co-located `<field>_provenance` lineage (the "?" that
 *  reveals where a provenanced value came from — docs/provenance.md).
 *
 *  Unlike the JSX frontends — which consume a camelCase JSON wire — the LiveView
 *  renders SERVER-SIDE straight from the Ecto struct.  The co-located jsonb
 *  column (`schema-emit.ts`, `<field>_provenance` via the pass-through
 *  `Provenance.Json` type) loads as a STRING-keyed map, so the lineage reads via
 *  bracket access: `snapshotId` (rule), `computedValue`, and the `inputs` list
 *  (each `path` = `value`) — the SAME camelCase member names
 *  `renderProvenancedAssign` stores and the JSON wire carries (RS-1/RS-18; the
 *  members were snake_case here until the elixir wire-golden leg showed the
 *  divergence, and this reader had to move with them).  Null-guarded with
 *  `<%= if … %>`: an un-provenanced row (column `nil`) renders nothing, so the
 *  value still shows on its own.  The `inputs` fan-out is a `for`-comprehension
 *  (LiveView's list idiom) rather than the JS `.map` — the topology divergence
 *  that keeps this a parallel HEEx renderer, not the shared walker. */
export function renderProvenanceInfo(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): string {
  const recordArg = namedArg(expr, "of");
  const fieldArg = namedArg(expr, "field");
  if (!recordArg || fieldArg?.kind !== "literal") {
    return `<!-- ${giveUpText("loom.page-primitive-arg-missing", "ProvenanceInfo: missing record or field")} -->`;
  }
  const record = renderExpr(recordArg, { ...ctx, position: "template" });
  // `<field>_provenance` — snake_cased to match `provColumn` / the schema field.
  const lineage = `${record}.${snake(fieldArg.value)}_provenance`;
  const testid = testIdAttr(expr, ctx);
  return [
    `<%= if ${lineage} do %>`,
    `  <details class="loom-provenance"${testid}>`,
    `    <summary aria-label=${heexChromeAttr(ctx, "provenanceHowComputed")}>?</summary>`,
    `    <dl class="loom-provenance-tree">`,
    `      <div><dt>${heexChromeText(ctx, "provenanceRule")}</dt><dd><code><%= ${lineage}["snapshotId"] %></code></dd></div>`,
    `      <div><dt>${heexChromeText(ctx, "provenanceValue")}</dt><dd><%= ${lineage}["computedValue"] %></dd></div>`,
    `      <%= for inp <- ${lineage}["inputs"] || [] do %>`,
    `        <div><dt><%= inp["path"] %></dt><dd><%= inp["value"] %></dd></div>`,
    `      <% end %>`,
    `    </dl>`,
    `  </details>`,
    `<% end %>`,
  ].join("\n");
}

/** `Timeline(of: <entries>)` → the entity's audit trail as an ordered list
 *  (docs/audit.md).  The HEEx twin of the JSX renderers: same markup, same
 *  semantics, so a Phoenix app shows the history a React one does.
 *
 *  Entries cross the wire as string-keyed maps, hence `e["action"]` rather than
 *  `e.action`. */
export function renderTimeline(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  const entriesArg = namedArg(expr, "of") ?? expr.args.find((_, i) => !expr.argNames?.[i]);
  if (!entriesArg)
    return `<!-- ${giveUpText("loom.page-primitive-arg-missing", "Timeline: missing entries")} -->`;
  const entries = renderExpr(entriesArg, { ...ctx, position: "template" });
  const testid = testIdAttr(expr, ctx);
  return [
    `<ol class="loom-timeline"${testid}>`,
    `  <%= for e <- ${entries} || [] do %>`,
    `    <li class="loom-timeline-entry">`,
    `      <span class="loom-timeline-action"><%= e["action"] %></span>`,
    `      <time datetime={to_string(e["at"])}><%= e["at"] %></time>`,
    `      <%= if e["actor"] do %>`,
    `        <span class="loom-timeline-actor"><%= e["actor"] %></span>`,
    `      <% end %>`,
    `      <%= if (e["changes"] || []) != [] do %>`,
    `        <dl class="loom-timeline-changes">`,
    `          <%= for c <- e["changes"] || [] do %>`,
    `            <div>`,
    `              <dt><%= c["field"] %></dt>`,
    `              <dd><%= c["before"] || "\u2014" %> \u2192 <%= c["after"] || "\u2014" %></dd>`,
    `            </div>`,
    `          <% end %>`,
    `        </dl>`,
    `      <% end %>`,
    `    </li>`,
    `  <% end %>`,
    `</ol>`,
  ].join("\n");
}

/** The translated-label lookup of an `EnumBadge` value whose enum is known —
 *  the member's resolved type, else (a table row binding, whose member types
 *  are not resolved) the field's declared type on the row's aggregate. */
function enumBadgeLookup(
  value: Extract<ExprIR, { kind: "member" }>,
  ctx: WalkContext,
): string | undefined {
  const unwrap = (t: TypeIR | undefined): TypeIR | undefined =>
    t?.kind === "optional" ? unwrap(t.inner) : t;
  let enumName: string | undefined;
  const typed = unwrap(value.memberType);
  if (typed?.kind === "enum") enumName = typed.name;
  else if (value.receiver.kind === "ref") {
    const aggName =
      ctx.instanceTypes?.get(value.receiver.name) ?? ctx.rowTypes?.get(value.receiver.name);
    const rowAgg = aggName ? ctx.aggregatesByName.get(aggName) : undefined;
    const declared = unwrap(rowAgg?.fields.find((f) => f.name === value.member)?.type);
    if (declared?.kind === "enum") enumName = declared.name;
  }
  if (!enumName) return undefined;
  return enumLabelLookup(ctx, enumName, renderExpr(value, { ...ctx, position: "template" }));
}

/** The text an `EnumBadge` shows for `value`: under i18n an enum member read
 *  resolves to its translated display label, anything else renders as a
 *  template slot. */
export function heexEnumBadgeText(value: ExprIR, ctx: WalkContext): string {
  const lookup =
    value.kind === "member" && ctx.i18nPrefix ? enumBadgeLookup(value, ctx) : undefined;
  return lookup ? `<%= ${lookup} %>` : renderInTemplate(value, ctx);
}

/** `FileUpload { "Label", bind: <File state> }` → a LiveView-native file input.
 *
 *  Unlike the JSX frontends (which POST the file to `/files` and bind the
 *  returned FileRef), Phoenix has no such endpoint — LiveView streams uploads
 *  over its own channel.  So this renders the idiomatic `allow_upload` flow: a
 *  `<.live_file_input>` inside a `phx-change` form, an `allow_upload/3` seeded
 *  in `mount/3` (with `auto_upload: true`), and a `handle_<field>_progress/3`
 *  consumer that persists the completed entry and assigns the resulting FileRef
 *  map (`%{ "url", "key", "contentType", "size" }` — the wire FileRef shape)
 *  into the bound `:<field>` page-state assign.  The `allow_upload` +
 *  progress-consumer emission is driven by the `UploadBinding` this pushes onto
 *  `ctx.uploadBindings` (consumed in liveview-emit.ts); the `phx-change`
 *  validate handler (required for a live-file-input form) is hoisted here the
 *  same way `bindStateInput` hoists its write-back clause.
 *
 *  An unbound (or non-`File`-state) `bind:` renders a disabled plain file input
 *  — there's nothing to two-way bind to — mirroring the unbound `<.input>` stub. */
export function renderFileUpload(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): string {
  let labelArg: ExprIR | undefined;
  let bind: string | undefined;
  let seenPositional = false;
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (!name) {
      if (!seenPositional) labelArg = arg;
      seenPositional = true;
    } else if (name === "bind" && arg.kind === "ref") bind = arg.name;
  }
  // The label is a user-visible slot (`inputLabel`) — rendered in TEXT
  // position here (the `<label>` wraps the input), so it rides `renderInTemplate`,
  // which yields `<%= pgettext(…) %>` under i18n and the escaped literal off it.
  const labelText = labelArg ? renderInTemplate(labelArg, ctx, "inputLabel") : "";
  const testidAttr = testIdAttr(expr, ctx);
  const bound = bind ? snake(bind) : undefined;
  if (!bound || !ctx.stateNames.has(bound)) {
    // Nothing to two-way bind to — a disabled plain file input, so the page
    // still renders (validators catch a genuinely-unresolvable bind upstream).
    return `<label class="block text-sm font-medium">${labelText}<input type="file" disabled${testidAttr} /></label>`;
  }
  // The host assign the FileRef is written into: a component's lifted state is
  // namespaced (`hostStateAssign`), a page's keeps its bare name.
  const field = hostStateAssign(ctx.stateOwner, bound);
  // One allow_upload / progress consumer per bound field (mount + module body).
  if (!ctx.uploadBindings.some((u) => u.field === field)) {
    registerBinding(ctx, ctx.uploadBindings, { field });
  }
  // A live-file-input form must carry a `phx-change`; hoist the (no-op) clause
  // once per field.  `phx-submit` reuses it so an accidental Enter can't trigger
  // a native (page-navigating) submit.
  const validateEvent = `validate_${field}`;
  if (!ctx.handlers.some((h) => h.name === validateEvent)) {
    ctx.handlers.push({
      name: validateEvent,
      paramsPattern: "_params",
      body: [`    {:noreply, socket}`],
    });
  }
  return [
    `<form phx-change="${validateEvent}" phx-submit="${validateEvent}" class="loom-file-upload">`,
    `  <label class="block text-sm font-medium">`,
    labelText ? `    ${labelText}` : "",
    `    <.live_file_input upload={@uploads.${field}}${testidAttr} />`,
    `  </label>`,
    `</form>`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** `Chart { kind: "bar"|"line", of: <api>.<Projection>, x: r => …, y: r => … }`
 *  → a call into the generated `LoomChart.chart/1` function component.
 *
 *  The JSX targets reach a charting LIBRARY through the design pack
 *  (`@mantine/charts`, recharts, `@mui/x-charts`).  LiveView has no such
 *  library — and needs none: the rows are ALREADY on the server, in an assign,
 *  so the geometry is arithmetic and the chart is inline SVG, server-rendered
 *  and JS-free.  (The parity ledger long carried "no JS-free LiveView charting"
 *  as the reason Phoenix had no Chart; the premise was simply wrong.)
 *
 *  Emission is a component CALL rather than inline markup for the same reason
 *  the projection loader is a function: the scale/axis maths is Elixir, and
 *  HEEx is a markup template — computing a max and a per-bar rect in `<% %>`
 *  blocks inside the page body would be both unreadable and untestable.  The
 *  component is emitted once per deployable (`renderLoomChartComponent`,
 *  liveview-emit.ts) and invoked fully qualified, the same way a user
 *  `component` is.
 *
 *  The data binding rides the SAME projection QueryBinding a `QueryView` push —
 *  so the page gets its `defp load_<proj>/1`, and the chart reads the assign. */
export function renderChart(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  const names = expr.argNames ?? [];
  const at = (name: string): ExprIR | undefined => {
    const i = names.indexOf(name);
    return i >= 0 ? expr.args[i] : undefined;
  };
  const kindArg = at("kind");
  // `loom.chart-kind-invalid` pins the kind to "line" | "bar"; the bar default
  // only keeps the renderer total under IR that skipped validation.
  const isLine = kindArg?.kind === "literal" && kindArg.value === "line";
  const ofArg = at("of");

  // Pattern H, exactly as `renderQueryView` resolves it — one detector, so a
  // chart and a query view can't disagree about what `<api>.<Proj>` means.
  const detected = ofArg
    ? tryDetectApiHook(ofArg, {
        apiParamNames: new Set(ctx.ui.apiParams.map((p) => p.name)),
        aggregatesByName: ctx.aggregatesByName,
        projectionsByName: ctx.projectionsByName,
      })
    : null;
  const projection = detected?.kind === "projection" ? detected.aggregateName : undefined;
  if (!projection) {
    // Unreachable from valid input — `loom.chart-of-not-grouped` (ui-checks)
    // rejects any `of:` that isn't a grouped readable projection.
    return `<%!-- ${giveUpText("loom.page-ref-unreachable", "Chart: unresolved 'of:' projection")} --%>`;
  }
  const assign = snake(projection);
  registerBinding(ctx, ctx.queryBindings, {
    kind: "list",
    assign,
    aggregate: projection,
    source: "projection",
  });
  ctx.chartUsed.value = true;

  // `x:`/`y:` unwrap to accessor field names through the SAME leaf the TSX emit
  // and a `DataGrid` `Column` use, then to the SNAKE keys the projection loader
  // rekeys the wire row to (`orderCount` → `:order_count`) — the component
  // reads them with `Map.get/2`.
  const dataKey = snake(simpleAccessorField(at("x")) ?? "");
  const seriesField = snake(simpleAccessorField(at("y")) ?? "");

  // A chart is an image of data (registry a11y contract `role="img"` +
  // `needsName`), so the component carries a derived accessible name — the same
  // sentence the TSX emit derives, so the two frontends read alike to a screen
  // reader.
  const label = `${isLine ? "Line" : "Bar"} chart of ${projection}: ${seriesField} by ${dataKey}`;
  const testid = testIdAttr(expr, ctx).replace(/^ data-testid=/, "");
  const testidAttr = testid ? ` testid=${testid}` : "";
  return (
    `<${ctx.appModule}Web.Components.LoomChart.chart` +
    ` kind="${isLine ? "line" : "bar"}"` +
    ` rows={@${assign}}` +
    ` x={:${dataKey}}` +
    ` y={:${seriesField}}` +
    ` label="${escapeHeexAttr(label)}"${testidAttr} />`
  );
}
