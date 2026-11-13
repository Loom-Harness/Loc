// ---------------------------------------------------------------------------
// `Modal` on a Phoenix LiveView page: a `<.button phx-click={show_modal(id)}>`
// trigger and a `<.modal>` whose body hosts the form the LiveView binds in
// `mount`.  `heexTarget.renderModal` reaches it.
// ---------------------------------------------------------------------------

import type { ExprIR } from "../../ir/types/loom-ir.js";
import { elixirString, humanize, snake } from "../../util/naming.js";
import { giveUpText } from "../_walker/give-up.js";
import { opDialogChrome } from "../_walker/i18n-chrome.js";
import { paramLabelOwner } from "../_walker/model-text-sites.js";
import { gateActionButton } from "./heex-action.js";
import { renderFieldInputForField } from "./heex-form.js";
import { testIdAttr } from "./heex-markup.js";
import { homeOf, opLabelCall } from "./heex-model-text.js";
import {
  escapeHeexText,
  registerBinding,
  renderChild,
  renderExpr,
  renderInTemplate,
  type WalkContext,
} from "./heex-walker-core.js";
import { formChromeAttr } from "./i18n.js";
import { updateSeamGates } from "./vanilla/gate.js";
import { liveViewCallsOp, servesCanProbe } from "./vanilla/op-form.js";

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
