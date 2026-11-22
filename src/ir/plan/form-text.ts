// The parse rule of a form's text inputs — one rule per field kind, decided
// once and rendered by every frontend.
//
// A form field whose input is free text but whose wire value is not (`int`,
// `long`, `decimal`, `money`) turns the user's text into the wire value here,
// or refuses it.  Two frontends parsing the same text differently is a bug the
// user sees as a different stored value (`abc` saved as `0` on one target and
// refused on another), so the rule is a plan fact, not a per-target choice:
//
//   - the text is read with its surrounding whitespace trimmed;
//   - a blank text is the field's absence: an optional field sends `null`
//     (P-UI-6), a required one sends its kind's zero (`0`, `"0"` — a blank is a
//     value and the server decides, ruling 82);
//   - otherwise the text must match the kind's grammar and, for an integer, sit
//     inside the kind's range; a text that does not is refused in its field
//     with the kind's code and message, and nothing is sent (P-UI-5);
//   - an accepted text is sent as typed: a number kind as the number the
//     digits spell, `money` as the trimmed text itself (its wire is a string).
//
// The grammars and ranges are the wire codec's (`src/ir/util/codec.ts`), so a
// form refuses exactly the text the server would refuse.  `FORM_TEXT_CASES` is
// the rule's conformance table: every target's emitted parser is run over it.

import { MONEY_WIRE_GRAMMAR, scalarCodec } from "../util/codec.js";

/** The field kinds whose input is text but whose wire value is parsed. */
export const FORM_TEXT_KINDS = ["int", "long", "decimal", "money"] as const;
export type FormTextKind = (typeof FORM_TEXT_KINDS)[number];

/** Why a text is refused, as the wire `errors[].code` the server would answer
 *  for the same value, with the English fallback a form shows. */
export interface FormTextRefusal {
  readonly code: "field.type-mismatch" | "field.money-grammar" | "field.integer-range";
  readonly message: string;
  /** The values the message's catalog text fills its placeholders from; a
   *  refused text adds itself as `value`. */
  readonly params?: Readonly<Record<string, number | string>>;
}

export interface FormTextRule {
  readonly kind: FormTextKind;
  /** The grammar the trimmed text must match: an anchored regex source every
   *  target's regex dialect reads the same way (ASCII classes only). */
  readonly grammar: string;
  /** The JSON type the accepted value is sent as. */
  readonly wire: "number" | "string";
  /** What a required field sends for a blank text. */
  readonly blankZero: 0 | "0";
  /** Inclusive bounds an integer's value must sit in. */
  readonly range?: { readonly min: number; readonly max: number };
  /** The refusal of a text outside the grammar. */
  readonly refusal: FormTextRefusal;
  /** The refusal of an integer outside its range. */
  readonly rangeRefusal?: FormTextRefusal;
}

/** Digits with an optional leading `-`. */
const INTEGER_GRAMMAR = "^-?[0-9]+$";

function integerRule(kind: "int" | "long"): FormTextRule {
  const wire = scalarCodec(kind).wire;
  if (wire.form !== "integer") throw new Error(`form-text: ${kind} is not an integer codec`);
  return {
    kind,
    grammar: INTEGER_GRAMMAR,
    wire: "number",
    blankZero: 0,
    range: { min: wire.min, max: wire.max },
    refusal: { code: "field.type-mismatch", message: "Invalid value" },
    rangeRefusal: {
      code: "field.integer-range",
      message: "Must be between {min} and {max}",
      params: { min: wire.min, max: wire.max },
    },
  };
}

const RULES: Readonly<Record<FormTextKind, FormTextRule>> = {
  int: integerRule("int"),
  long: integerRule("long"),
  // A plain `decimal` is a JSON number; its text takes money's grammar (no
  // exponent, grouping or leading `+`), so `1e5`, `NaN` and `12,5` are refused
  // rather than read by a host parser that accepts them.
  decimal: {
    kind: "decimal",
    grammar: MONEY_WIRE_GRAMMAR,
    wire: "number",
    blankZero: 0,
    refusal: { code: "field.type-mismatch", message: "Invalid value" },
  },
  money: {
    kind: "money",
    grammar: MONEY_WIRE_GRAMMAR,
    wire: "string",
    blankZero: "0",
    refusal: { code: "field.money-grammar", message: "Invalid decimal {value}" },
  },
};

/** The rule of one text kind. */
export function formTextRule(kind: FormTextKind): FormTextRule {
  return RULES[kind];
}

/** The text kind a primitive's form input parses as, or `undefined` for a
 *  primitive whose input is not parsed text (a string, a date, a flag). */
export function formTextKindOf(primitive: string): FormTextKind | undefined {
  return (FORM_TEXT_KINDS as readonly string[]).includes(primitive)
    ? (primitive as FormTextKind)
    : undefined;
}

/** What one text parses to. */
export type FormTextOutcome =
  | { readonly ok: true; readonly value: number | string | null }
  | { readonly ok: false; readonly refusal: FormTextRefusal };

/** The rule, evaluated: the reference every target's parser is held to. */
export function parseFormText(
  kind: FormTextKind,
  text: string,
  optional: boolean,
): FormTextOutcome {
  const rule = RULES[kind];
  const t = text.trim();
  if (t === "") return { ok: true, value: optional ? null : rule.blankZero };
  if (!new RegExp(rule.grammar).test(t)) return refused(rule.refusal, t);
  if (rule.wire === "string") return { ok: true, value: t };
  const n = Number(t);
  if (rule.range && (n < rule.range.min || n > rule.range.max || !Number.isSafeInteger(n))) {
    return refused(rule.rangeRefusal ?? rule.refusal, t);
  }
  if (!Number.isFinite(n)) return refused(rule.refusal, t);
  return { ok: true, value: n };
}

/** A refusal of `text`: the text rides as the `value` its message may name. */
function refused(refusal: FormTextRefusal, text: string): FormTextOutcome {
  return { ok: false, refusal: { ...refusal, params: { ...refusal.params, value: text } } };
}

/** One conformance case: a text typed into a field of `kind`. */
export interface FormTextCase {
  readonly kind: FormTextKind;
  readonly text: string;
  readonly optional: boolean;
}

/** The conformance table.  Each target's emitted parser is run over every
 *  case and must agree with {@link parseFormText} — the value sent, or the
 *  refusal's code. */
export const FORM_TEXT_CASES: readonly FormTextCase[] = (() => {
  const texts: Record<FormTextKind, readonly string[]> = {
    int: [
      "42",
      "-7",
      " 12 ",
      "abc",
      "12abc",
      "1.5",
      "1e3",
      "+3",
      "2147483647",
      "2147483648",
      "-2147483649",
    ],
    long: ["1234567890123456", "9007199254740992", "abc", "1.5"],
    decimal: ["1.25", "-0.5", "3", "abc", "1e5", "NaN", "Infinity", "12,5", ".5", "1."],
    money: ["120.50", "0.0001", "-3", "007", "abc", "12abc", "1.2.3", "12,50", "+1", "1e2"],
  };
  const out: FormTextCase[] = [];
  for (const kind of FORM_TEXT_KINDS) {
    for (const optional of [false, true]) {
      for (const text of ["", "   ", ...texts[kind]]) out.push({ kind, text, optional });
    }
  }
  return out;
})();
