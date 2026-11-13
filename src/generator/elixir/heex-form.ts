// ---------------------------------------------------------------------------
// The LiveView forms: `CreateForm` / `OperationForm` / `WorkflowForm` bind an
// Ecto changeset in `mount` and post to a hoisted `handle_event`;
// `DestroyForm` is a confirm-delete button over the destroy context function;
// a standalone input (`Field`, `Toggle`, …) writes its bound state assign back
// through a `phx-change` handler.  `heexTarget` reaches these through its
// form, destroy-form and `bindEventHandler` seams.
// ---------------------------------------------------------------------------

import { createInputFields } from "../../ir/enrich/wire-projection.js";
import type {
  BoundedContextIR,
  EnumIR,
  ExprIR,
  TypeIR,
  ValueObjectIR,
} from "../../ir/types/loom-ir.js";
import { canonicalDestroy } from "../../ir/util/canonical-lifecycle.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { elixirString, humanize, snake } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import { sourceText } from "../_i18n/source-text.js";
import { giveUpText } from "../_walker/give-up.js";
import { sentenceChromeName } from "../_walker/i18n-chrome.js";
import { workflowRunEntry } from "../_walker/model-text-sites.js";
import type { InputControl } from "../_walker/target.js";
import {
  heexChrome,
  heexChromeAttr,
  heexChromeText,
  labelText,
  testIdAttr,
} from "./heex-markup.js";
import { enumOptionTuples, fieldLabelCall, homeOf, opLabelCall } from "./heex-model-text.js";
import {
  escapeHeexAttr,
  escapeHeexText,
  hostStateAssign,
  registerBinding,
  renderExpr,
  type WalkContext,
} from "./heex-walker-core.js";
import { pgettextCall } from "./i18n.js";

/** `CreateForm(of: Agg, testid: "...", ...)` → `<.simple_form>` with auto
 *  inputs derived from the aggregate/workflow args.
 *  `runs: Wf` (workflow form) also emits a `<.simple_form>` but
 *  tied to the workflow action name. */
export function renderForm(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  // `OperationForm(<instance>.<operation>)` is the operation-modal form —
  // owned and rendered by `renderModal` (it consumes its Form child
  // directly).  This guard makes the function total if a stray
  // op-form is ever reached without its Modal wrapper: bail before
  // pushing a bogus `kind:"aggregate"` create binding.
  //
  // It IS reachable: `QueryView { of: X.Agg.all, single: true, data: row =>
  // OperationForm { row.<op> } }` hands the op-form straight here with no
  // Modal.  Returning "" would render an EMPTY `true ->` arm — a blank panel
  // that reads as "there is nothing here".  Every other target that cannot
  // render this shape says so in the output (Flutter emits
  // `const SizedBox.shrink() /* OperationForm(row.<op>): … */`), so HEEx emits
  // a marker too.  The marker is the honest minimum until the standalone
  // instance op-form is rendered on LiveView (it needs the `handle_event` +
  // form-binding half `renderModal` owns, so it is a feature, not a seam fix).
  const positional0 = expr.args.find((_, i) => !expr.argNames?.[i]);
  if (positional0 && positional0.kind === "member") {
    const opName = positional0.member;
    return `<%!-- ${giveUpText(
      "loom.page-primitive-target-gap",
      `OperationForm(<instance>.${opName}): the instance-qualified shape is only rendered ` +
        `inside a Modal on Phoenix LiveView — use OperationForm { of: <Agg>, op: ${opName} }`,
    )} --%>`;
  }
  let ofTarget = "";
  let runsTarget = "";
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (name === "of") {
      ofTarget =
        arg.kind === "ref" ? snake(arg.name) : renderExpr(arg, { ...ctx, position: "template" });
    } else if (name === "runs") {
      runsTarget =
        arg.kind === "ref" ? snake(arg.name) : renderExpr(arg, { ...ctx, position: "template" });
    }
  }
  const submitEvent = ofTarget ? `save_${ofTarget}` : runsTarget ? `run_${runsTarget}` : "submit";
  const testidAttr = testIdAttr(expr, ctx);
  // The form's testid is also the NAMESPACE its controls hang off — the
  // emitted Playwright page objects address `<ns>-input-<field>` and
  // `<ns>-submit` (see `page-objects-emit.ts`), and until the HEEx UI
  // behavioural leg ran one of those specs nothing had noticed that the HEEx
  // form emitted neither.  Only a LITERAL testid can be concatenated.
  const testidNs = literalTestid(expr);
  // Register a form binding so the LiveView emitter can assign @form
  // in mount/3.  We track the PascalCase name; emitter handles
  // module-name resolution against contexts + workflows.
  const ofPascal = findPascalArg(expr, "of");
  const runsPascal = findPascalArg(expr, "runs");
  // A WORKFLOW form's fields are the workflow's command-triggered `create`
  // params (`WorkflowIR.params`, the same list the TSX `emitFormRuns` reads).
  // Carried on the binding so `liveview-emit.ts` can both seed `@form` under
  // the workflow's own `as:` prefix and destructure the submitted params in the
  // `handle_event("run_<wf>", …)` clause.  Without that clause
  // `phx-submit="run_<wf>"` raises `FunctionClauseError` and kills the LiveView.
  const runsWorkflow = runsPascal ? ctx.workflowsByName.get(runsPascal) : undefined;
  // An event-only saga (`create(e: Event) by …`) has no command surface — the
  // backend emits no `run/2` for it (`emitsCommandRoute`) — so there is
  // nothing for `phx-submit` to call.  Same give-up as the shared walker.
  if (runsWorkflow && !emitsCommandRoute(runsWorkflow)) {
    return `<%!-- ${giveUpText("loom.page-ref-unreachable", `WorkflowForm(runs: ${runsWorkflow.name}): an event-triggered workflow has no command route to submit to`)} --%>`;
  }
  if (ofPascal) {
    registerBinding(ctx, ctx.formBindings, { kind: "aggregate", name: ofPascal });
  } else if (runsPascal) {
    registerBinding(ctx, ctx.formBindings, {
      kind: "workflow",
      name: runsPascal,
      ...(runsWorkflow ? { params: runsWorkflow.params } : {}),
    });
  }
  // Field inputs — derive one <.input> per user-input field on the
  // bound aggregate.  Excludes the `id` primary key (auto-generated on
  // insert).  Falls back to a single labelled placeholder if
  // the aggregate isn't in the registry — keeps the form well-formed
  // even when scaffold expansion hands us a Form referencing a name
  // the walker can't resolve (shouldn't happen in practice; the
  // validator catches unknowns upstream, but the fallback keeps the
  // emitter total).
  const inputs: string[] = [];
  if (runsWorkflow) {
    // One `<.input>` per workflow param, typed by `renderFieldInputForField`
    // exactly as an aggregate create form's fields are, so HEEx and React ask
    // the user for the same data from the same `.ddd`.
    for (const pparam of runsWorkflow.params) {
      inputs.push(
        `  ${renderFieldInputForField(
          pparam,
          "form",
          ctx.enumsByName,
          ctx.idOptionsBindings,
          ctx.valueObjectsByName,
          "@",
          testidNs ? `${testidNs}-input-${pparam.name}` : undefined,
          { ctx, home: undefined, owner: runsWorkflow.name },
        )}`,
      );
    }
  } else if (ofPascal) {
    const agg = ctx.aggregatesByName.get(ofPascal);
    if (agg) {
      // Render the create-input contract (`createInputFields`), not raw
      // `agg.fields` — server-owned fields (`managed`/`token`/`internal`,
      // incl. `stamp` targets promoted by `promoteStampTargets`) must not
      // surface as client inputs; the LiveView save path stamps them at
      // persist.  Unlike the JS `CreateForm`, optionals stay rendered —
      // the HEEx form has no update flow to defer them to.
      for (const f of createInputFields(agg)) {
        if (f.name === "id") continue;
        inputs.push(
          `  ${renderFieldInputForField(
            f,
            "form",
            ctx.enumsByName,
            ctx.idOptionsBindings,
            ctx.valueObjectsByName,
            "@",
            testidNs ? `${testidNs}-input-${f.name}` : undefined,
            { ctx, home: homeOf(ctx, agg.name), owner: agg.name },
          )}`,
        );
      }
    }
  }
  if (inputs.length === 0) {
    inputs.push(
      `  <.input field={@form[:_placeholder]} label=${heexChromeAttr(ctx, "fieldFallback")} />`,
    );
  }
  // The submit control the page objects click (`<ns>-submit`).  Without it a
  // driver has to fall back to text matching, which breaks under i18n.
  const submitTestid = testidNs ? ` data-testid="${escapeHeexAttr(`${testidNs}-submit`)}"` : "";
  // A create form's submit button is the aggregate's `create` operation label.
  const createCall = ofPascal ? opLabelCall(ctx, ofPascal, "create") : undefined;
  const runLabel = runsWorkflow ? workflowRunLabel(ctx, runsWorkflow.name) : undefined;
  const submitText = createCall
    ? `<%= ${createCall} %>`
    : runLabel
      ? labelText(runLabel)
      : heexChromeText(ctx, "submitFallback");
  return [
    `<.simple_form for={@form} phx-submit="${submitEvent}"${testidAttr}>`,
    ...inputs,
    `  <:actions>`,
    `    <.button type="submit"${submitTestid}>${submitText}</.button>`,
    `  </:actions>`,
    `</.simple_form>`,
  ].join("\n");
}

/** A call's LITERAL `testid:` value, or `undefined` when absent or dynamic.
 *
 *  The per-field / per-control testids a form derives (`<ns>-input-<f>`,
 *  `<ns>-submit`) are STRING CONCATENATIONS of the namespace, so they can only
 *  be built from a compile-time literal.  A dynamic `testid:` yields no derived
 *  ids rather than a malformed attribute — the same conservative stance
 *  `attrValue` takes. */
function literalTestid(expr: Extract<ExprIR, { kind: "call" }>): string | undefined {
  const idx = (expr.argNames ?? []).indexOf("testid");
  const arg = idx >= 0 ? expr.args[idx] : undefined;
  return arg?.kind === "literal" ? arg.value : undefined;
}

/** Extract a named arg whose value is a `ref` and return its
 *  PascalCase name (the source-level identifier, undisturbed).
 *  Used by renderForm to look up the `of:`/`runs:` targets in the
 *  aggregate/workflow registries.  Returns undefined if the arg
 *  isn't present or isn't a ref. */
function findPascalArg(
  expr: Extract<ExprIR, { kind: "call" }>,
  argName: string,
): string | undefined {
  for (let i = 0; i < expr.args.length; i++) {
    if (expr.argNames?.[i] !== argName) continue;
    const a = expr.args[i];
    if (a && a.kind === "ref") return a.name;
    return undefined;
  }
  return undefined;
}

/** Emit a `<.input>` for a single aggregate field.  Picks the HTML
 *  input type from the IR type and labels it from a humanized name.
 *  Enum + `X id` + value-object types lower to higher-shape elements
 *  (`<.input type="select" …>`, `<.inputs_for :let={…}>`); the rest
 *  dispatch to `htmlInputTypeForIRType`. */
export function renderFieldInputForField(
  f: { name: string; type: TypeIR },
  formAssign = "form",
  enumsByName?: ReadonlyMap<string, EnumIR>,
  /** Side-effect sink for `X id` field types.  When the walker
   *  encounters `customerId: Customer id`, it pushes "Customer"
   *  here; renderMount in liveview-emit.ts iterates these and
   *  loads the target list at mount so the select's
   *  `options={@<x_snake>_options}` resolves. */
  idOptionsBindings?: Set<string>,
  /** Workspace-wide VO registry.  When supplied, VO-typed fields
   *  render as `<.inputs_for :let={X_form}>` nested-form blocks
   *  with one `<.input>` per VO field (recursing through this
   *  function).  Without it (tests / fallbacks), VOs default to
   *  text input. */
  valueObjectsByName?: ReadonlyMap<string, ValueObjectIR>,
  /** Sigil prefix for the form field reference.  Top-level callers
   *  use the default `@` (form is a LiveView assign — `@form[:f]`).
   *  Recursive nested-form callers pass `""` because the nested
   *  form is a local variable bound by `:let={…}` (`f_form[:sub]`,
   *  no `@`). */
  assignPrefix = "@",
  /** The `data-testid` this control is addressed by — `<form-ns>-input-<field>`,
   *  matching what `page-objects-emit.ts` fills.  `undefined` when the form
   *  carries no literal `testid:`, in which case nothing is emitted (rather
   *  than an unaddressable placeholder). */
  testid?: string,
  /** Identity-keyed label sites: the walk context, the form's home context and
   *  the model type the field is declared on (`undefined` = the input names no
   *  model fact and keeps its English). */
  modelText?: { ctx: WalkContext; home: BoundedContextIR | undefined; owner: string | undefined },
): string {
  const fieldName = snake(f.name);
  const label = humanize(f.name);
  const labelCall = modelText
    ? fieldLabelCall(modelText.ctx, modelText.home, modelText.owner, f.name)
    : undefined;
  // `label="Name"` literal, or the `{pgettext(…)}` expression form under i18n.
  const labelAttr = labelCall ? `{${labelCall}}` : `"${label}"`;
  // `.input` collects unknown attributes into its `:global` rest and spreads
  // them onto the rendered `<input>`/`<select>`/`<textarea>`, so `data-testid`
  // rides straight through to the element Playwright fills.
  const tid = testid ? ` data-testid="${escapeHeexAttr(testid)}"` : "";
  // Enum fields render as `<.input type="select" options={[...]}>`.
  // Phoenix CoreComponents' `<.input>` accepts an `options` list of
  // strings (when label == value) or `{label, value}` tuples.  Loom
  // enums have a flat string list; the label IS the value.  Falls
  // back to text input when the enum can't be resolved (registry
  // empty or name unknown) so the form stays valid.
  const inner = f.type.kind === "optional" ? f.type.inner : f.type;
  if (inner.kind === "enum" && enumsByName) {
    const en = enumsByName.get(inner.name);
    if (en) {
      // Under i18n the options are `{label, value}` tuples whose label is the
      // identity-keyed gettext call; otherwise the flat value list.
      const tuples = modelText ? enumOptionTuples(modelText.ctx, modelText.home, en) : undefined;
      const options = (tuples ?? en.values.map((v) => JSON.stringify(v))).join(", ");
      return `<.input field={${assignPrefix}${formAssign}[:${fieldName}]} type="select" label=${labelAttr} options={[${options}]}${tid} />`;
    }
  }
  // `X id` fields render as `<.input type="select" options={@x_options}>`.
  // The options assign is populated by `renderMount` (liveview-emit.ts)
  // from the walker's `idOptionsBindings` set.  Falls back to text
  // input when the binding sink isn't threaded (e.g. tests calling
  // the helper directly).
  if (inner.kind === "id" && idOptionsBindings) {
    idOptionsBindings.add(inner.targetName);
    const optionsVar = `${snake(inner.targetName)}_options`;
    return `<.input field={${assignPrefix}${formAssign}[:${fieldName}]} type="select" label=${labelAttr} options={@${optionsVar}}${tid} />`;
  }
  // Value-object fields render as one plain `<.input>` per VO leaf, named
  // `<form>[<field>][<sub>]` off the field's own `FormField.name` and valued
  // from its submitted params.  Not `<.inputs_for>`: phoenix_ecto's `to_form`
  // raises on a field that is neither an association nor an embed, and a VO is
  // neither — it is flattened into `<field>_<sub>` columns on the aggregate and
  // cast as a plain map at the boundary.  The submit carries the same nested
  // map the REST route takes as JSON.  Falls back to a text input when the VO
  // registry isn't threaded or the type's name isn't found.
  if (inner.kind === "valueobject" && valueObjectsByName) {
    const vo = valueObjectsByName.get(inner.name);
    if (vo) {
      const field = `${assignPrefix}${formAssign}[:${fieldName}]`;
      const legend = labelCall ? `<%= ${labelCall} %>` : label;
      return `<fieldset><legend>${legend}</legend>${renderVoLeafInputs(
        vo,
        field,
        [],
        enumsByName,
        valueObjectsByName,
        testid,
        modelText,
      )}</fieldset>`;
    }
  }
  const inputType = htmlInputTypeForIRType(f.type);
  const isDecimal = f.type.kind === "primitive" && f.type.name === "decimal";
  const isMoney = f.type.kind === "primitive" && f.type.name === "money";
  // money fields render as text inputs with a decimal-format pattern
  // — number inputs can carry "1e10" notation that's lossy on parse;
  // text + pattern preserves the precise string the wire expects.
  const extraAttrs = isDecimal
    ? ` step="0.01"`
    : isMoney
      ? ` pattern="^-?\\d+(\\.\\d+)?$" inputmode="decimal"`
      : "";
  return `<.input field={${assignPrefix}${formAssign}[:${fieldName}]} type="${inputType}" label=${labelAttr}${extraAttrs}${tid} />`;
}

/** The leaf inputs of a value-object field, recursing through nested VOs.
 *  `field` is the HEEx expression of the VO's `FormField` (`@set_reserve_form[:reserve]`);
 *  `path` the sub-field keys below it.  Each leaf is named
 *  `<field.name>[<path>…][<sub>]` and valued from the field's submitted map, so
 *  it round-trips through `phx-change` exactly as a top-level input does. */
function renderVoLeafInputs(
  vo: ValueObjectIR,
  field: string,
  path: readonly string[],
  enumsByName: ReadonlyMap<string, EnumIR> | undefined,
  valueObjectsByName: ReadonlyMap<string, ValueObjectIR>,
  testid: string | undefined,
  modelText:
    | { ctx: WalkContext; home: BoundedContextIR | undefined; owner: string | undefined }
    | undefined,
): string {
  return vo.fields
    .map((sub) => {
      const subPath = [...path, snake(sub.name)];
      // Nested VO controls extend the parent's testid with the sub-field name
      // (`…-input-price-amount`), the exact shape `fillBlock` drives for a
      // value-object create input.
      const subTestid = testid ? `${testid}-${sub.name}` : undefined;
      const subText = modelText ? { ...modelText, owner: vo.name } : undefined;
      const subInner = sub.type.kind === "optional" ? sub.type.inner : sub.type;
      if (subInner.kind === "valueobject") {
        const nested = valueObjectsByName.get(subInner.name);
        if (nested)
          return renderVoLeafInputs(
            nested,
            field,
            subPath,
            enumsByName,
            valueObjectsByName,
            subTestid,
            subText,
          );
      }
      const labelCall = subText
        ? fieldLabelCall(subText.ctx, subText.home, subText.owner, sub.name)
        : undefined;
      const labelAttr = labelCall ? `{${labelCall}}` : `"${humanize(sub.name)}"`;
      const name = `{${field}.name <> ${elixirString(subPath.map((k) => `[${k}]`).join(""))}}`;
      const id = `{${field}.id <> ${elixirString(`_${subPath.join("_")}`)}}`;
      // The submitted map, walked key by key; anything that is not a map (an
      // unset field, a loaded struct's non-map member) reads as unset.
      const binds = subPath
        .slice(0, -1)
        .map((k, i) => `%{} = m${i + 1} <- Map.get(m${i}, ${elixirString(k)})`);
      const value = `{with ${[`%{} = m0 <- ${field}.value`, ...binds].join(", ")}, do: Map.get(m${
        subPath.length - 1
      }, ${elixirString(subPath[subPath.length - 1]!)}), else: (_ -> nil)}`;
      const tid = subTestid ? ` data-testid="${escapeHeexAttr(subTestid)}"` : "";
      if (subInner.kind === "enum" && enumsByName) {
        const en = enumsByName.get(subInner.name);
        if (en) {
          const tuples = subText ? enumOptionTuples(subText.ctx, subText.home, en) : undefined;
          const options = (tuples ?? en.values.map((v) => JSON.stringify(v))).join(", ");
          return `<.input name=${name} id=${id} value=${value} type="select" label=${labelAttr} options={[${options}]}${tid} />`;
        }
      }
      const inputType = htmlInputTypeForIRType(sub.type);
      const isDecimal = subInner.kind === "primitive" && subInner.name === "decimal";
      const step = isDecimal ? ` step="0.01"` : "";
      return `<.input name=${name} id=${id} value=${value} type="${inputType}" label=${labelAttr}${step}${tid} />`;
    })
    .join(" ");
}

/** Map a TypeIR to the HTML `<input type="…">` attribute the form
 *  inputs use.  Defaults to "text" for anything not specifically mapped —
 *  including T id, enum (until the select variant lands), and
 *  value-object embeds (which would be split into per-leaf inputs
 *  in a deeper pass — out of scope here). */
function htmlInputTypeForIRType(t: TypeIR): string {
  if (t.kind === "optional") return htmlInputTypeForIRType(t.inner);
  if (t.kind !== "primitive") return "text";
  switch (t.name) {
    case "int":
    case "long":
    case "decimal":
      return "number";
    case "money":
      return "text";
    case "bool":
      return "checkbox";
    case "datetime":
      return "datetime-local";
    // A date picker; its value is the `YYYY-MM-DD` text the `:date` field casts.
    case "date":
      return "date";
    default:
      return "text";
  }
}

/** `DestroyForm(of: <Agg>)` → a confirm-delete `<.button>` that calls the
 *  aggregate's destroy context function (`destroy_<agg>!(id)`) and navigates
 *  to its list route.  Requires a canonical `destroy` (declare `destroy { }`
 *  or `with crudish`).  Hosted on a detail page, where the route `id` param is
 *  assigned as `@id`.  The delete handler is recorded as a `byId` ActionBinding
 *  and hoisted to the LiveView by the emitter (reusing `Action`'s machinery). */
export function renderDestroyForm(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): string {
  let ofName: string | undefined;
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (name === "of" && arg.kind === "ref") ofName = arg.name;
  }
  if (!ofName)
    return `<!-- ${giveUpText("loom.page-primitive-arg-invalid", "DestroyForm: expected (of: <Agg>)")} -->`;
  const agg = ctx.aggregatesByName.get(ofName);
  if (!agg)
    return `<!-- ${giveUpText("loom.page-ref-unreachable", `DestroyForm(of: ${ofName}): aggregate not found`)} -->`;
  if (!canonicalDestroy(agg)) {
    return `<!-- ${giveUpText("loom.page-ref-unreachable", `DestroyForm(of: ${ofName}): no canonical destroy — declare 'destroy { }' (or use 'with crudish')`)} -->`;
  }
  const eventName = `destroy_${snake(ofName)}`;
  const thenRoute = `/${routeSegmentFor(ofName)}`;
  if (!ctx.actionBindings.some((b) => b.eventName === eventName)) {
    ctx.actionBindings.push({
      agg: ofName,
      op: "destroy",
      eventName,
      thenRoute,
      byId: true,
    });
  }
  const testidAttr = testIdAttr(expr, ctx);
  // The prompt and the button label are emitter-built chrome: the per-aggregate
  // `chrome.deleteConfirm.<Agg>` / `chrome.deleteEntity.<Agg>` whole sentences
  // every frontend reads.
  const confirm = heexChrome(ctx, sentenceChromeName("deleteConfirm", ofName));
  const label = heexChrome(ctx, sentenceChromeName("deleteEntity", ofName));
  const confirmAttr =
    confirm.call !== undefined ? `{${confirm.call}}` : `"${escapeHeexAttr(confirm.english)}"`;
  const labelText =
    label.call !== undefined ? `<%= ${label.call} %>` : escapeHeexText(label.english);
  return `<.button phx-click="${eventName}" phx-value-id={@id} data-confirm=${confirmAttr} class="btn-danger"${testidAttr}>${labelText}</.button>`;
}

/** The run button of a workflow form, keyed `<Ctx>.<Workflow>.op.run`. */
function workflowRunLabel(
  ctx: WalkContext,
  wfName: string,
): { english: string; call?: string } | undefined {
  const bcs = new Set(ctx.bcByAggregate.values());
  const bc = [...bcs].find((c) => c.workflows.some((w) => w.name === wfName));
  if (!bc) return undefined;
  const { key, defaultText } = workflowRunEntry(wfName, bc, bcs);
  const english = sourceText(key, defaultText);
  return ctx.i18nPrefix ? { english, call: pgettextCall(key, defaultText) } : { english };
}

/** Bind a controlled input to the page-state field `stateName`: hoist the
 *  write-back `handle_event` clause once per field and answer its event name
 *  (`update_<field>`, or `toggle_<field>` for a checkbox), or `undefined` when
 *  `stateName` is not a state field of this body.
 *
 *  `bind:` carries the field's `.ddd` spelling (camelCase); `stateNames` is
 *  keyed by the SNAKE-CASED assign name, so the lookup snakes it first — a
 *  raw comparison only ever matched a single-word field, and every multi-word
 *  bound input fell through to the unbound stub.  A component's state lives in
 *  the HOST LiveView's assigns under its namespaced name (`hostStateAssign`),
 *  and the clause runs there, so the assign, the form field name and the
 *  `phx-change` payload key all spell that one name. */
export function bindStateInput(
  stateName: string,
  control: InputControl,
  ctx: WalkContext,
): string | undefined {
  const bound = snake(stateName);
  if (!ctx.stateNames.has(bound)) return undefined;
  const field = hostStateAssign(ctx.stateOwner, bound);
  const isCheckbox = control === "checkbox";
  const eventName = isCheckbox ? `toggle_${field}` : `update_${field}`;
  if (!ctx.handlers.some((h) => h.name === eventName)) {
    ctx.handlers.push({
      name: eventName,
      paramsPattern: `%{"${field}" => value}`,
      body: [
        `    {:noreply, assign(socket, :${field}, ${isCheckbox ? `value == "true"` : "value"})}`,
      ],
    });
  }
  return eventName;
}
