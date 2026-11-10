// Where a type form may be written — the one table.
//
// A type FORM is a shape the author writes (`A or B`, `T paged`, a named
// `payload U = A | B`, an `event` / payload record, `slot`, `action`).  A
// POSITION is where the type sits (an aggregate field, an operation return, a
// `queryHandler` param, a union variant, …).  Every form × position pair is
// either allowed, allowed only when the union carries an `error` variant, or
// refused with a stable `loom.*` code.
//
// Every reader takes its answer from here: the scope provider (which positions
// offer transport records in front of the ordinary types), the position checks
// in `validators/type-positions.ts`, the text of each position diagnostic (the
// allowed positions it lists), and the generated `docs/type-positions.md`.
// A form never written in a position the table does not name falls back to the
// form's refusal, so a new position is refused until a row admits it.

import type { AstNode } from "langium";

/** The type forms whose position is restricted.  Primitives, ids, enums, value
 *  objects, aggregates and parts have no position rule here: their limits are
 *  identity rules (`loom.bare-aggregate-in-type`, `loom.cross-aggregate-entity-part`). */
export type TypeForm =
  | "inline-union"
  | "named-union"
  | "transport-record"
  | "carrier"
  | "slot"
  | "action";

export const TYPE_FORMS: readonly TypeForm[] = [
  "inline-union",
  "named-union",
  "transport-record",
  "carrier",
  "slot",
  "action",
];

export type TypePosition =
  | "aggregate-field"
  | "part-field"
  | "valueobject-field"
  | "payload-field"
  | "event-field"
  | "user-field"
  | "operation-param"
  | "operation-return"
  | "domain-service-param"
  | "domain-service-return"
  | "function-param"
  | "function-return"
  | "create-param"
  | "create-return"
  | "command-handler-param"
  | "command-handler-return"
  | "query-handler-param"
  | "query-handler-return"
  | "component-param"
  | "page-param"
  | "union-variant"
  | "other";

/** Every position, in the order the docs table lists them, with the phrase a
 *  diagnostic uses to name it. */
export const TYPE_POSITIONS: readonly { position: TypePosition; label: string }[] = [
  { position: "aggregate-field", label: "an aggregate field" },
  { position: "part-field", label: "an entity-part field" },
  { position: "valueobject-field", label: "a value-object field" },
  { position: "payload-field", label: "a payload field" },
  { position: "event-field", label: "an event field" },
  { position: "user-field", label: "a `user` claim field" },
  { position: "operation-param", label: "an operation or aggregate `create` parameter" },
  { position: "operation-return", label: "an operation return" },
  { position: "domain-service-param", label: "a domainService operation parameter" },
  { position: "domain-service-return", label: "a domainService operation return" },
  { position: "function-param", label: "a function parameter" },
  { position: "function-return", label: "a function return" },
  { position: "create-param", label: "a workflow `create` parameter" },
  { position: "create-return", label: "a workflow `create` result" },
  { position: "command-handler-param", label: "a commandHandler parameter" },
  { position: "command-handler-return", label: "a commandHandler return" },
  { position: "query-handler-param", label: "a queryHandler parameter" },
  { position: "query-handler-return", label: "a queryHandler return" },
  { position: "component-param", label: "a ui component parameter" },
  { position: "page-param", label: "a ui page parameter" },
  { position: "union-variant", label: "a union variant or `match` arm" },
  { position: "other", label: "this position" },
];

/** The verdict for one form × position pair.
 *  - `allowed` — the form may be written here;
 *  - `with-error-variant` — an inline union here is an expected failure, so it
 *    needs at least one `error` variant (and a handler that is not `extern`);
 *  - `refused` — the position check raises `code` (`slug` picks the message);
 *  - `unwritable` — the grammar cannot put the form there. */
export type PositionRule =
  | { readonly verdict: "allowed" }
  | { readonly verdict: "unwritable" }
  | { readonly verdict: "with-error-variant" }
  | { readonly verdict: "refused"; readonly code: string; readonly slug?: string };

interface FormRow {
  /** How the docs and diagnostics name the form. */
  readonly label: string;
  /** The positions that admit the form (every other position refuses it). */
  readonly admits: Partial<Record<TypePosition, "allowed" | "with-error-variant">>;
  /** The refusal every other position raises (`slug` picks its message). */
  readonly refusal: { readonly code: string; readonly slug?: string };
  /** A position whose refusal carries its own message. */
  readonly refusalSlugs?: Partial<Record<TypePosition, string>>;
  /** Positions the grammar cannot put the form in. */
  readonly unwritable?: readonly TypePosition[];
}

/** The positions a transport record (an `event` / `payload` / `command` /
 *  `query` / `response` / `error` named as a type) may stand in: the transport
 *  boundaries.  Anywhere else it would type a stored value or a domain
 *  signature with a wire record. */
const TRANSPORT_BOUNDARY: Partial<Record<TypePosition, "allowed">> = {
  "create-param": "allowed",
  "create-return": "allowed",
  "command-handler-param": "allowed",
  "command-handler-return": "allowed",
  "query-handler-param": "allowed",
  "query-handler-return": "allowed",
  "union-variant": "allowed",
};

const ROWS: Readonly<Record<TypeForm, FormRow>> = {
  // `A or B` — the tagged union wire is emitted at the top of a return; no
  // backend stores one or renders one nested inside a record.
  "inline-union": {
    label: "inline union `A or B`",
    admits: {
      "operation-return": "allowed",
      "domain-service-return": "allowed",
      "create-return": "with-error-variant",
      "command-handler-return": "with-error-variant",
      "query-handler-return": "with-error-variant",
    },
    refusal: { code: "loom.union-position" },
    refusalSlugs: { "payload-field": "payload-field" },
    // `or` binds loosest, so a union variant is never itself an `or`.
    unwritable: ["union-variant"],
  },
  // `payload U = A | B` named as a type.  A value of it is always one of its
  // variants, so a return declared as the union itself cannot be answered, and
  // no backend renders it as a field or a domain parameter.
  "named-union": {
    label: "named union `payload U = A | B`",
    admits: {
      "create-param": "allowed",
      "command-handler-param": "allowed",
      "query-handler-param": "allowed",
      "union-variant": "allowed",
    },
    refusal: { code: "loom.union-position", slug: "named" },
  },
  "transport-record": {
    label: "event or payload record",
    admits: TRANSPORT_BOUNDARY,
    refusal: { code: "loom.transport-type-position" },
  },
  // `T paged` — a read envelope, so a transport shape like a union.
  carrier: {
    label: "carrier `T paged`",
    admits: { "query-handler-return": "allowed", "payload-field": "allowed" },
    refusal: { code: "loom.generic-position" },
  },
  // UI-only markers: values that flow as markup / callbacks into a component.
  slot: {
    label: "`slot`",
    admits: { "component-param": "allowed" },
    refusal: { code: "loom.slot-out-of-position" },
  },
  action: {
    label: "`action`",
    admits: { "component-param": "allowed" },
    refusal: { code: "loom.action-out-of-position" },
  },
};

/** The verdict for `form` written in `position`. */
export function positionRule(form: TypeForm, position: TypePosition): PositionRule {
  const row = ROWS[form];
  const admitted = row.admits[position];
  if (admitted) return { verdict: admitted };
  if (row.unwritable?.includes(position)) return { verdict: "unwritable" };
  const slug = row.refusalSlugs?.[position] ?? row.refusal.slug;
  return slug
    ? { verdict: "refused", code: row.refusal.code, slug }
    : { verdict: "refused", code: row.refusal.code };
}

/** True when `form` may stand in `position` without a further condition. */
export function positionAdmits(form: TypeForm, position: TypePosition): boolean {
  return positionRule(form, position).verdict === "allowed";
}

export function formLabel(form: TypeForm): string {
  return ROWS[form].label;
}

export function positionLabel(position: TypePosition): string {
  return TYPE_POSITIONS.find((p) => p.position === position)?.label ?? position;
}

/** The positions that admit `form`, as the phrase a diagnostic lists them in
 *  (`a queryHandler return or a payload field`). */
export function admittedPositionsText(form: TypeForm): string {
  const labels = TYPE_POSITIONS.filter((p) => ROWS[form].admits[p.position]).map((p) => {
    const cond = ROWS[form].admits[p.position] === "with-error-variant";
    return cond ? `${p.label} (with an \`error\` variant)` : p.label;
  });
  if (labels.length <= 1) return labels[0] ?? "nowhere";
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Position classification over the AST
// ---------------------------------------------------------------------------

/** The position of a `TypeRef` (or a union `TypeAtom`), read off its container. */
export function typeRefPosition(t: AstNode): TypePosition {
  if (t.$type === "TypeAtom") return "union-variant";
  const c = t.$container;
  if (!c) return "other";
  if (t.$containerProperty === "returnType") {
    switch (c.$type) {
      case "Operation":
        return "operation-return";
      case "DomainServiceOperation":
        return "domain-service-return";
      case "FunctionDecl":
        return "function-return";
      case "WorkflowCreateDecl":
        return "create-return";
      case "CommandHandler":
        return "command-handler-return";
      case "QueryHandler":
        return "query-handler-return";
      default:
        return "other";
    }
  }
  if (c.$type === "UserField") return "user-field";
  if (c.$type === "Property") {
    switch (c.$container?.$type) {
      case "Aggregate":
        return "aggregate-field";
      case "EntityPart":
        return "part-field";
      case "ValueObject":
        return "valueobject-field";
      case "PayloadDecl":
        return "payload-field";
      case "EventDecl":
        return "event-field";
      default:
        return "other";
    }
  }
  if (c.$type === "Parameter") {
    switch (c.$container?.$type) {
      case "Operation":
      case "Create":
      case "Destroy":
        return "operation-param";
      case "DomainServiceOperation":
        return "domain-service-param";
      case "FunctionDecl":
        return "function-param";
      case "WorkflowCreateDecl":
        return "create-param";
      case "CommandHandler":
        return "command-handler-param";
      case "QueryHandler":
        return "query-handler-param";
      case "Component":
        return "component-param";
      case "Page":
        return "page-param";
      default:
        return "other";
    }
  }
  return "other";
}

/** The position a `NamedType` stands in: a union variant when it heads an
 *  `A or B` (each arm of the union is a variant), else its `TypeRef`'s. */
export function namedTypePosition(namedType: AstNode): TypePosition {
  const t = namedType.$container;
  if (!t) return "other";
  if (t.$type === "TypeAtom") return "union-variant";
  if (
    t.$type === "TypeRef" &&
    ((t as { alternatives?: unknown[] }).alternatives?.length ?? 0) > 0
  ) {
    return "union-variant";
  }
  return t.$type === "TypeRef" ? typeRefPosition(t) : "other";
}
