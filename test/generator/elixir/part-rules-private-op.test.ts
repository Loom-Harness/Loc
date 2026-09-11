// ---------------------------------------------------------------------------
// Phoenix (vanilla Ecto) — the three rules M-T6.55 found DROPPED, each with one
// enforcement site and no diagnostic:
//
//   F14  a PART-level `check` / `invariant`.  `Line.changeset/2` only `cast`,
//        and a part has no other enforcement site on Ecto, so both forms were
//        enforced nowhere while node/.NET/java/python assert them at the part's
//        domain floor.
//   F15  a GUARDED single-field invariant.  The native `validate_*` path refuses
//        a guard by design (`singleFieldConstraints` returns null for one), and
//        the residual `validate_invariants/1` carrier ASKED THAT SAME CLASSIFIER
//        — so both doors shut and nothing emitted the implication.  The messaged
//        twin additionally lost its `loom_code` wire key.
//   F24  a bare call to a PRIVATE operation.  It rendered
//        `_ = nil  # vanilla: bare call to 'recompute' (no callable target);
//        record unchanged` — and the claim was false: the public twin
//        `recompute_invoice/2` sits in the same module.  Fixing it has TWO
//        halves; the fixture's `total` is assigned ONLY by the callee, so a
//        half-fix that emits the call and leaves `persistPutBodies` walking the
//        caller's own statements still never writes the column.
//
// Every assertion here is over EMITTED SOURCE, and the corpus fixture's elixir
// `mix compile` leg is what proves the emitted module is well-formed (a helper
// call to a function that does not exist is exactly what that leg catches).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("part-rules-private-op", "vanilla");

async function files(): Promise<Map<string, string>> {
  return generateSystemFiles(SRC);
}

/** One `def`/`defp` body from an emitted Elixir module, by function name. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`def ${name}(`);
  const startP = src.indexOf(`defp ${name}(`);
  const at = start >= 0 ? start : startP;
  if (at < 0) throw new Error(`no function ${name} in module`);
  const end = src.indexOf("\n  end", at);
  return src.slice(at, end);
}

describe("elixir vanilla — part rules, guarded invariants, private-op calls (M-T6.55)", () => {
  describe("F14 — a part-level `check` / `invariant` is enforced in the part's own changeset", () => {
    it("`check qty > 0` becomes a native validate_number on the PART changeset", async () => {
      const line = (await files()).get("d/lib/d/billing/line.ex")!;
      const cs = fnBody(line, "changeset");
      expect(cs).toContain("cast(attrs, [:sku, :qty])");
      // The rule itself — absent entirely before the fix.
      expect(cs).toContain("validate_number(:qty, greater_than_or_equal_to: 1)");
    });

    it("the part's own `invariant sku.length > 2` becomes a code-point length rule", async () => {
      const line = (await files()).get("d/lib/d/billing/line.ex")!;
      const cs = fnBody(line, "changeset");
      // `.length` counts CODE POINTS on every backend (RS-31), so it is the
      // hand-rolled `validate_change` closure, not Ecto's grapheme-counting
      // `validate_length/3`.
      expect(cs).toContain("validate_change(:sku");
      expect(cs).toContain("length(String.to_charlist(value)) >= 3");
    });
  });

  describe("F15 — a GUARDED single-field invariant emits its implication", () => {
    it("the message-less guarded rule is enforced, guard and all", async () => {
      const cs = (await files()).get("d/lib/d/billing/invoice_changeset.ex")!;
      const fn = fnBody(cs, "validate_invariants");
      expect(fn).toContain("if data.tax_rate > 0 do");
      expect(fn).toContain("length(String.to_charlist(data.note)) > 0");
      expect(fn).toContain('add_error(changeset, :note, "must satisfy: note.length > 0")');
    });

    it("the MESSAGED guarded rule keeps its `loom_code` wire key", async () => {
      const cs = (await files()).get("d/lib/d/billing/invoice_changeset.ex")!;
      const fn = fnBody(cs, "validate_invariants");
      expect(fn).toContain('"tax rate must stay under 100"');
      expect(fn).toMatch(/loom_code: "msg\.[a-z0-9]+"/);
    });

    it("an UNGUARDED single-field rule still takes its native line, not the residual carrier", async () => {
      // The two carriers must not double-emit: this is the byte-identical half
      // of the F15 fix, and the assertion that would fail if the widening had
      // been done by dropping the native path's guard test instead.
      const cs = (await files()).get("d/lib/d/billing/invoice_changeset.ex")!;
      const fn = fnBody(cs, "validate_invariants");
      // `note.length > 0` appears ONCE — under the guard, not again bare.
      const occurrences = fn.split("length(String.to_charlist(data.note)) > 0").length - 1;
      expect(occurrences).toBe(1);
    });
  });

  describe("F24 — a bare private-operation call runs, and its write persists", () => {
    it("the call is emitted as a real transform, not a discarding no-op", async () => {
      const facade = (await files()).get("d/lib/d/billing.ex")!;
      const bump = fnBody(facade, "bump_invoice");
      expect(bump).toContain("record = __op_recompute(record)");
      // The sentinel that used to stand here.
      expect(facade).not.toContain("no callable target");
    });

    it("the helper exists, is module-local, and carries the callee's body", async () => {
      const facade = (await files()).get("d/lib/d/billing.ex")!;
      expect(facade).toContain("defp __op_recompute(record) do");
      const helper = fnBody(facade, "__op_recompute");
      expect(helper).toContain("record = %{record | total: record.tax_rate * 2}");
    });

    it("the CALLER's persist tail writes the column the CALLEE assigned", async () => {
      // The second half.  `total` is assigned only inside `recompute`, so a
      // `persistPutBodies` that walks `op.statements` alone computes the
      // mutation and drops it at `Repo.update` — green output, unchanged row.
      const facade = (await files()).get("d/lib/d/billing.ex")!;
      const bump = fnBody(facade, "bump_invoice");
      expect(bump).toContain("Ecto.Changeset.force_change(:tax_rate, record.tax_rate)");
      expect(bump).toContain("Ecto.Changeset.force_change(:total, record.total)");
    });

    it("the pure domain core carries the same helper (its bodies call it too)", async () => {
      const schema = (await files()).get("d/lib/d/billing/invoice.ex")!;
      expect(schema).toContain("defp __op_recompute(record) do");
      expect(fnBody(schema, "bump")).toContain("record = __op_recompute(record)");
    });
  });
});
