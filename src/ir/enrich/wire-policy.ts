// Phase ⑥ wire fact — `wirePolicy`: which request input a backend refuses, at
// which status, with which RFC 9457 body, and at which stage of the request.
//
// The same request must earn the same answer on every backend.  That answer is
// a function of three things, none of which is a backend's choice:
//
//   1. the REJECTION CLASS — what is wrong with the request (`malformed-body`,
//      `field-invalid`, `state-gate`, …), which fixes the status (or the stdlib
//      error name whose `httpStatus` override resolves it), the `title`, the
//      fixed `detail` or the sentence it is built from, and whether the body
//      carries the §3.2 `errors[]` extension;
//   2. for a `field-invalid` refusal, the FIELD REASON — `missing`,
//      `malformed-id`, `integer-range`, … — which fixes the `errors[].message`;
//   3. the STAGE the check runs at, which fixes which refusal wins when one
//      request has two defects (a malformed body to an absent id is a 400, not
//      a 404; a param-only `precondition` is a `schema` check, so a bad
//      argument to an absent id is a 422, not a 404).
//
// The fact is DERIVED, never stamped (CLAUDE.md "Derive, don't stamp"): the
// table below is a closed function of the class, and the per-model inputs (an
// `httpStatus` override map, a rule and the request members it may read, a
// wire primitive) are passed to the accessors.  Backends render what the
// accessors return; they do not pick a status, a title or a sentence.
//
// The owner rulings this table encodes:
//   - D-NUMERIC-INGRESS-STRICT — a numeric field accepts only a JSON number, a
//     `money` field only its string form; no coercion (`ingressFor`).
//   - A missing required field's `errors[].message` is `"<field> is required"`
//     (`missingFieldMessage`).
//   - A malformed `X id` inside well-formed JSON is a `field-invalid` 422 at its
//     pointer, never a 400 (`FIELD_REASONS["malformed-id"]`).
//   - A declared `error` variant an operation returns is
//     `application/problem+json` at its mapped status (`errorVariantResponse`).
//   - `""` is a valid value for a required `string` (`ingressFor("string")`).

import {
  defaultErrorStatus,
  errorTitle,
  errorTypeUri,
  resolveErrorStatus,
} from "../../util/error-defaults.js";
import { modelTextKey } from "../../util/model-text-key.js";
import { INT32_MAX, INT32_MIN, INTEGER_RANGE_MESSAGE } from "../../util/numeric-range.js";
import { FIND_ABSENT_DETAIL } from "../../util/repository-contract.js";
import { UUID_WIRE_MESSAGE } from "../../util/uuid-wire.js";
import type { InvariantIR } from "../types/loom-ir.js";
import type { WirePrimitive } from "../types/wire-types.js";
import {
  CONCURRENCY_CONFLICT_SUFFIX,
  DANGLING_REFERENCE_DETAIL,
  PROBLEM_JSON,
  problemTitle,
  UNIQUE_CONFLICT_DETAIL,
  UNSUPPORTED_MEDIA_TYPE_DETAIL,
} from "../util/openapi-errors.js";
import { classifyForWire, type SingleFieldPattern } from "../validate/invariant-classify.js";

// ---------------------------------------------------------------------------
// Stages — where a check runs
// ---------------------------------------------------------------------------

/** The stage of a request a check runs at, in the order a request meets them.
 *
 *   - `transport`  — before any parse of the body against a schema: the media
 *                    type, JSON syntax, the `If-Match` header grammar.
 *   - `schema`     — the request schema: every field's type, presence and
 *                    range, plus every rule `ruleStage` places here.
 *   - `authorize`  — a `requires` gate that reads only the principal.
 *   - `load`       — the addressed row is read; an absent one is `not-found`.
 *   - `state-gate` — a `when` gate over the loaded row.
 *   - `domain`     — the body runs: a `precondition` / `invariant` / `check`
 *                    the schema could not see, a value object built inside it,
 *                    a declared `error` variant returned.
 *   - `persist`    — the write: version check, unique key, foreign key.
 *   - `fault`      — anything no stage above modelled.
 *
 *  A request with defects at two stages answers the EARLIER stage's refusal. */
export type WireCheckStage =
  | "transport"
  | "schema"
  | "authorize"
  | "load"
  | "state-gate"
  | "domain"
  | "persist"
  | "fault";

export const WIRE_CHECK_ORDER: readonly WireCheckStage[] = [
  "transport",
  "schema",
  "authorize",
  "load",
  "state-gate",
  "domain",
  "persist",
  "fault",
];

// ---------------------------------------------------------------------------
// Rejection classes — status, title, detail, errors[]
// ---------------------------------------------------------------------------

/** What is wrong with a request, as the wire answers it. */
export type WireRejectionClass =
  | "no-route"
  | "method-not-allowed"
  | "unsupported-media-type"
  | "malformed-body"
  | "malformed-if-match"
  | "field-invalid"
  | "forbidden"
  | "not-found"
  | "state-gate"
  | "domain-floor"
  | "arithmetic-overflow"
  | "version-conflict"
  | "unique-conflict"
  | "dangling-reference"
  | "referenced-in-use"
  | "not-implemented"
  | "internal"
  | "unauthenticated";

/** Where a refusal's status comes from: a fixed framework tier, or a stdlib
 *  error name an api's `httpStatus <Error> -> <Code>` override may retarget. */
type StatusSource = { fixed: number } | { resolves: string };

/** Where a refusal's `title` comes from: a fixed string, or the IANA reason
 *  phrase of the resolved status (`problemTitle`). */
type TitleSource = { fixed: string } | "reason-phrase";

/** What a refusal's `detail` is.
 *
 *   - `fixed`    — one sentence, the same for every request.
 *   - `sentence` — `<prefix?><subject> <suffix>`, the subject interpolated where
 *                  the backend knows it (`<Aggregate> <id> not found`).
 *   - `carried`  — the text the raising site carries (the rule's message, the
 *                  `when` gate's description, the stub's file name). */
export type WireDetail =
  | { kind: "fixed"; text: string }
  | { kind: "sentence"; prefix?: string; suffix: string }
  | { kind: "carried" };

/** Whether the problem body carries the §3.2 `errors[]` extension.
 *
 *   - `none`      — never.
 *   - `per-field` — one `{ pointer, message, code? }` entry per offending field.
 *   - `rule`      — one entry for a NAMED rule or a value object refused
 *                   inside a body (pointer the rule's, or `""`); none otherwise. */
export type WireErrorsExtension = "none" | "per-field" | "rule";

interface WireRejectionRow {
  status: StatusSource;
  title: TitleSource;
  detail: WireDetail;
  errors: WireErrorsExtension;
  stage: WireCheckStage;
}

/** The sentence a malformed body earns.  It is also hono's own validator text
 *  (`hono/validator`), which is why node can let that layer raise it. */
export const MALFORMED_BODY_DETAIL = "Malformed JSON in request body";

/** The sentence a multipart upload with no `file` part earns.  It answers the
 *  `malformed-body` class (400, `problem.malformed-body`): the request cannot
 *  be read as the upload the route expects, which is a transport fault, not a
 *  field-level one. */
export const MISSING_FILE_PART_DETAIL = "Expected a 'file' part in the multipart request body";

/** The wire-validation rung's `title` and `detail` (RS-29) — deliberately not
 *  the 422 reason phrase, which belongs to the domain floor. */
const VALIDATION_FAILED_TITLE = "Validation failed";
const VALIDATION_FAILED_DETAIL = "One or more fields are invalid.";

/** The 501 `detail`: the `extern` hook's file location stays in the server log,
 *  never in the response. */
const NOT_IMPLEMENTED_DETAIL = "This operation is not implemented.";

/** The 500 `detail` (RS-28): the fault is never echoed. */
const INTERNAL_DETAIL = "internal";

/** The `detail` of an `arithmetic-overflow` refusal (RS-48). */
const INTEGER_OVERFLOW_DETAIL = "Value out of range";

const TABLE: Readonly<Record<WireRejectionClass, WireRejectionRow>> = {
  // The routing tier (RS-9): a path no router serves, and a served path asked
  // with a verb it does not serve (answered with an `Allow` header).  Never
  // retargeted — they are about the URL space, not a domain record.
  "no-route": {
    status: { fixed: 404 },
    title: "reason-phrase",
    detail: { kind: "sentence", prefix: "no route for ", suffix: "" },
    errors: "none",
    stage: "transport",
  },
  "method-not-allowed": {
    status: { fixed: 405 },
    title: "reason-phrase",
    detail: { kind: "carried" },
    errors: "none",
    stage: "transport",
  },
  "unsupported-media-type": {
    status: { fixed: 415 },
    title: "reason-phrase",
    detail: { kind: "fixed", text: UNSUPPORTED_MEDIA_TYPE_DETAIL },
    errors: "none",
    stage: "transport",
  },
  "malformed-body": {
    status: { fixed: 400 },
    title: "reason-phrase",
    detail: { kind: "fixed", text: MALFORMED_BODY_DETAIL },
    errors: "none",
    stage: "transport",
  },
  "malformed-if-match": {
    status: { fixed: 400 },
    title: "reason-phrase",
    detail: { kind: "sentence", prefix: "Malformed If-Match header: ", suffix: "" },
    errors: "none",
    stage: "transport",
  },
  "field-invalid": {
    status: { fixed: 422 },
    title: { fixed: VALIDATION_FAILED_TITLE },
    detail: { kind: "fixed", text: VALIDATION_FAILED_DETAIL },
    errors: "per-field",
    stage: "schema",
  },
  forbidden: {
    status: { resolves: "Forbidden" },
    title: "reason-phrase",
    detail: { kind: "carried" },
    errors: "none",
    stage: "authorize",
  },
  "not-found": {
    status: { resolves: "NotFound" },
    title: "reason-phrase",
    detail: { kind: "sentence", suffix: "not found" },
    errors: "none",
    stage: "load",
  },
  "state-gate": {
    status: { resolves: "Disallowed" },
    title: { fixed: "Disallowed" },
    detail: { kind: "carried" },
    errors: "none",
    stage: "state-gate",
  },
  "domain-floor": {
    status: { resolves: "DomainError" },
    title: "reason-phrase",
    detail: { kind: "carried" },
    errors: "rule",
    stage: "domain",
  },
  // Integer arithmetic in domain code left its declared range (RS-48): the
  // domain floor's status and title, one fixed sentence on every backend.
  "arithmetic-overflow": {
    status: { resolves: "DomainError" },
    title: "reason-phrase",
    detail: { kind: "fixed", text: INTEGER_OVERFLOW_DETAIL },
    errors: "none",
    stage: "domain",
  },
  "version-conflict": {
    status: { resolves: "ConcurrencyConflict" },
    title: { fixed: "Conflict" },
    detail: { kind: "sentence", suffix: CONCURRENCY_CONFLICT_SUFFIX },
    errors: "none",
    stage: "persist",
  },
  "unique-conflict": {
    status: { resolves: "UniquenessConflict" },
    title: { fixed: "Conflict" },
    detail: { kind: "fixed", text: UNIQUE_CONFLICT_DETAIL },
    errors: "none",
    stage: "persist",
  },
  // A well-formed id for a row that is not there: the domain floor's status,
  // because the request is refused on semantic grounds, not for a conflict.
  "dangling-reference": {
    status: { resolves: "DomainError" },
    title: "reason-phrase",
    detail: { kind: "fixed", text: DANGLING_REFERENCE_DETAIL },
    errors: "none",
    stage: "persist",
  },
  "referenced-in-use": {
    status: { resolves: "ReferencedInUse" },
    title: "reason-phrase",
    detail: { kind: "sentence", suffix: "is still referenced and cannot be deleted." },
    errors: "none",
    stage: "persist",
  },
  "not-implemented": {
    status: { fixed: 501 },
    title: { fixed: "Not Implemented" },
    detail: { kind: "fixed", text: NOT_IMPLEMENTED_DETAIL },
    errors: "none",
    stage: "fault",
  },
  internal: {
    status: { fixed: 500 },
    title: "reason-phrase",
    detail: { kind: "fixed", text: INTERNAL_DETAIL },
    errors: "none",
    stage: "fault",
  },
  // A request with no valid credentials (RFC 9110 §15.5.2): answered by the
  // authentication middleware, after routing and before any `requires` gate.
  unauthenticated: {
    status: { fixed: 401 },
    title: { fixed: "Unauthorized" },
    detail: { kind: "sentence", prefix: "no valid credentials for ", suffix: "" },
    errors: "none",
    stage: "authorize",
  },
};

/** The statuses a backend's framework-fault responder titles itself — the
 *  rejection classes above plus the routing tier's 404/405 and the 401 an
 *  unauthenticated request earns.  Each is titled by its reason phrase. */
export const REASON_PHRASE_STATUSES: readonly number[] = [
  400, 401, 403, 404, 405, 409, 415, 422, 500,
];

/** The IANA reason phrase of a status — what an OpenAPI response `description`
 *  and a reason-phrase `title` say.  A `title` is read through `wireTitle`,
 *  which knows the classes whose title is NOT the reason phrase. */
export function reasonPhrase(status: number): string {
  return problemTitle(status);
}

/** The IANA reason phrase a framework-fault responder titles a status with —
 *  `reasonPhrase`, plus the two statuses only that responder raises (401 for
 *  an unauthenticated request, 405 for a verb a path does not serve). */
export function frameworkReasonPhrase(status: number): string {
  if (status === 401) return "Unauthorized";
  if (status === 405) return "Method Not Allowed";
  return problemTitle(status);
}

/** Every rejection class, in table order. */
export const WIRE_REJECTION_CLASSES = Object.keys(TABLE) as readonly WireRejectionClass[];

/** A rejection class resolved against an api's `httpStatus` overrides. */
export interface WireRejection {
  class: WireRejectionClass;
  status: number;
  title: string;
  /** Always `about:blank` — a framework problem.  A declared `error` variant
   *  carries its own URI; see `errorVariantResponse`. */
  type: "about:blank";
  contentType: typeof PROBLEM_JSON;
  detail: WireDetail;
  errors: WireErrorsExtension;
  stage: WireCheckStage;
  /** The stdlib error name an override retargets, when the status resolves. */
  resolves?: string;
}

/** Resolve a rejection class.  `overrides` is the api's `httpStatus` map (the
 *  per-context `structuralErrorStatuses`); omitted ⇒ the stdlib defaults. */
export function wireRejection(
  cls: WireRejectionClass,
  overrides?: Readonly<Record<string, number>>,
): WireRejection {
  const row = TABLE[cls];
  const status =
    "fixed" in row.status
      ? row.status.fixed
      : resolveErrorStatus(row.status.resolves, overrides as Record<string, number> | undefined);
  const title = row.title === "reason-phrase" ? problemTitle(status) : row.title.fixed;
  return {
    class: cls,
    status,
    title,
    type: "about:blank",
    contentType: PROBLEM_JSON,
    detail: row.detail,
    errors: row.errors,
    stage: row.stage,
    ...("resolves" in row.status ? { resolves: row.status.resolves } : {}),
  };
}

/** The status a rejection class answers with. */
export function wireStatus(
  cls: WireRejectionClass,
  overrides?: Readonly<Record<string, number>>,
): number {
  return wireRejection(cls, overrides).status;
}

/** The `title` a rejection class answers with. */
export function wireTitle(
  cls: WireRejectionClass,
  overrides?: Readonly<Record<string, number>>,
): string {
  return wireRejection(cls, overrides).title;
}

/** The fixed `detail` of a class whose detail is the same for every request.
 *  Throws for a class whose detail is a sentence or carried — those have no
 *  single text, and a backend asking for one has picked the wrong accessor. */
export function wireFixedDetail(cls: WireRejectionClass): string {
  const d = TABLE[cls].detail;
  if (d.kind !== "fixed") throw new Error(`wirePolicy: '${cls}' has no fixed detail (${d.kind})`);
  return d.text;
}

/** The parts of a sentence `detail`: `<prefix><subject> <suffix>` (no space
 *  before an empty suffix).  Throws for a class whose detail is not one. */
export function wireSentence(cls: WireRejectionClass): { prefix: string; suffix: string } {
  const d = TABLE[cls].detail;
  if (d.kind !== "sentence") throw new Error(`wirePolicy: '${cls}' has no sentence (${d.kind})`);
  return { prefix: d.prefix ?? "", suffix: d.suffix };
}

/** The sentence a class builds for a concrete subject — `notFound("Order 7")`
 *  → `"Order 7 not found"`.  For a backend that knows the subject at
 *  generation time, and for tests; a backend interpolating at runtime renders
 *  `wireSentence` in its own string syntax. */
export function wireSentenceFor(cls: WireRejectionClass, subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  return suffix === "" ? `${prefix}${subject}` : `${prefix}${subject} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Codes — what a client localizes a refusal by
// ---------------------------------------------------------------------------
//
// Every problem body carries an RFC 7807 extension member `code`, and every
// `errors[]` entry one too.  The code IS the catalog key of the message a
// client shows (`t(code, detail, params)`), so no client keeps a mapping
// table.  `title`, `detail` and `errors[].message` stay English, for API
// callers and logs.  The English of every `problem.*` / `field.*` key is
// registered once, in `src/generator/_i18n/wire-error-text.ts` (merged into
// every catalog by `_walker/i18n-chrome.ts`).
//
//   a rejection class         problem.<class>
//   a field reason            field.<reason>
//   a named rule              <Ctx>.<Owner>.rule.<name>   (its `MessageIR.key`)
//   an unnamed rule           field.rule / problem.domain-floor
//   a declared error variant  <Ctx>.<Error>.message
//
// The extension member `params` carries the values a message's placeholders
// name, and is present only where the class or reason names any.

/** The wire `code` of a rejection class: `problem.<class>`. */
export function wireCode(cls: WireRejectionClass): string {
  return `problem.${cls}`;
}

/** The `params` a rejection class's body carries, by name.  Each is a
 *  placeholder its catalog text may use. */
const WIRE_PARAMS: Readonly<Partial<Record<WireRejectionClass, readonly string[]>>> = {
  // The id the server logged the fault under — what a user quotes to support.
  // The fault itself is never echoed.
  internal: ["requestId"],
};

/** The param names a rejection class carries (empty for most). */
export function wireParams(cls: WireRejectionClass): readonly string[] {
  return WIRE_PARAMS[cls] ?? [];
}

/** The wire `code` of a field reason, on its `errors[]` entry: `field.<reason>`. */
export function fieldCode(reason: FieldRejectionReason): string {
  return `field.${reason}`;
}

/** The `params` a field reason's `errors[]` entry carries, by name. */
const FIELD_PARAMS: Readonly<Partial<Record<FieldRejectionReason, readonly string[]>>> = {
  "integer-range": ["min", "max"],
  "money-grammar": ["value"],
  "money-range": ["value"],
  min: ["min"],
  "greater-than": ["min"],
  max: ["max"],
  "less-than": ["max"],
  "min-length": ["min"],
  "max-length": ["max"],
  length: ["length"],
};

/** The `params` an `integer-range` refusal carries: the int32 bounds. */
export const INTEGER_RANGE_PARAMS: Readonly<{ min: number; max: number }> = {
  min: INT32_MIN,
  max: INT32_MAX,
};

/** The param names a field reason carries (empty for most). */
export function fieldParams(reason: FieldRejectionReason): readonly string[] {
  return FIELD_PARAMS[reason] ?? [];
}

/** The wire `code` of a DECLARED error variant (`or OutOfStock`): its
 *  message's identity key `<Ctx>.<Error>.message`.  Its `params` are the error
 *  record's own fields. */
export function errorVariantCode(ctx: string | undefined, name: string): string {
  return modelTextKey({ ctx, type: name, facet: "message" });
}

// ---------------------------------------------------------------------------
// Field reasons — the `errors[].message` of a `field-invalid` refusal
// ---------------------------------------------------------------------------

/** Why one field of a request is refused.
 *
 *   - `missing`        — a required key is absent (or the body is empty).
 *   - `malformed-id`   — a `guid` id (path `{id}`, query or body `X id`) that is
 *                        not a uuid.
 *   - `integer-range`  — an `int` literal outside int32 (RS-42).
 *   - `money-grammar`  — a `money` string outside `^-?[0-9]+(\.[0-9]+)?$`.
 *   - `money-range`    — a `money` string whose integer part overflows the
 *                        column.
 *   - `rule`           — a wire-stage rule (`ruleStage`): its rule text,
 *                        or the unnamed default (RS-43).
 *   - `type-mismatch`  — the JSON value has the wrong type (`"5"` for an `int`,
 *                        `12.5` for a `money`).  Not yet one sentence: each
 *                        framework's own text, so the golden compares status
 *                        and pointer only.
 *   - a {@link FieldLimitReason} — one side of a field's declared limit (an
 *                        unnamed single-field `check` / `invariant` /
 *                        `precondition` the wire absorbs as a native bound),
 *                        the bound in `params`.  See `fieldLimitChecks`. */
export type FieldRejectionReason =
  | "missing"
  | "malformed-id"
  | "integer-range"
  | "money-grammar"
  | "money-range"
  | "rule"
  | "type-mismatch"
  | FieldLimitReason;

/** One side of a declared field limit — the reasons a native field constraint
 *  answers, each with its bound in `params`.
 *
 *   - `min` / `max`                {min} / {max}  — an inclusive numeric bound.
 *   - `greater-than` / `less-than` {min} / {max}  — an exclusive one (a strict
 *                                  bound on a non-integer field; on an `int`,
 *                                  `> 0` folds to `min 1`).
 *   - `min-length` / `max-length`  {min} / {max}  — a string length, counted in
 *                                  code points.
 *   - `length`                     {length}       — an exact string length.
 *   - `pattern`                    (none)         — a `matches("…")` regex.
 *
 *  A two-sided limit (`n >= 1 && n <= 10`, a length range) is TWO checks, one
 *  per side, so the code names the side the value broke, and each backend's
 *  native validator (pydantic `ge`/`le`, Bean Validation `@Min`/`@Max`, Ecto
 *  `validate_number`) maps onto it without a combined form.  An unnamed rule
 *  of any other shape keeps the generic `rule`; a specific message for one
 *  needs a named rule. */
export type FieldLimitReason =
  | "min"
  | "max"
  | "greater-than"
  | "less-than"
  | "min-length"
  | "max-length"
  | "length"
  | "pattern";

/** Every field-limit reason, in a stable order. */
export const FIELD_LIMIT_REASONS: readonly FieldLimitReason[] = [
  "min",
  "max",
  "greater-than",
  "less-than",
  "min-length",
  "max-length",
  "length",
  "pattern",
];

/** One check a field limit implies: the reason a value failing it answers,
 *  the `params` its `errors[]` entry carries, and the bound or regex it tests.
 *  A backend renders the comparison from `reason` + `bound` (or `regex`) and
 *  never re-reads the pattern. */
export interface FieldLimitCheck {
  reason: FieldLimitReason;
  params: Readonly<Record<string, number>>;
  /** The number a numeric / length check compares against. */
  bound?: number;
  /** The `matches("…")` source, on a `pattern` check. */
  regex?: string;
}

/** The checks a recognised single-field constraint implies, one per side —
 *  THE constraint → reason mapping every backend's wire validator and every
 *  client form validator reads, so a bound refuses with the same code and
 *  params everywhere. */
export function fieldLimitChecks(pattern: SingleFieldPattern): FieldLimitCheck[] {
  const one = (reason: FieldLimitReason, param: string, n: number): FieldLimitCheck => ({
    reason,
    params: { [param]: n },
    bound: n,
  });
  switch (pattern.kind) {
    case "min":
      return [one(pattern.exclusive ? "greater-than" : "min", "min", pattern.n)];
    case "max":
      return [one(pattern.exclusive ? "less-than" : "max", "max", pattern.n)];
    case "between":
      return [one("min", "min", pattern.lo), one("max", "max", pattern.hi)];
    case "len-min":
      return [one("min-length", "min", pattern.n)];
    case "len-max":
      return [one("max-length", "max", pattern.n)];
    case "len-eq":
      return [one("length", "length", pattern.n)];
    case "len-range":
      return [one("min-length", "min", pattern.lo), one("max-length", "max", pattern.hi)];
    case "regex":
      return [{ reason: "pattern", params: {}, regex: pattern.pattern }];
  }
}

/** The refusal message every backend renders for an out-of-range money value —
 *  shaped like the grammar refusal so a client sees one family of messages. */
export const MONEY_RANGE_MESSAGE = "Money out of range";

/** How each reason's `errors[].message` is built.
 *
 *   - `fixed`          — one text.
 *   - `field-sentence` — `<field> <suffix>`, the field being the LAST key of
 *                        the pointer (`/lines/0/qty` → `qty`).
 *   - `value-sentence` — `<prefix>: <JSON of the refused value>`.
 *   - `carried`        — the rule's own text.
 *   - `limit`          — the whole limit's field-named sentence
 *                        (`singleFieldMessage`: "Priority must be at least
 *                        1"), the same on both sides of a two-sided limit.
 *   - `framework`      — not ruled yet; the framework's text. */
export type FieldMessage =
  | { kind: "fixed"; text: string }
  | { kind: "field-sentence"; suffix: string }
  | { kind: "value-sentence"; prefix: string }
  | { kind: "carried" }
  | { kind: "limit" }
  | { kind: "framework" };

export const FIELD_REASONS: Readonly<Record<FieldRejectionReason, FieldMessage>> = {
  missing: { kind: "field-sentence", suffix: "is required" },
  "malformed-id": { kind: "fixed", text: UUID_WIRE_MESSAGE },
  "integer-range": { kind: "fixed", text: INTEGER_RANGE_MESSAGE },
  "money-grammar": { kind: "value-sentence", prefix: "Invalid decimal" },
  "money-range": { kind: "value-sentence", prefix: MONEY_RANGE_MESSAGE },
  rule: { kind: "carried" },
  "type-mismatch": { kind: "framework" },
  min: { kind: "limit" },
  max: { kind: "limit" },
  "greater-than": { kind: "limit" },
  "less-than": { kind: "limit" },
  "min-length": { kind: "limit" },
  "max-length": { kind: "limit" },
  length: { kind: "limit" },
  pattern: { kind: "limit" },
};

/** The fixed message of a reason that has one. */
export function fieldFixedMessage(reason: FieldRejectionReason): string {
  const m = FIELD_REASONS[reason];
  if (m.kind !== "fixed") throw new Error(`wirePolicy: '${reason}' has no fixed message`);
  return m.text;
}

/** The text after the field name in a `field-sentence` reason. */
export function fieldSentenceSuffix(reason: FieldRejectionReason): string {
  const m = FIELD_REASONS[reason];
  if (m.kind !== "field-sentence")
    throw new Error(`wirePolicy: '${reason}' is not a field sentence`);
  return m.suffix;
}

/** The text before `: <value>` in a `value-sentence` reason. */
export function fieldValuePrefix(reason: FieldRejectionReason): string {
  const m = FIELD_REASONS[reason];
  if (m.kind !== "value-sentence")
    throw new Error(`wirePolicy: '${reason}' is not a value sentence`);
  return m.prefix;
}

/** `"<field> is required"` — the message for an absent required field. */
export function missingFieldMessage(field: string): string {
  return `${field} ${fieldSentenceSuffix("missing")}`;
}

// ---------------------------------------------------------------------------
// Ingress — which JSON value a request field accepts
// ---------------------------------------------------------------------------

/** The JSON type a request field of a wire primitive accepts.  Exactly one:
 *  no backend coerces across JSON types (D-NUMERIC-INGRESS-STRICT), so `"5"`
 *  for an `int` and `12.5` for a `money` are `type-mismatch` refusals. */
export type IngressJsonType = "number" | "string" | "boolean" | "object" | "any";

export interface WireIngress {
  json: IngressJsonType;
  /** Whether the empty string is a valid value (a required `string` accepts
   *  `""`; an author who needs a non-blank value writes a `check`). */
  emptyStringValid: boolean;
  /** The field reason a value of the right JSON type but the wrong shape earns
   *  (`money-grammar` for `"1.2.3"`, `malformed-id` for `"nope"`). */
  shapeReason?: FieldRejectionReason;
  /** The field reason an out-of-range value earns. */
  rangeReason?: FieldRejectionReason;
}

const INGRESS: Readonly<Record<WirePrimitive, WireIngress>> = {
  int: { json: "number", emptyStringValid: false, rangeReason: "integer-range" },
  long: { json: "number", emptyStringValid: false },
  decimal: { json: "number", emptyStringValid: false },
  money: {
    json: "string",
    emptyStringValid: false,
    shapeReason: "money-grammar",
    rangeReason: "money-range",
  },
  string: { json: "string", emptyStringValid: true },
  bool: { json: "boolean", emptyStringValid: false },
  datetime: { json: "string", emptyStringValid: false },
  date: { json: "string", emptyStringValid: false },
  guid: { json: "string", emptyStringValid: false, shapeReason: "malformed-id" },
  json: { json: "any", emptyStringValid: true },
  File: { json: "object", emptyStringValid: false },
};

/** What a body field of this wire primitive accepts. */
export function ingressFor(primitive: WirePrimitive): WireIngress {
  return INGRESS[primitive];
}

// ---------------------------------------------------------------------------
// Rules — which stage a precondition / invariant is checked at
// ---------------------------------------------------------------------------

/** The stage a rule is checked at for a request whose members are `available`
 *  (an operation's params, a create's input fields).  A rule that reads only
 *  those members is a `schema` check — refused as `field-invalid` with an
 *  `errors[]` entry, before the row loads; any other rule is a `domain` check,
 *  refused at the domain floor after the load.
 *
 *  A backend whose schema layer cannot express a `schema`-stage rule must
 *  still refuse it as `field-invalid` (a hand-written arm), never fall back to
 *  the domain floor.
 *
 *  On a merge-patch `update` (RS-48) every member is optional, so a `schema`
 *  rule is judged there only when the patch carries every member it reads
 *  (`ruleMembers`, `src/ir/util/merge-patch.ts`); a patch that leaves one out
 *  defers it to the domain floor over the merged state. */
export function ruleStage(
  rule: InvariantIR,
  available: ReadonlySet<string>,
): Extract<WireCheckStage, "schema" | "domain"> {
  return classifyForWire(rule, { available }) ? "schema" : "domain";
}

// ---------------------------------------------------------------------------
// Declared error variants
// ---------------------------------------------------------------------------

/** How a declared `error` variant an operation or find returns is served:
 *  `application/problem+json` at its mapped status, its `/errors/<kebab>` type
 *  URI, its humanized name as `title`, its fields as extension members — never
 *  a 200 tagged union.  Checked at the `domain` stage. */
export interface ErrorVariantResponse {
  status: number;
  title: string;
  /** The humanized name again: a declared error carries no sentence of its
   *  own, its fields ride the body as extension members. */
  detail: string;
  type: string;
  contentType: typeof PROBLEM_JSON;
  stage: "domain";
}

/** The `detail` a FIND's absence answers with — see `util/repository-contract.ts`. */
export { FIND_ABSENT_DETAIL };

/** The `none` unit's response: the stdlib `NotFound`, never retargeted by an
 *  error-variant override map. */
export function noneVariantResponse(): ErrorVariantResponse {
  return errorVariantResponse("NotFound");
}

export function errorVariantResponse(
  name: string,
  overrides?: Readonly<Record<string, number>>,
): ErrorVariantResponse {
  return {
    status: overrides?.[name] ?? defaultErrorStatus(name),
    title: errorTitle(name),
    detail: errorTitle(name),
    type: errorTypeUri(name),
    contentType: PROBLEM_JSON,
    stage: "domain",
  };
}

/** The `detail` a `notFound` statement answers with: the rule text, else
 *  the not-found sentence over the statement's subject (`Ticket not found`),
 *  `Resource` standing in when the statement names none.  One function so all
 *  five backends say the same words. */
export function notFoundStmtDetail(st: { detail?: string; subject?: string }): string {
  return st.detail ?? wireSentenceFor("not-found", st.subject ?? "Resource");
}
