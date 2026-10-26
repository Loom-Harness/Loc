// ---------------------------------------------------------------------------
// The effect vocabulary of each body position.
//
// A workflow `create` / `on` / `handle` body and a `commandHandler` /
// `queryHandler` body all lower to `WorkflowStmtIR`, and what each body DOES is
// its effect list (`ir/util/effects.ts`): loads, creates, mutations, saves,
// deletes, emits, calls, a return.  Which of those a body may have is decided
// by WHERE it sits, never by the statement shape that produced the effect, so
// it is stated once, here, as one table over (position × effect sort):
//
//   * a `queryHandler` is read-only: it may load, read, call and return, and
//     nothing else (`loom.query-handler-saves`);
//   * a command `create` of a workflow that keeps no instance row (state
//     fields, none id-shaped, not event-sourced) can neither write nor read
//     that state (`loom.workflow-uncorrelated-state-write` /
//     `loom.workflow-uncorrelated-state-read`) — the backends disagreed on
//     what such a body meant (an unbound `this` / `state` on node, .NET, java
//     and elixir; a request-scoped scratch on python), so validity cannot
//     depend on the target;
//   * every other position admits the whole vocabulary.
//
// Beside the table, one invariant holds in EVERY position that admits a
// mutation: each aggregate mutation is covered by a save of the same local in
// its own scope or an enclosing one (`loom.workflow-mutation-unsaved`).  The
// mutation is the callee's declared effect (`a.withdraw(x)` bound with `let`,
// a `mutating` domain service bound with `let`), while the save list is
// derived from the statement shapes; a mutation no save covers is a change the
// body would silently lose on every backend.
//
// What this file does NOT own, because the construct has no IR form by the
// time it could look: an explicit `Repo.save(x)` (`loom.workflow-explicit-save`,
// phase ④), a positional `Agg.create(a, b)` (`loom.workflow-positional-create`,
// phase ④), and a state write in an `eventSourced` workflow
// (`loom.workflow-event-sourced-mutation`, phase ④).  The aggregate-side
// positions (operation, applier) lower to `StmtIR` and keep their statement
// vocabulary in `body-stmt-vocabulary.ts`.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import {
  type BodyPosition,
  type EffectIR,
  type EffectScopeIR,
  type EffectSort,
  effectSort,
} from "../../types/effect-ir.js";
import type {
  BoundedContextIR,
  CommandHandlerIR,
  QueryHandlerIR,
  WorkflowIR,
} from "../../types/loom-ir.js";
import type { OriginRef } from "../../types/origin.js";
import { contextSaveResolver } from "../../util/domain-service-tier.js";
import { bodyEffects, type EffectBodyIR } from "../../util/effects.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The codes a position's vocabulary refuses an effect with. */
export type VocabularyRefusal =
  | "loom.query-handler-saves"
  | "loom.workflow-uncorrelated-state-write"
  | "loom.workflow-uncorrelated-state-read";

export type Admission = "admit" | VocabularyRefusal;

const QH = "loom.query-handler-saves" as const;

/** Which effects each body position admits.  A `Record` over both closed
 *  unions, so a new position or a new effect sort must be ruled on in every
 *  row rather than defaulting to "admitted". */
export const BODY_EFFECT_VOCABULARY: Readonly<
  Record<BodyPosition, Readonly<Record<EffectSort, Admission>>>
> = {
  "workflow-command-create": {
    load: "admit",
    create: "admit",
    "mutate-aggregate": "admit",
    "mutate-state": "admit",
    "read-state": "admit",
    persist: "admit",
    delete: "admit",
    emit: "admit",
    "call-service": "admit",
    "call-resource": "admit",
    "call-remote-api": "admit",
    return: "admit",
  },
  "workflow-command-create-uncorrelated": {
    load: "admit",
    create: "admit",
    "mutate-aggregate": "admit",
    "mutate-state": "loom.workflow-uncorrelated-state-write",
    "read-state": "loom.workflow-uncorrelated-state-read",
    persist: "admit",
    delete: "admit",
    emit: "admit",
    "call-service": "admit",
    "call-resource": "admit",
    "call-remote-api": "admit",
    return: "admit",
  },
  "workflow-reactor": {
    load: "admit",
    create: "admit",
    "mutate-aggregate": "admit",
    "mutate-state": "admit",
    "read-state": "admit",
    persist: "admit",
    delete: "admit",
    emit: "admit",
    "call-service": "admit",
    "call-resource": "admit",
    "call-remote-api": "admit",
    return: "admit",
  },
  "workflow-handle": {
    load: "admit",
    create: "admit",
    "mutate-aggregate": "admit",
    "mutate-state": "admit",
    "read-state": "admit",
    persist: "admit",
    delete: "admit",
    emit: "admit",
    "call-service": "admit",
    "call-resource": "admit",
    "call-remote-api": "admit",
    return: "admit",
  },
  "command-handler": {
    load: "admit",
    create: "admit",
    "mutate-aggregate": "admit",
    "mutate-state": "admit",
    "read-state": "admit",
    persist: "admit",
    delete: "admit",
    emit: "admit",
    "call-service": "admit",
    "call-resource": "admit",
    "call-remote-api": "admit",
    return: "admit",
  },
  // A `call-service` is admitted: a `mutating` service's writes show up as the
  // `mutate-aggregate` effects of the arguments it mutates.
  "query-handler": {
    load: "admit",
    create: QH,
    "mutate-aggregate": QH,
    "mutate-state": QH,
    "read-state": "admit",
    persist: QH,
    delete: QH,
    emit: QH,
    "call-service": "admit",
    "call-resource": "admit",
    "call-remote-api": "admit",
    return: "admit",
  },
};

/** A refusal reported only when the named one is not: a body that both writes
 *  and reads uncorrelated state is told about the write. */
const SUBSUMED_BY: Readonly<Partial<Record<VocabularyRefusal, VocabularyRefusal>>> = {
  "loom.workflow-uncorrelated-state-read": "loom.workflow-uncorrelated-state-write",
};

/** The position of each of a workflow's bodies. */
function workflowBodies(wf: WorkflowIR): { position: BodyPosition; body: EffectBodyIR }[] {
  const stateFields = wf.stateFields ?? [];
  const uncorrelated =
    stateFields.length > 0 && !wf.eventSourced && !stateFields.some((f) => f.type.kind === "id");
  return [
    ...wf.creates.map((c) => ({
      position: (c.triggerKind !== "command"
        ? "workflow-reactor"
        : uncorrelated
          ? "workflow-command-create-uncorrelated"
          : "workflow-command-create") as BodyPosition,
      body: c,
    })),
    ...(wf.subscriptions ?? []).map((o) => ({ position: "workflow-reactor" as const, body: o })),
    ...(wf.handlers ?? []).map((h) => ({ position: "workflow-handle" as const, body: h })),
  ];
}

interface Site {
  readonly owner: string;
  readonly source: string;
  readonly origin?: OriginRef;
}

/** Check one body against its position's row and the save-coverage invariant.
 *  `refusal` renders the message for a refusal code; `fields` are the state
 *  fields the refused effects touch, in first-seen order. */
function checkBody(
  position: BodyPosition,
  effects: readonly EffectIR[],
  site: Site,
  refusal: (code: VocabularyRefusal, fields: readonly string[]) => string,
  diags: LoomDiagnostic[],
): void {
  const row = BODY_EFFECT_VOCABULARY[position];
  const refused = new Map<VocabularyRefusal, string[]>();
  for (const e of effects) {
    const admission = row[effectSort(e)];
    if (admission === "admit") continue;
    const fields = refused.get(admission) ?? [];
    const field =
      e.kind === "read-state"
        ? e.field
        : e.kind === "mutate" && e.target.kind === "state"
          ? e.target.field
          : undefined;
    if (field && !fields.includes(field)) fields.push(field);
    refused.set(admission, fields);
  }
  for (const [code, fields] of refused) {
    const over = SUBSUMED_BY[code];
    if (over && refused.has(over)) continue;
    diags.push({
      severity: "error",
      code: code,
      message: refusal(code, fields),
      source: site.source,
      origin: site.origin,
    });
  }
  if (row["mutate-aggregate"] === "admit") checkMutationsSaved(effects, site, diags);
}

function scopeCovers(outer: readonly EffectScopeIR[], inner: readonly EffectScopeIR[]): boolean {
  if (outer.length > inner.length) return false;
  return outer.every((s, i) => JSON.stringify(s) === JSON.stringify(inner[i]));
}

/** `loom.workflow-mutation-unsaved` — every aggregate mutation of a local the
 *  body bound to an aggregate (a load, a create, a loop or `if let` variable)
 *  is covered by a save of that local in its scope or an enclosing one.  A
 *  mutation of any other name is the symptom of an error reported elsewhere
 *  (`loom.workflow-unknown-binding`, `loom.workflow-cross-context-repository`),
 *  not a second defect; an aggregate passed to a mutating service as an
 *  expression has no name to save under, and is reported. */
function checkMutationsSaved(
  effects: readonly EffectIR[],
  site: Site,
  diags: LoomDiagnostic[],
): void {
  const persists = effects.filter((e) => e.kind === "persist");
  const bound = new Set<string>();
  for (const e of effects) {
    if ((e.kind === "load" || e.kind === "create") && e.binds) bound.add(e.binds);
    for (const s of e.scope) bound.add(s.var);
  }
  const reported = new Set<string>();
  for (const e of effects) {
    if (e.kind !== "mutate" || e.target.kind !== "aggregate") continue;
    const t = e.target;
    if (t.name !== "" && !bound.has(t.name)) continue;
    const covered =
      t.name !== "" && persists.some((p) => p.name === t.name && scopeCovers(p.scope, e.scope));
    if (covered) continue;
    const call = t.service ? `${t.service}.${t.op}` : `${t.name}.${t.op}`;
    const key = `${t.name}\u0000${call}`;
    if (reported.has(key)) continue;
    reported.add(key);
    diags.push({
      severity: "error",
      code: "loom.workflow-mutation-unsaved",
      message:
        t.name === ""
          ? diagMessage("loom.workflow-mutation-unsaved#unbound", {
              owner: site.owner,
              call,
              aggName: t.aggName,
            })
          : diagMessage("loom.workflow-mutation-unsaved", {
              owner: site.owner,
              call,
              name: t.name,
            }),
      source: site.source,
      origin: site.origin,
    });
  }
}

/** Every body of `wf`, against its position's vocabulary. */
export function validateWorkflowEffectVocabulary(
  ctx: BoundedContextIR,
  wf: WorkflowIR,
  diags: LoomDiagnostic[],
): void {
  const resolver = contextSaveResolver(ctx);
  const site: Site = {
    owner: `workflow '${wf.name}'`,
    source: `${ctx.name}/${wf.name}`,
    origin: wf.origin,
  };
  const refusal = (code: VocabularyRefusal, fields: readonly string[]): string => {
    const quoted = fields.map((f) => `'${f}'`).join(", ");
    switch (code) {
      case "loom.workflow-uncorrelated-state-write":
        return diagMessage("loom.workflow-uncorrelated-state-write", {
          name: wf.name,
          fields: quoted,
        });
      case "loom.workflow-uncorrelated-state-read":
        return diagMessage("loom.workflow-uncorrelated-state-read", {
          name: wf.name,
          fields: quoted,
        });
      case "loom.query-handler-saves":
        // No workflow position refuses with the query-handler code.
        return diagMessage("loom.query-handler-saves", { name: ctx.name, qName: wf.name });
      default: {
        const _exhaustive: never = code;
        return _exhaustive;
      }
    }
  };
  for (const { position, body } of workflowBodies(wf)) {
    checkBody(position, bodyEffects(body, resolver), site, refusal, diags);
  }
}

/** Every DSL-bodied `commandHandler` / `queryHandler` of `ctx`, against its
 *  position's vocabulary.  An `extern` handler has no body to analyse. */
export function validateHandlerEffectVocabulary(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  const resolver = contextSaveResolver(ctx);
  const check = (
    position: BodyPosition,
    kind: string,
    h: CommandHandlerIR | QueryHandlerIR,
  ): void => {
    if (h.extern) return;
    const site: Site = {
      owner: `${kind} '${h.name}'`,
      source: `${ctx.name}/${h.name}`,
      origin: ctx.origin,
    };
    checkBody(
      position,
      bodyEffects(h, resolver),
      site,
      () => diagMessage("loom.query-handler-saves", { name: ctx.name, qName: h.name }),
      diags,
    );
  };
  for (const c of ctx.commandHandlers ?? []) check("command-handler", "commandHandler", c);
  for (const q of ctx.queryHandlers ?? []) check("query-handler", "queryHandler", q);
}

/** True when a handler body writes — has an effect the read-only position
 *  refuses.  The transport-edge twin of `loom.query-handler-saves`. */
export function handlerWrites(
  ctx: BoundedContextIR,
  h: CommandHandlerIR | QueryHandlerIR,
): boolean {
  const row = BODY_EFFECT_VOCABULARY["query-handler"];
  return bodyEffects(h, contextSaveResolver(ctx)).some((e) => row[effectSort(e)] !== "admit");
}
