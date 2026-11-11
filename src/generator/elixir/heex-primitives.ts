// ---------------------------------------------------------------------------
// HEEx presentational primitive renderers.
//
// The closed-primitive component library for the Phoenix LiveView target
// (Breadcrumbs / Anchor / Modal / Form / Table / QueryView / KeyValueRow /
// Stack / Heading / Card / Badge / Button / Icon / …).  Split out of
// heex-walker-core.ts so the 2k-line walker reads as two cohesive halves:
// this file holds the leaf renderers dispatched by name through the walker
// registry (src/generator/_walker/registry.ts).  They consume the core
// walker engine (renderExpr / renderChild / renderInTemplate /
// renderPrimitive) but the engine only ever reaches them via the registry,
// so the dependency is one-directional (primitives -> core).
// ---------------------------------------------------------------------------

import { createInputFields } from "../../ir/enrich/wire-projection.js";
import { pagedReturn } from "../../ir/stdlib/generics.js";
import type {
  BoundedContextIR,
  EnumIR,
  ExprIR,
  TypeIR,
  ValueObjectIR,
} from "../../ir/types/loom-ir.js";
import {
  aggregateUsesPrincipalContextFilter,
  exprUsesCurrentUser,
} from "../../ir/types/loom-ir.js";
import { canonicalDestroy } from "../../ir/util/canonical-lifecycle.js";
import { findsOfAggregate, resolveAggregateRead } from "../../ir/util/page-read.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { elixirString, humanize, snake } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import { sourceText } from "../_i18n/source-text.js";
import { type DetectedApiCall, tryDetectApiHook } from "../_walker/api-hook-detector.js";
import { giveUpText } from "../_walker/give-up.js";
import { isEntityHistoryRead } from "../_walker/history-read.js";
import {
  chromeKey,
  chromeMessage,
  opDialogChrome,
  sentenceChromeName,
} from "../_walker/i18n-chrome.js";
import { paramLabelOwner, workflowRunEntry } from "../_walker/model-text-sites.js";
import { queryShape } from "../_walker/paged-query.js";
import { simpleAccessorField } from "../_walker/primitives/data-grid-shape.js";
import type { InputControl, QueryViewRead } from "../_walker/target.js";
import { gateActionButton } from "./heex-action.js";
import {
  enumLabelLookup,
  enumOptionTuples,
  fieldLabelCall,
  homeOf,
  opLabelCall,
} from "./heex-model-text.js";
import {
  escapeHeexAttr,
  escapeHeexText,
  hostStateAssign,
  indent,
  isAttrRenderable,
  localizedHeexAttr,
  type PrimitiveSpec,
  registerBinding,
  renderChild,
  renderExpr,
  renderInTemplate,
  renderPrimitive,
  type WalkContext,
} from "./heex-walker-core.js";
import { formChromeAttr, pgettextCall } from "./i18n.js";
import { updateSeamGates } from "./vanilla/gate.js";
import { liveViewCallsOp, servesCanProbe } from "./vanilla/op-form.js";
// ---------------------------------------------------------------------------
// Scaffold expander primitive renderers.
// Each function is called from renderCall when the primitive name matches.
// These emit proper Phoenix/HEEx structures — no <!-- TODO --> comments.
// ---------------------------------------------------------------------------

/** Render an attribute *value* as either a quoted literal or a HEEx `{…}`
 *  expression, depending on whether the arg is a compile-time literal.
 *
 *  A *dynamic* value (anything but a `literal`) is an Elixir expression and
 *  MUST ride a `{…}` expression attribute — emitting it inside quotes (e.g.
 *  `id="<%= … %>"` or `data-testid="x <> y"`) produces a HEEx tokenizer
 *  ParseError ("expected attribute name").  This is the single seam that
 *  every primitive funnels dynamic attribute values through, so the bug class
 *  can't reappear one renderer at a time.
 *
 *  A value that is not renderable as an attribute at all (a LIST / OBJECT /
 *  LAMBDA — see `isAttrRenderable`) degrades to the empty string: these call
 *  sites (`src:`, `alt:`, `id:`, `testid:`) have a required attribute to fill,
 *  and an empty one is inert markup where the raw splice was a render-time
 *  crash in Phoenix's attribute escaper. */
export function attrValue(arg: ExprIR, ctx: WalkContext): string {
  if (!isAttrRenderable(arg)) return `""`;
  return arg.kind === "literal"
    ? `"${escapeHeexAttr(arg.value)}"`
    : `{${renderExpr(arg, { ...ctx, position: "template" })}}`;
}

/** The trailing ` data-testid=…` attribute for a primitive call, or `""` when
 *  no `testid:` is given.  A literal renders as `data-testid="x"`; a dynamic
 *  `testid:` renders as `data-testid={<expr>}` (see {@link attrValue}). */
export function testIdAttr(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  const idx = (expr.argNames ?? []).indexOf("testid");
  const arg = idx >= 0 ? expr.args[idx] : undefined;
  return arg ? ` data-testid=${attrValue(arg, ctx)}` : "";
}

/** `Modal(trigger: Button(...), title: "…", OperationForm(of: Agg, op: x))`
 *  → a `<.button phx-click={show_modal(id)}>` trigger followed by
 *  a `<.modal id=…>` hosting a `<.simple_form for={@<op>_form}>`
 *  whose inputs are the operation's params.  Registers an
 *  `kind:"operation"` FormBinding the LiveView emitter turns into
 *  the `@<op>_form` assign + `validate_<op>`/`submit_<op>`
 *  handle_event clauses.  The `OperationForm(of:, op:)` child is consumed
 *  here (never visited by renderChild) — mirrors the React
 *  walker's `emitModal`. */
export function renderModal(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  let title = "";
  // The English the submit button shows — the literal title when authored,
  // else the humanized op name — for the op-dialog chrome rule.
  let titleEnglish: string | undefined;
  let triggerExpr: ExprIR | undefined;
  let openExpr: ExprIR | undefined;
  const positional: ExprIR[] = [];
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (name === "title") {
      // A user-visible named slot (`modalTitle`) — translated under i18n,
      // the raw escaped literal otherwise (byte-identical).
      if (arg.kind === "literal" && typeof arg.value === "string") titleEnglish = arg.value;
      if (arg.kind === "modelText") titleEnglish = arg.defaultText;
      title =
        arg.kind === "literal" || arg.kind === "modelText"
          ? renderInTemplate(arg, ctx, "modalTitle")
          : renderExpr(arg, { ...ctx, position: "template" });
    } else if (name === "trigger") {
      triggerExpr = arg;
    } else if (name === "open") {
      openExpr = arg;
    } else if (!name) {
      positional.push(arg);
    }
  }
  const formChild = positional.find(
    (c): c is Extract<ExprIR, { kind: "call" }> => c.kind === "call" && c.name === "OperationForm",
  );
  // State-controlled modal: `Modal { <children>, open: <stateBool>, title: "…" }`
  // — visibility is a page `state` field (distinct from the operation-form
  // modal).  LiveView idiom: an assign-driven conditional render
  // (`<%= if @open do %> … <% end %>`); the user closes it via a child button
  // that writes the state (`x := false` → the existing handle_event machinery).
  if (!formChild && openExpr?.kind === "ref" && ctx.stateNames.has(snake(openExpr.name))) {
    const openHeex = renderExpr(openExpr, { ...ctx, position: "template" });
    const childrenHeex = positional.map((c) => renderChild(c, ctx)).join("\n");
    const heading = title ? `      <h3 class="mb-4 text-lg font-semibold">${title}</h3>\n` : "";
    return `<%= if ${openHeex} do %>
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-full max-w-md rounded-xl border bg-white p-6 shadow-lg">
${heading}${childrenHeex}
      </div>
    </div>
    <% end %>`;
  }
  // The op-form names its operation via one of two shapes:
  //
  //   * `OperationForm(<instance>.<operation>)` — receiver is the in-scope
  //     aggregate instance (resolved via `instanceTypes`), member
  //     is the op name.  The classic Detail-page form inside a
  //     QueryView lambda binding.
  //   * `OperationForm(of: <Agg>, op: <opName>)` — flat named args; aggregate
  //     resolved directly by name, id falls back to route.  The by-name shape
  //     for a hand-written page with no loaded record (the scaffold's Detail
  //     modals are instance-qualified inside the QueryView data lambda).
  let opName: string | undefined;
  let ofName: string | undefined;
  let recordAssign: string | undefined;
  if (formChild) {
    const argNames = formChild.argNames ?? [];
    const ofIdx = argNames.indexOf("of");
    const opIdx = argNames.indexOf("op");
    if (ofIdx >= 0 && opIdx >= 0) {
      const ofArg = formChild.args[ofIdx];
      const opArg = formChild.args[opIdx];
      if (ofArg?.kind === "ref" && opArg?.kind === "ref") {
        ofName = ofArg.name;
        opName = opArg.name;
      }
    }
    if (!opName) {
      const opRefNode = formChild.args.find((_, i) => !formChild.argNames?.[i]);
      if (opRefNode?.kind === "member" && opRefNode.receiver.kind === "ref") {
        const instanceName = opRefNode.receiver.name;
        opName = opRefNode.member;
        ofName = ctx.instanceTypes?.get(instanceName);
        recordAssign = ctx.varRemapping?.get(instanceName);
      }
    }
  }
  if (!formChild || !ofName || !opName) {
    return `<!-- ${giveUpText("loom.page-primitive-arg-invalid", "malformed Modal: expected trigger: Button + OperationForm(<instance>.<op>) or OperationForm(of:, op:)")} -->`;
  }
  const aggSnake = snake(ofName);
  const opSnake = snake(opName);
  const modalId = `${aggSnake}-op-${opSnake}-modal`;
  const formAssign = `${opSnake}_form`;

  const agg = ctx.aggregatesByName.get(ofName);
  const op = agg?.operations.find((o) => o.name === opName);
  const params = op ? op.params.map((p) => ({ name: p.name, type: p.type })) : [];

  const gated = !!(agg && op && servesCanProbe(agg, op));
  registerBinding(ctx, ctx.formBindings, {
    kind: "operation",
    name: ofName,
    op: opSnake,
    modalId,
    params,
    ...(gated ? { gated: true } : {}),
    ...(agg && op && liveViewCallsOp(agg, op) ? { callsOp: true } : {}),
    ...(recordAssign ? { recordAssign } : {}),
  });

  // Trigger button surface from the `trigger: Button(...)` arg.
  // The trigger's label is a `Button` first-positional — the `button`
  // user-visible slot the extraction pass already writes to the catalog as
  // `page.<Page>.button.<hash>`.  It was read RAW (`a.value`), two lines below
  // the modal TITLE which is translated, so the key existed and nothing
  // rendered it: English at every locale (audit finding A13).  `renderInTemplate`
  // with the same role emits `<%= pgettext(<key>, <default>) %>` and derives the
  // identical key; with i18n off it is the escaped literal, byte-identical.
  const opCall = opLabelCall(ctx, ofName, opName);
  let label = opCall ? `<%= ${opCall} %>` : escapeHeexText(humanize(opName));
  if (triggerExpr && triggerExpr.kind === "call" && triggerExpr.name === "Button") {
    for (let i = 0; i < triggerExpr.args.length; i++) {
      const n = triggerExpr.argNames?.[i];
      const a = triggerExpr.args[i]!;
      if (!n && (a.kind === "literal" || a.kind === "modelText"))
        label = renderInTemplate(a, ctx, "button");
    }
  }
  const testidAttr = testIdAttr(expr, ctx);
  const heading = title || (opCall ? `<%= ${opCall} %>` : humanize(opName));
  // The modal's close icon is named by the shared op-dialog rule, so it never
  // shares the submit button's accessible name (`operation close` → "Close
  // dialog").
  const closeLabel = formChromeAttr(
    opDialogChrome(titleEnglish ?? humanize(opName)).close,
    Boolean(ctx.i18nPrefix),
  );

  // A merge-patch `update` input for a `mask unless` field renders only for a
  // caller who can read it: the form would otherwise pre-fill the clear value
  // off the Ecto struct, and submitting the key is refused by the mask write
  // gate.  Left out, the key is absent and the stored value stays.
  const maskedInput = (name: string): string | undefined => {
    const gate = op ? updateSeamGates(op).find((g) => g.maskWriteOf === name) : undefined;
    if (!gate) return undefined;
    if (!ctx.authEnabled) return "false";
    return `@current_user != nil and (${renderExpr(gate.expr, { ...ctx, position: "template" })})`;
  };
  const inputs =
    params.length > 0
      ? params.map((p) => {
          const gated = maskedInput(p.name);
          const input = `    ${renderFieldInputForField(
            p,
            formAssign,
            ctx.enumsByName,
            ctx.idOptionsBindings,
            ctx.valueObjectsByName,
            "@",
            undefined,
            {
              ctx,
              home: homeOf(ctx, ofName),
              owner: agg ? paramLabelOwner(agg, p.name) : undefined,
            },
          )}`;
          return gated ? `    <%= if ${gated} do %>${input.trim()}<% end %>` : input;
        })
      : [`    <%!-- ${opSnake} has no parameters --%>`];

  // A `when`-gated op: the trigger (and the modal's submit) render `disabled`
  // while `@can_<op>` — assigned from the façade's `can_<op>_<agg>(record)`
  // probe on load and after every op submit — is false, with the reason as the
  // tooltip.  Un-gated ops render byte-identically.
  const canAssign = `@can_${opSnake}`;
  const disabledAttr = gated
    ? ` disabled={!${canAssign}} title={unless ${canAssign}, do: ${elixirString(
        `${humanize(opName)} is not available in the current state`,
      )}}`
    : "";
  const submitDisabled = gated ? ` disabled={!${canAssign}}` : "";
  const dialog = [
    `<.button phx-click={show_modal("${modalId}")}${disabledAttr}${testidAttr}>${label}</.button>`,
    `<.modal id="${modalId}" close_label=${closeLabel}>`,
    `  <:title>${heading}</:title>`,
    `  <.simple_form for={@${formAssign}} phx-change="validate_${opSnake}" phx-submit="submit_${opSnake}">`,
    ...inputs,
    `    <:actions>`,
    `      <.button type="submit"${submitDisabled}>${heading}</.button>`,
    `    </:actions>`,
    `  </.simple_form>`,
    `</.modal>`,
  ].join("\n");
  // A currentUser-only `requires` hides the trigger and its dialog for a
  // principal it refuses, exactly as an `Action` button is hidden.
  return op ? gateActionButton(dialog, op, ctx) : dialog;
}

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
function renderFieldInputForField(
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
  // Value-object fields render as `<.inputs_for :let={<f>_form}>`
  // with one nested `<.input>` per VO field.  The `:let` local
  // variable shadows the outer form scope, so the recursive call
  // passes assignPrefix="" — `f_form[:sub]` instead of `@f_form[:sub]`.
  // The Ecto changeset's embedded-schema cast handles the nested-changeset
  // wiring at validate time.  Falls back to text input when the VO
  // registry isn't threaded or the type's name isn't found.
  if (inner.kind === "valueobject" && valueObjectsByName) {
    const vo = valueObjectsByName.get(inner.name);
    if (vo) {
      const nestedFormVar = `${fieldName}_form`;
      // Single-line emission keeps the multi-line indent from the
      // outer template unbroken — the caller prefixes a fixed number
      // of spaces and that prefix applies to the whole `<fieldset>`
      // block.  HEEx is whitespace-tolerant; the rendered DOM nests
      // identically.
      const subInputs = vo.fields
        .map((sub) =>
          renderFieldInputForField(
            sub,
            nestedFormVar,
            enumsByName,
            idOptionsBindings,
            valueObjectsByName,
            "",
            // Nested VO controls extend the parent's testid with the sub-field
            // name (`…-input-price-amount`), the exact shape `fillBlock`
            // drives for a value-object create input.
            testid ? `${testid}-${sub.name}` : undefined,
            modelText ? { ...modelText, owner: vo.name } : undefined,
          ),
        )
        .join(" ");
      const legend = labelCall ? `<%= ${labelCall} %>` : label;
      return `<fieldset><legend>${legend}</legend><.inputs_for :let={${nestedFormVar}} field={${assignPrefix}${formAssign}[:${fieldName}]}>${subInputs}</.inputs_for></fieldset>`;
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
    `aria-label="Filter table" phx-change="${eventName}" data-testid="table-filter" />`
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
export function renderTableColumn(
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

/** Resolve the aggregate PascalCase name out of a `QueryView`
 *  `of:` argument.  The scaffold-expander emits one of:
 *    detail  → method-call `<api>.<Agg>.byId(id)` (receiver is a
 *              member `{receiver: ref(api), member: Agg}`), or the
 *              no-api fallback `<Agg>.byId(id)` (receiver ref(Agg))
 *    list    → member access `<api>.<Agg>.all` (the `.all` is the
 *              outer member; its receiver is `<api>.<Agg>`), or the
 *              fallback bare `ref(Agg)` / `<Agg>.all`. */
function resolveQueryAggregate(arg: ExprIR): string | undefined {
  if (arg.kind === "method-call") {
    if (arg.receiver.kind === "member") return arg.receiver.member;
    if (arg.receiver.kind === "ref") return arg.receiver.name;
  }
  if (arg.kind === "member") {
    // `<api>.<Agg>.all` → receiver is `<api>.<Agg>` (a member);
    // `<Agg>.all` → receiver is ref(Agg).
    if (arg.receiver.kind === "member") return arg.receiver.member;
    if (arg.receiver.kind === "ref") return arg.receiver.name;
    return arg.member;
  }
  if (arg.kind === "ref") return arg.name;
  return undefined;
}

/** The argument list of a `QueryView` `of:` call, rendered as handler-position
 *  Elixir.  Only a `method-call` carries args (`<api>.<Agg>.all(page, …)`); a
 *  plain member access (`<api>.<Agg>.all`) has none, so the load stays the
 *  parameterless `list_<agg>s()` it has always been. */
function queryCallArgs(arg: ExprIR | undefined, ctx: WalkContext): string[] | undefined {
  if (arg?.kind !== "method-call" || arg.args.length === 0) return undefined;
  return arg.args.map((a) => renderExpr(a, { ...ctx, position: "handler" }));
}

/** The CONTEXT-MODULE FUNCTION a `QueryView` `of:` aggregate read calls.
 *
 *  Deriving this from the read's SHAPE alone — list-shaped ⇒ `list_<agg>s`,
 *  single-shaped ⇒ `get_<agg>` — is right only for the two standard ops and
 *  silently wrong for every FILTERED read: `Product.findAllBySellable()` would
 *  load the whole table, and `Item.byState(Live)` would pass the filter value
 *  into `list_items/4`'s `page` parameter.  The operation the author named is
 *  the fact that decides this, so it is what gets consulted — through
 *  `resolveAggregateRead`, the same resolution the validator runs to reject a
 *  read that names nothing (`loom.ui-read-unresolved`).
 *
 *  `undefined` means exactly that: the operation resolved to no declaration, so
 *  there is no honest function to call and the load block refuses instead of
 *  substituting the list.  An `of:` the DETECTOR cannot read at all (a bare ref,
 *  an unknown receiver) keeps the shape-derived default — those never named an
 *  operation to route by, and the answer is byte-identical to before. */
function contextReadFn(
  aggName: string,
  isSingle: boolean,
  ctx: WalkContext,
  detected: DetectedApiCall | null,
): string | undefined {
  const aggSnake = snake(aggName);
  const shapeDefault = isSingle ? `get_${aggSnake}` : `list_${aggSnake}s`;
  if (detected?.kind !== "aggregate" || detected.aggregateName !== aggName) return shapeDefault;
  const target = resolveAggregateRead(
    detected.operation,
    findsOfAggregate(aggName, ctx.bcByAggregate.get(aggName)),
  );
  switch (target.kind) {
    case "find-all":
      return `list_${aggSnake}s`;
    case "by-id":
      return `get_${aggSnake}`;
    case "find":
      // The `defdelegate <find>_<agg>(...)` the context module emits beside the
      // CRUD ones (`vanilla/context-emit.ts`, `customFindsOf`).
      return `${snake(target.find.name)}_${aggSnake}`;
    default:
      // `history` is detected one level up (`historyRead`) and never reaches
      // this arm; `unresolved` names no declaration — refuse.
      return undefined;
  }
}

/** The LiveView socket's principal — what `LiveAuth` assigns on mount. */
const SOCKET_ACTOR = "Map.get(socket.assigns, :current_user)";

/** The defaults of the paged `list/5` (`page`, `page_size`, `sort`, `dir`) and
 *  a paged find's trailing paging params, in order — filled in front of the
 *  actor when the page's call passed fewer, so the actor never lands in a
 *  paging slot. */
const PAGED_READ_DEFAULTS = ["1", "20", '"id"', '"asc"'];

/** The trailing arguments that thread the request principal into a LiveView
 *  read, or `undefined` when the read takes none.
 *
 *  A principal-scoped read (a tenancy / `currentUser` capability filter on the
 *  aggregate, or a `currentUser` in the read's own `where`) pins its query to
 *  `current_user && current_user.<claim>`; the controller threads the actor
 *  from `conn.assigns`, and a read called WITHOUT one binds `nil` and answers
 *  no rows (fail-closed).  The LiveView must thread the socket's actor the same
 *  way, through the same parameter its context function declares:
 *
 *  the list (`list_<agg>s`) / by-id (`get_<agg>`) / find delegates take it
 *  POSITIONALLY after their own args (paging defaults filled first when the
 *  page passed fewer). */
function readActorArgs(
  aggName: string,
  isSingle: boolean,
  ctx: WalkContext,
  detected: DetectedApiCall | null,
  ofArgNode: ExprIR | undefined,
): string[] | undefined {
  const bc = ctx.bcByAggregate.get(aggName);
  const agg = bc?.aggregates.find((a) => a.name === aggName);
  if (!agg) return undefined;
  const principal = aggregateUsesPrincipalContextFilter(agg);
  const argCount = queryCallArgs(ofArgNode, ctx)?.length ?? 0;
  const operation =
    detected?.kind === "aggregate" && detected.aggregateName === aggName
      ? detected.operation
      : isSingle
        ? "byId"
        : "all";
  const target = resolveAggregateRead(operation, findsOfAggregate(aggName, bc));
  switch (target.kind) {
    case "by-id":
      return principal ? [SOCKET_ACTOR] : undefined;
    case "find-all": {
      if (!principal) return undefined;
      const all = bc?.repositories
        .find((r) => r.aggregateName === aggName)
        ?.finds.find((f) => f.name === "all");
      const paged = !!all && !!pagedReturn(all.returnType);
      return paged ? [...PAGED_READ_DEFAULTS.slice(argCount), SOCKET_ACTOR] : [SOCKET_ACTOR];
    }
    case "find": {
      const f = target.find;
      const actor = principal || exprUsesCurrentUser(f.filter);
      if (!actor) return undefined;
      const fill = pagedReturn(f.returnType)
        ? PAGED_READ_DEFAULTS.slice(Math.max(0, argCount - f.params.length))
        : [];
      return [...fill, SOCKET_ACTOR];
    }
    default:
      return undefined;
  }
}

/** What a `QueryView` reads on a LiveView page, decided from the IR: the assign
 *  its load fills, the read's shape, and which read it is.  Pure apart from
 *  the per-page assign reservation (`reserveQueryAssign`). */
interface QueryViewPlan {
  ofNode: ExprIR;
  assignName: string;
  isSingle: boolean;
  isPaged: boolean;
  autoPaged: boolean;
  detected: DetectedApiCall | null;
  projectionRead?: string;
  historyRead?: string;
}

function queryViewPlan(
  expr: Extract<ExprIR, { kind: "call" }>,
  ofNode: ExprIR,
  ctx: WalkContext,
): QueryViewPlan {
  // Resolve the read's SHAPE from the IR rather than from the flags.
  // `paged:` / `single:` are opt-INs; the facts behind them are properties of
  // the find, and taking them from the flags alone is what made a hand-written
  // `QueryView { of: X.all }` render `Enum.empty?/1` against the paged envelope
  // MAP (never empty, so the empty arm was dead and `<.table rows={…}>`
  // iterated the map's key/value pairs) and a `byId` read without `single:`
  // raise `Protocol.UndefinedError` on a struct.  Same derivation the JSX
  // walker uses — see `_walker/paged-query.ts`.
  const names = expr.argNames ?? [];
  const litTrue = (i: number): boolean => {
    const a = i >= 0 ? expr.args[i] : undefined;
    return a?.kind === "literal" && a.value === "true";
  };
  // Entity-history read (`<Agg>.history(id)`, docs/audit.md) — NOT an ordinary
  // aggregate read: it scans `audit_records` for one target, so binding it as
  // one would load `list_<aggs>` (the LIST, not the trail).  Loaded by the
  // LiveView's page-private `load_<agg>_history/2`.
  const historyRead = isEntityHistoryRead(ofNode, ctx.aggregatesByName)
    ? resolveQueryAggregate(ofNode)
    : undefined;
  // Detector context, shared by the shape derivation and the Pattern H probe
  // below so the two can't answer from different name sets.
  const detectCtx = {
    apiParamNames: new Set(ctx.ui.apiParams.map((p) => p.name)),
    aggregatesByName: ctx.aggregatesByName,
    bcByAggregate: ctx.bcByAggregate,
    projectionsByName: ctx.projectionsByName,
    listShapedProjections: ctx.listShapedProjections,
  };
  const shape = queryShape(ofNode, detectCtx);
  // Pattern H — `QueryView { of: <api>.<Projection> }`.  The read resolves to
  // the query-time projection's own `run/1`, in-process: a LiveView deployable
  // hosts its contexts in the SAME OTP app, so what the SPA frontends reach
  // over `GET /projections/<slug>` is one function call here.
  const detected = tryDetectApiHook(ofNode, detectCtx);
  const projectionRead = detected?.kind === "projection" ? detected.aggregateName : undefined;
  // Flag OR fact: an author may opt in explicitly (the scaffold does), but
  // omitting the flag does NOT mean "not paged" / "not single".
  const isSingle = litTrue(names.indexOf("single")) || shape.single;
  const explicitPaged = litTrue(names.indexOf("paged"));
  const isPaged = explicitPaged || shape.paged;
  // AUTO-paged: the read is paged but the body was written for a collection, so
  // the lambda binding unwraps to the envelope's rows — the LiveView twin of
  // the JSX walker's `.data.items` unwrap.  Without it a hand-written
  // `Table { rows: rows }` passed the whole envelope MAP as `rows=`, and
  // `<.table>` iterated its key/value pairs.  An explicit `paged: true` body
  // (the scaffold) reads `rows.items` itself, so it binds the envelope.
  const autoPaged = !explicitPaged && !isSingle && shape.paged;
  return {
    ofNode,
    assignName: queryAssignName(expr, projectionRead, historyRead, ctx),
    isSingle,
    isPaged,
    autoPaged,
    detected,
    ...(projectionRead === undefined ? {} : { projectionRead }),
    ...(historyRead === undefined ? {} : { historyRead }),
  };
}

/** The assign a `QueryView`'s load fills.
 *
 *  A projection read names it after the PROJECTION (`:order_totals`) and a
 *  history read after the AGGREGATE (`:order_history`): the scaffolded
 *  dashboard puts one KPI `QueryView` per aggregate on `Home`, each with the
 *  same lambda param, and a detail page's history read uses `entries`, a name
 *  any hand-written read could also pick.  Any other read names it after its
 *  `data:` lambda param — `rows` reads as `items`, the scaffold's list
 *  convention — reserved per page, so two reads whose lambdas share a param
 *  each get their own assign (`items`, `items_2`) instead of loading into one
 *  where the last load wins. */
function queryAssignName(
  expr: Extract<ExprIR, { kind: "call" }>,
  projectionRead: string | undefined,
  historyRead: string | undefined,
  ctx: WalkContext,
): string {
  if (projectionRead) return snake(projectionRead);
  if (historyRead) return `${snake(historyRead)}_history`;
  const data = expr.args[(expr.argNames ?? []).indexOf("data")];
  const param = data?.kind === "lambda" ? snake(data.param) : "rows";
  return reserveQueryAssign(expr, param === "rows" ? "items" : param, ctx);
}

/** The assign `base` for this `QueryView`, or the first free `base_<n>` when
 *  another read on the page already holds `base`.  Keyed by the call node, so
 *  the view's data scope and its load binding agree on the name. */
function reserveQueryAssign(
  expr: Extract<ExprIR, { kind: "call" }>,
  base: string,
  ctx: WalkContext,
): string {
  const reserved = ctx.queryAssigns.get(expr);
  if (reserved !== undefined) return reserved;
  const taken = new Set(ctx.queryAssigns.values());
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  ctx.queryAssigns.set(expr, name);
  return name;
}

/** The `of:` read of a `QueryView`, when it has one. */
function queryViewOf(expr: Extract<ExprIR, { kind: "call" }>): ExprIR | undefined {
  return expr.args[(expr.argNames ?? []).indexOf("of")];
}

/** The walk context a `QueryView`'s `data:` lambda body renders under: its
 *  parameter remapped to the assign the load fills (the envelope's `.items`
 *  when the read is auto-paged), and typed so a nested instance-qualified
 *  op-form (`OperationForm(data.confirm)`) resolves the aggregate it operates
 *  on — or, for a list, so its `Table` / `For` rows type theirs. */
export function queryViewDataContext(
  expr: Extract<ExprIR, { kind: "call" }>,
  param: string,
  ctx: WalkContext,
): WalkContext {
  const ofNode = queryViewOf(expr);
  if (!ofNode) return ctx;
  const plan = queryViewPlan(expr, ofNode, ctx);
  const remapping = new Map<string, string>([
    [snake(param), plan.autoPaged ? `${plan.assignName}.items` : plan.assignName],
  ]);
  const queried = resolveQueryAggregate(ofNode);
  const known = queried !== undefined && ctx.aggregatesByName.has(queried);
  return {
    ...ctx,
    varRemapping: remapping,
    instanceTypes:
      known && plan.isSingle
        ? new Map([...(ctx.instanceTypes ?? []), [param, queried]])
        : ctx.instanceTypes,
    listTypes:
      known && !plan.isSingle
        ? new Map([...(ctx.listTypes ?? []), [param, queried]])
        : ctx.listTypes,
  };
}

/** Register a `QueryView`'s load so the LiveView emitter fills its assign in
 *  `handle_params` (the assign the ladder reads is never populated otherwise —
 *  see `QueryBinding`), and answer what the ladder tests. */
export function bindHeexQueryView(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): QueryViewRead | undefined {
  const ofNode = queryViewOf(expr);
  if (!ofNode) return undefined;
  const plan = queryViewPlan(expr, ofNode, ctx);
  const { assignName, isSingle, projectionRead, historyRead, detected } = plan;
  if (projectionRead) {
    // The projection load takes no arguments (the read IS the row) and no
    // `listArgs` — a query-time projection has no page/sort surface.
    registerBinding(ctx, ctx.queryBindings, {
      kind: isSingle ? "single" : "list",
      assign: assignName,
      aggregate: projectionRead,
      source: "projection",
    });
  }
  if (historyRead) {
    // `listArgs` carries the entity id the `of:` call passed
    // (`socket.assigns.id` on a scaffolded detail page) — the loader takes it
    // as an argument rather than reaching for `@id`, so a hand-written
    // `history(someOtherId)` loads what it asked for.
    registerBinding(ctx, ctx.queryBindings, {
      kind: "list",
      assign: assignName,
      aggregate: historyRead,
      source: "history",
      listArgs: queryCallArgs(ofNode, ctx),
    });
  }
  const aggName = projectionRead || historyRead ? undefined : resolveQueryAggregate(ofNode);
  if (aggName) {
    registerBinding(ctx, ctx.queryBindings, {
      kind: isSingle ? "single" : "list",
      assign: assignName,
      aggregate: aggName,
      // Forward the `of:` call's arguments to the load block.  A paged scaffold
      // list is `<api>.<Agg>.all(pageNum, 10, sortKey, sortDir)`; without these
      // the emitted `list_<agg>s()` takes the repository defaults and the page
      // never moves off 1.  HANDLER position — the load block is a function
      // body, so state refs must render `socket.assigns.<f>`, not `@<f>`.
      listArgs: queryCallArgs(ofNode, ctx),
      // WHICH context function this read calls, resolved from the `of:`
      // call's OPERATION — see `contextReadFn`.
      readFn: contextReadFn(aggName, isSingle, ctx, detected),
      // The request principal, when the read's repository function takes one.
      actorArgs: readActorArgs(aggName, isSingle, ctx, detected, ofNode),
      // …and only when the enclosing `match` arm is the one being rendered.
      gate: isSingle ? undefined : ctx.matchGate,
    });
  }
  return { readExpr: assignName, single: isSingle, paged: plan.isPaged };
}

/** `KeyValueRow("Label", value_expr)` → `<div class="key-value-row">` */
export function renderKeyValueRow(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): string {
  const testidAttr = testIdAttr(expr, ctx);
  const positionals = expr.args.filter((_, i) => !expr.argNames?.[i]);
  // The row label is a user-visible slot (`keyValue`), so a plain literal rides
  // the translation runtime under i18n and stays raw otherwise.
  const label = positionals[0]
    ? renderInTemplate(positionals[0], ctx, "keyValue")
    : heexChromeText(ctx, "fieldFallback");
  // The VALUE is authored prose too, and it rode NO role — so the row's two
  // halves diverged: the label translated and the value shipped in English at
  // every locale (G2667 §D9).  `keyValueValue` is the same role the JSX walker
  // uses, so the key the extraction pass writes and the key HEEx reads are one
  // by construction.  Non-literals are unaffected (`localizedHeex` returns
  // undefined for them), so this is byte-identical wherever the value is an
  // expression or a nested primitive.
  const value = positionals[1] ? renderInTemplate(positionals[1], ctx, "keyValueValue") : "";
  // The testid identifies the VALUE cell, not the row — the same placement the
  // React/Vue/Svelte packs use (`<div … data-testid={testid}>{children}</div>`
  // inside `KeyValueRow`), and what the emitted page objects assume: a detail
  // read is `expect(detail.field("name")).toHaveText("Sprocket")`, which is an
  // EXACT text match and would see "Name Sprocket" if the id sat on the row.
  return `<div class="key-value-row">\n  <dt class="key-value-label">${label}</dt>\n  <dd class="key-value-value"${testidAttr}>${value}</dd>\n</div>`;
}

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

/** The value of a named arg on a call, or undefined. */
function namedArg(expr: Extract<ExprIR, { kind: "call" }>, name: string): ExprIR | undefined {
  for (let i = 0; i < expr.args.length; i++) {
    if (expr.argNames?.[i] === name) return expr.args[i];
  }
  return undefined;
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
    `    <summary aria-label="How this value was computed">?</summary>`,
    `    <dl class="loom-provenance-tree">`,
    `      <div><dt>Rule</dt><dd><code><%= ${lineage}["snapshotId"] %></code></dd></div>`,
    `      <div><dt>Value</dt><dd><%= ${lineage}["computedValue"] %></dd></div>`,
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
 *  Written rather than pinned as a parity gap because Phoenix is one of the
 *  backends that serves `/history` — a TSX-only Timeline would be exactly the
 *  silent LiveView degradation `heex-parity.test.ts` exists to catch.
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

// ---------------------------------------------------------------------------
// Closed primitive library — HEEx component dispatch.
// ---------------------------------------------------------------------------
/** Tailwind utility classes for the `Toolbar` layout.  Flex geometry is
 *  design-neutral, so it lives here rather than in a design pack; it mirrors
 *  the shadcn `primitive-toolbar` template and the layout classes in
 *  `heex-pack.ts`. */
const TOOLBAR_CLASS = "flex flex-row items-center justify-between gap-4";

/** Per-primitive HEEx spec for the generic `renderPrimitive` helper.
 *  Listed inline so the small set is easy to scan.  The registered
 *  per-primitive exports (`renderToolbar`, `renderButton`, …) bind to
 *  these specs; the typed dispatch table at
 *  src/generator/_walker/registry.ts wires them up by name. */
const CLOSED_PRIMITIVE_SPECS: Record<string, PrimitiveSpec> = {
  // `{role:"toolbar", needsName:true}` — "Actions" is the FALLBACK name; an
  // author's `label:` overrides it (and translates), which needs
  // `labelAsAriaLabel` or the label lands as a bogus `label=` attr on the div
  // while the hardcoded default stays the accessible name.
  Toolbar: {
    tag: "div",
    staticAttrs: ["class"],
    takesChildren: true,
    labelAsAriaLabel: true,
    extraAttrs: ['role="toolbar"', 'aria-label="Actions"'],
    baseClass: TOOLBAR_CLASS,
  },
  // `to:`/`disabled:`/`type:`/`variant:` are the four knobs `<.button>` declares
  // (`to` = render as a nav link, `variant` = the pack's rank vocabulary,
  // `disabled`/`type` its global/`attr`).  `icon:`/`iconSvg:`/`iconPosition:`
  // and `loading:` are NOT attributes on this spec — `renderButton` turns them
  // into an inner-block glyph and an `aria-busy` ARIA global respectively,
  // because an undeclared attribute on a Phoenix function component is a
  // compile WARNING, i.e. a build failure under
  // `mix compile --warnings-as-errors`.
  Button: {
    tag: ".button",
    takesChildren: true,
    labelAsAriaLabel: true,
    passThroughAttrs: ["to", "disabled", "type", "variant"],
    staticAttrs: ["variant", "type"],
  },
};

// Per-primitive registry-facing wrappers — bind the generic
// `renderPrimitive` helper to a specific `closedPrimitive` spec so
// the typed dispatch table can reference one named function per
// primitive (rather than re-dispatching by name inside the renderer).

/** `Slot()` → `{render_slot(@inner_block)}` — the children passthrough inside a
 *  user `component` body.  Flags `ctx.slotUsed` so the component emitter
 *  declares the matching `slot :inner_block`. */
export function renderSlot(_expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  // An INLINED component call has no `@inner_block`: its children render here,
  // in the caller's scope (`WalkContext.inlineSlot`).
  if (ctx.inlineSlot) return ctx.inlineSlot();
  ctx.slotUsed.value = true;
  return `{render_slot(@inner_block)}`;
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
      opHuman: "Delete",
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

/** A chrome sentence as a HEEx ATTRIBUTE VALUE: the `{pgettext(…)}` expression
 *  form under i18n, else the quoted escaped English. */
function heexChromeAttr(ctx: WalkContext, name: string): string {
  const { english, call } = heexChrome(ctx, name);
  return call !== undefined ? `{${call}}` : `"${escapeHeexAttr(english)}"`;
}

/** A chrome sentence in HEEx TEXT position. */
function heexChromeText(ctx: WalkContext, name: string): string {
  return labelText(heexChrome(ctx, name));
}

/** A `{ english, call? }` label in HEEx TEXT position. */
function labelText(label: { english: string; call?: string }): string {
  return label.call !== undefined ? `<%= ${label.call} %>` : escapeHeexText(label.english);
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

/** A shared `chrome.<name>` sentence.  `english` is the message; `call` —
 *  present under i18n — the Elixir expression that resolves it through gettext. */
function heexChrome(ctx: WalkContext, name: string): { english: string; call?: string } {
  const english = chromeMessage(name);
  if (!ctx.i18nPrefix) return { english };
  return { english, call: pgettextCall(chromeKey(name), english) };
}

// ---------------------------------------------------------------------------
// Standalone controlled inputs — Field / NumberField / PasswordField /
// MultilineField / SelectField / Toggle.  Each binds to a page `state` field
// via `bind:` and renders the app's `<.input>` core component with a
// `phx-change` that writes the new value back to the assign through a hoisted
// `handle_event` clause — the idiomatic LiveView "state-bound input" (the
// server-side analogue of the React controlled-input-over-useState).
//
// In-form inputs go through Form-level dispatch (renderFieldInputForField);
// this path only fires for inputs that appear *standalone* in a page body.
// A `bind:` that isn't a known state field renders a disabled stub (nothing
// to two-way bind to) so the page still renders.
// ---------------------------------------------------------------------------
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
/** The literal value of a named arg, or undefined when absent / non-literal. */
function _stringNamedLit(
  expr: Extract<ExprIR, { kind: "call" }>,
  name: string,
): string | undefined {
  const arg = namedArg(expr, name);
  return arg?.kind === "literal" && arg.lit === "string" ? arg.value : undefined;
}

export function renderToolbar(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  return renderPrimitive(CLOSED_PRIMITIVE_SPECS.Toolbar!, expr, ctx);
}

/** `CodeBlock("source", title?: "…", language?: "ts")` →
 *  `<pre class="loom-code-block"><code class="language-ts">source</code></pre>`.
 *  With an optional `title:`, wraps the `<pre>` in a `<div>` with a
 *  title bar — matches the Mantine pack's `<pre>` + title pattern.
 *  Source content is HTML-escaped to keep markup safe (the source
 *  IS user code; entities are part of valid display). */
export function renderCodeBlock(expr: Extract<ExprIR, { kind: "call" }>, ctx: WalkContext): string {
  let source = "";
  let title: string | undefined;
  let language = "";
  const positional: ExprIR[] = [];
  for (let i = 0; i < expr.args.length; i++) {
    const name = expr.argNames?.[i];
    const arg = expr.args[i]!;
    if (!name) {
      positional.push(arg);
    } else if (name === "title") {
      // The caption is a user-visible slot (`codeBlockTitle`) — translated
      // under i18n, the raw escaped literal otherwise.  The code SOURCE below
      // is deliberately not one.
      title = renderInTemplate(arg, ctx, "codeBlockTitle");
    } else if (name === "language" && arg.kind === "literal") {
      language = arg.value;
    }
  }
  if (positional[0]?.kind === "literal") source = positional[0].value;
  const testidAttr = testIdAttr(expr, ctx);
  const langClass = language ? ` class="language-${language}"` : "";
  const escaped = escapeHeexText(source);
  if (title) {
    return (
      `<div class="loom-code-block"${testidAttr}>\n` +
      `  <div class="loom-code-block-title">${title}</div>\n` +
      `  <pre><code${langClass}>${escaped}</code></pre>\n` +
      `</div>`
    );
  }
  return `<pre class="loom-code-block"${testidAttr}><code${langClass}>${escaped}</code></pre>`;
}

// ---------------------------------------------------------------------------
// Chart (HEEx leg).
// ---------------------------------------------------------------------------

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
