// `loom.unknown-primitive-member` — a BARE member read on a PRIMITIVE receiver
// whose name is neither a field-shaped member (`string.length`) nor an entry in
// the scalar-intrinsic catalogue (`src/util/intrinsics.ts`).
//
// The defect this closes (F-040): the CALL form has been gated since the stdlib
// landed (`loom.intrinsic-unknown`), but the bare READ was left un-gated on
// purpose — "a field-style member should not need a catalogue change to parse".
// So `s.totallyMadeUpMember` typed as `unknown`, every operand validator
// suppressed on `unknown` (anti-double-reporting), and the invented member
// reached the emitters verbatim:
//
//     derived bad3: string = m.amount     // `money` is a Decimal, not a record
//     invariant m.amount > 0              // a business rule that can never fire
//
// Measured on the un-refused input: node emits `this._m.amount` (TS2339 — its
// own compile catches it), .NET `this.M.Amount` on a `decimal` and Java
// `this.m.amount()` on a `BigDecimal` likewise; but PYTHON emits
// `self._m.amount` on a `Decimal` (an `AttributeError` raised from inside the
// invariant check at request time) and ELIXIR emits `record.m.amount` on a
// `Decimal` struct in the controller's response map. The two dynamically-typed
// backends compile the hallucination happily.
//
// This is the direct counter-example to the README's "Validation gates catch
// hallucinated fields … before any code is emitted", which is why the gate is
// worth its own code and its own per-primitive wording.
//
// FAIL-OPEN / NO-FALSE-POSITIVE OBLIGATIONS, all pinned below:
//   • `string.length` is legal — the one field-shaped scalar member, and the
//     corpus sweep found 224 uses of it. A blanket refusal is not an option,
//     which is why the judgement reads a TABLE (`PRIMITIVE_FIELDS`) plus the
//     intrinsic catalogue rather than refusing every member.
//   • a reachable name written bare (`s.trim`, `s.matches`) is NOT this code's
//     business — the missing call has its own (`loom.intrinsic-bare`).
//   • an unknown CALL stays `loom.intrinsic-unknown`'s. One mistake, one
//     diagnostic, either way.
//   • a non-primitive receiver (record, `X id`, collection, enum) is untouched.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const wrap = (body: string, extra = "") => `system S {
  subdomain M { context C {
    ${body}
    ${extra}
  } }
}`;

const errs = async (body: string, extra = ""): Promise<string[]> =>
  (await parseString(wrap(body, extra), { validate: true })).errors;

/** Only THIS code's diagnostics — every variant of its wording says the
 *  receiver is a primitive / opaque / wire-only value. */
const primErrs = (e: string[]) =>
  e.filter((s) => /is a PRIMITIVE|OPAQUE blob|wire-only REFERENCE/.test(s));

describe("loom.unknown-primitive-member — invented member read on a primitive", () => {
  // --- fires ---------------------------------------------------------------

  it("flags an invented member on a `string`, and names what IS available", async () => {
    const e = await errs(`aggregate A with crudish {
        s: string
        derived bad: string = s.totallyMadeUpMember
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'totallyMadeUpMember' is not a member of 'string'/);
    // The tail enumerates the real surface — the field table first, then the
    // intrinsic catalogue, so the author can see the name they meant.
    expect(e.join("\n")).toMatch(/Available on 'string': length, trim, toUpper/);
    // NOT the record code: "correct the typo on the record" is wrong advice
    // when the receiver has no members at all.
    expect(e.filter((s) => /is not a member of '[A-Z]/.test(s))).toHaveLength(0);
  });

  it("flags an invented member on an `int`", async () => {
    const e = await errs(`aggregate A with crudish {
        n: int
        derived bad: string = n.alsoInvented
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'alsoInvented' is not a member of 'int'/);
  });

  it("flags `money.amount` with money-specific wording that names the fix", async () => {
    // The 20-minutes-lost case: `money` LOOKS like a record because every
    // other language models it as one. The message has to say that Loom's
    // `money` is the decimal itself, and show the record to declare instead.
    const e = await errs(`aggregate A with crudish {
        m: money
        derived bad: string = m.amount
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
    const text = e.join("\n");
    expect(text).toMatch(/'amount' is not a member of 'money'/);
    expect(text).toMatch(/'money' is a PRIMITIVE — a precise decimal/);
    expect(text).toMatch(/no '\.amount' and no '\.currency'/);
    expect(text).toMatch(/valueobject Money \{ amount: money currency: string \}/);
  });

  it("flags the never-firing invariant — the shape that made this worth a gate", async () => {
    // `invariant limit.amount > deductible.amount` over two `money` fields:
    // it validated clean, and python/elixir emitted it as a rule that can
    // never hold. Both reads are reported, at their own file:line:col.
    const e = await errs(`aggregate Cover with crudish {
        limit: money
        deductible: money
        invariant limit.amount > deductible.amount
      }
      repository Covers for Cover { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(2);
  });

  it("flags a member on `datetime`, `bool` and `guid` alike", async () => {
    const e = await errs(`aggregate A with crudish {
        at: datetime
        flag: bool
        gid: guid
        derived b1: string = at.year
        derived b2: string = flag.value
        derived b3: string = gid.rawValue
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(3);
    expect(e.join("\n")).toMatch(/'year' is not a member of 'datetime'/);
    expect(e.join("\n")).toMatch(/'value' is not a member of 'bool'/);
    expect(e.join("\n")).toMatch(/'rawValue' is not a member of 'guid'/);
  });

  it("flags a member on an OPTIONAL primitive — one optional level is unwrapped", async () => {
    // Membership and nullability are different questions, and member
    // RESOLUTION unwraps a single optional level everywhere else. An unknown
    // member outranks the deref: there is nothing to deref to.
    const e = await errs(`aggregate A with crudish {
        nickname: string?
        derived bad: string = nickname.totallyMadeUp
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'totallyMadeUp' is not a member of 'string'/);
  });

  it("flags a member on `json` — the interior is deliberately unmodelled", async () => {
    const e = await errs(`aggregate A with crudish {
        blob: json
        derived bad: string = blob.anything
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'json' is an OPAQUE blob/);
    expect(e.join("\n")).toMatch(/valueobject/);
  });

  it("flags a member on `File` — it has a wire shape, but not a readable one", async () => {
    const e = await errs(`aggregate A with crudish {
        attachment: File
        derived bad: string = attachment.url
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/wire-only REFERENCE/);
    expect(e.join("\n")).toMatch(/FileLink/);
  });

  it("reports once, without cascading down the chain", async () => {
    const e = await errs(`aggregate A with crudish {
        s: string
        derived bad: string = s.bogus.deeper
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(1);
  });

  // --- does NOT fire -------------------------------------------------------

  it("accepts `string.length` — the one field-shaped scalar member", async () => {
    // 224 sites in the corpus. This is why the gate reads a table.
    const e = await errs(`aggregate A with crudish {
        s: string
        derived n: int = s.length
        invariant s.length > 2
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e, e.join("\n")).toHaveLength(0);
  });

  it("accepts `string.length` on an OPTIONAL string", async () => {
    const e = await errs(`aggregate A with crudish {
        nickname: string?
        derived n: int = nickname.length
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
  });

  it("accepts intrinsic CALLS on every scalar receiver", async () => {
    const e = await errs(`aggregate A with crudish {
        s: string
        n: int
        m: money
        derived up: string = s.toUpper()
        derived hit: bool = s.matches("^a")
        derived a: int = n.abs()
        derived r: money = m.round(2)
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e, e.join("\n")).toHaveLength(0);
  });

  it("leaves a reachable name written BARE to `loom.intrinsic-bare`", async () => {
    // `s.trim` (the call's parens forgotten) is a different mistake with a
    // different fix, and it already had a code. One mistake, one diagnostic.
    const e = await errs(`aggregate A with crudish {
        s: string
        derived bad: string = s.trim
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e.join("\n")).toMatch(/'trim'/);
    expect(e.length, e.join("\n")).toBe(1);
  });

  it("leaves bare `.matches` to `loom.intrinsic-bare` too", async () => {
    // The string regex operation is reachable but is not a catalogue row, so
    // `absentPrimitiveMember` resolves the name and the bare form is reported
    // as the missing call it is (previously: no diagnostic at all).
    const e = await errs(`aggregate A with crudish {
        s: string
        derived bad: string = s.matches
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e.length, e.join("\n")).toBe(1);
    expect(e.join("\n")).toMatch(/'matches'/);
  });

  it("leaves an unknown CALL to `loom.intrinsic-unknown`", async () => {
    const e = await errs(`aggregate A with crudish {
        s: string
        derived bad: string = s.totallyMadeUp()
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e.length, e.join("\n")).toBe(1);
    expect(e.join("\n")).toMatch(/no intrinsic '\.totallyMadeUp\(\)'/);
  });

  // --- non-primitive receivers are untouched -------------------------------

  it("does not touch collection member reads (`.count`, `.where(λ)`)", async () => {
    const e = await errs(`aggregate Order with crudish {
        code: string
        contains lines: Line[]
        derived n: int = lines.count
        derived anyQty: bool = lines.any(l => l.qty > 0)
        entity Line { qty: int }
      }
      repository Orders for Order { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e, e.join("\n")).toHaveLength(0);
  });

  it("leaves a record's unknown member to `loom.unknown-member`", async () => {
    const e = await errs(`aggregate Order with crudish {
        code: string
        contains lines: Line[]
        derived n: int = lines.count
        derived bad: bool = lines.any(l => l.nope > 0)
        entity Line { qty: int }
      }
      repository Orders for Order { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e.join("\n")).toMatch(/'nope' is not a member of 'Line'/);
  });

  it("does not touch a value-object member read", async () => {
    const e = await errs(`valueobject Money2 { amount: money  currency: string }
      aggregate A with crudish {
        price: Money2
        derived amt: money = price.amount
        derived cur: string = price.currency
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e, e.join("\n")).toHaveLength(0);
  });

  it("does not touch an enum-value reference", async () => {
    const e = await errs(`enum Status { open, closed }
      aggregate A with crudish {
        status: Status
        derived isOpen: bool = status == Status.open
      }
      repository As for A { }`);
    expect(primErrs(e), e.join("\n")).toHaveLength(0);
    expect(e, e.join("\n")).toHaveLength(0);
  });
});
