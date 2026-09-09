// F2 (2026-09-03 language-docs audit) — the guarded-optional form the validator
// itself RECOMMENDS must lower through each host's intrinsic idiom.
//
// `loom.intrinsic-nullable-receiver` rejects `note2.toUpper()` on a `string?`
// and names the fix in its own message: guard the deref, `x != null ?
// x.toUpper() : …`.  The lowerer then stamped the `method-call`'s
// `receiverType` as the OPTIONAL wrapper, and every backend's intrinsic
// dispatch keys off `receiverType.kind === "primitive"` — so the guarded call
// missed the snippet table and fell out of `renderMethodCall`'s bottom as a
// verbatim `.<member>(…)`.  Four of the five backends cannot compile the
// result (`this._note2.toUpper()`, `self._note2.to_upper()`, …); .NET's
// `upperFirst` fallback compiled but emitted the culture-SENSITIVE
// `ToUpper()` where the unguarded receiver gets `ToUpperInvariant()`.
//
// Pinned at both ends: the IR `receiverType`/result type stamped by
// `unwrapGuardedIntrinsicReceiver`, and the source all five backends emit —
// which must be byte-identical to what the SAME intrinsic on a non-optional
// receiver emits, since the guard is the author's business and not the
// renderer's.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** One aggregate carrying the guarded form and its unguarded twin, served by
 *  all five domain-logic backends. */
const SRC = `
system Notes {
  subdomain Core {
    context Notes {
      aggregate Note {
        title: string
        note2: string?
        derived safeUpper: string = note2 != null ? note2.toUpper() : "none"
        derived safeTrim: string = note2 != null ? note2.trim() : "none"
        derived plainUpper: string = title.toUpper()
        derived plainTrim: string = title.trim()
      }
      repository Notes for Note { }
    }
  }
  api NotesApi from Core
  storage pg { type: postgres }
  resource notesState { for: Notes, kind: state, use: pg }
  deployable nodeApi   { platform: node,   contexts: [Notes], dataSources: [notesState], serves: NotesApi, port: 3000 }
  deployable dotnetApi { platform: dotnet, contexts: [Notes], dataSources: [notesState], serves: NotesApi, port: 3001 }
  deployable javaApi   { platform: java,   contexts: [Notes], dataSources: [notesState], serves: NotesApi, port: 3002 }
  deployable pyApi     { platform: python, contexts: [Notes], dataSources: [notesState], serves: NotesApi, port: 3003 }
  deployable exApi     { platform: elixir, contexts: [Notes], dataSources: [notesState], serves: NotesApi, port: 3004 }
}
`;

/** A bare (non-call) member on an optional receiver — the narrowness control.
 *  Lowered only; a bare `.length` on a `string?` is its own gap, not F2's. */
const NARROW_SRC = `
  context Notes {
    aggregate Note {
      note2: string?
      derived len: int = note2 != null ? note2.length : 0
    }
    repository Notes for Note { }
  }
`;

/** The `method-call` node inside the guarded derived expression, by name. */
async function guardedCall(derivedName: string) {
  const { model } = await parseString(SRC, { validate: false });
  const note = allAggregates(lowerModel(model)).find((a) => a.name === "Note")!;
  const d = note.derived.find((x) => x.name === derivedName)!;
  const ternary = d.expr as Extract<ExprIR, { kind: "ternary" }>;
  expect(ternary.kind).toBe("ternary");
  return ternary.then as Extract<ExprIR, { kind: "method-call" }>;
}

describe("F2 — a guarded optional receiver keeps its intrinsic lowering (IR)", () => {
  it("stamps the UNWRAPPED primitive as the method-call's receiverType", async () => {
    const call = await guardedCall("safeUpper");
    expect(call.kind).toBe("method-call");
    // The whole defect: this used to be `{ kind: "optional", inner: … }`, which
    // every backend's `receiverType.kind === "primitive"` dispatch reads as "not
    // an intrinsic".
    expect(call.receiverType).toEqual({ kind: "primitive", name: "string" });
    // …and NOT re-read as a collection op — `contains`/`trim` name-collide with
    // the collection vocabulary, and the disambiguation keys off the same field.
    expect(call.isCollectionOp).toBe(false);
  });

  it("leaves the unguarded twin exactly as it was", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const note = allAggregates(lowerModel(model)).find((a) => a.name === "Note")!;
    const plain = note.derived.find((x) => x.name === "plainUpper")!;
    const call = plain.expr as Extract<ExprIR, { kind: "method-call" }>;
    expect(call.receiverType).toEqual({ kind: "primitive", name: "string" });
  });

  it("does NOT unwrap a non-CALL member on an optional receiver", async () => {
    // Narrowness. The unwrap must not quietly re-type every optional member
    // access — only the catalogue CALLS the validator's recommended form is
    // about.  `.length` is a bare member, not a catalogue row, so the wrapper
    // survives and nothing downstream of it changes shape.
    const { model } = await parseString(NARROW_SRC, { validate: false });
    const note = allAggregates(lowerModel(model)).find((a) => a.name === "Note")!;
    const len = note.derived.find((x) => x.name === "len")!;
    const ternary = len.expr as Extract<ExprIR, { kind: "ternary" }>;
    const member = ternary.then as Extract<ExprIR, { kind: "member" }>;
    expect(member.kind).toBe("member");
    expect(member.receiverType).toEqual({
      kind: "optional",
      inner: { kind: "primitive", name: "string" },
    });
  });
});

describe("F2 — the recommended form compiles on all five backends", () => {
  let files: Map<string, string>;

  const emitted = (suffix: string): string => {
    const key = [...files.keys()].find((k) => k.endsWith(suffix));
    expect(key, `no emitted file ending in ${suffix}`).toBeDefined();
    return files.get(key!)!;
  };

  it("generates", async () => {
    files = await generateSystemFiles(SRC);
    expect(files.size).toBeGreaterThan(0);
  });

  it("node — `.toUpperCase()` / `.trim()`, never the raw `.toUpper()`", async () => {
    files ??= await generateSystemFiles(SRC);
    const src = emitted("node_api/domain/note.ts");
    expect(src).toContain(
      'get safeUpper(): string { return this._note2 !== null ? this._note2.toUpperCase() : "none"; }',
    );
    expect(src).toContain(
      'get safeTrim(): string { return this._note2 !== null ? this._note2.trim() : "none"; }',
    );
    expect(src).not.toContain(".toUpper()");
  });

  it("dotnet — `ToUpperInvariant()`, the SAME spelling the unguarded receiver gets", async () => {
    files ??= await generateSystemFiles(SRC);
    const src = emitted("Domain/Notes/Note.cs");
    expect(src).toContain('this.Note2 != null ? this.Note2.ToUpperInvariant() : "none"');
    expect(src).toContain("this.Title.ToUpperInvariant()");
    // The culture-sensitive spelling belongs to the EF-query table only; a
    // domain body carrying it means the intrinsic table was never consulted.
    expect(src).not.toMatch(/\.ToUpper\(\)/);
  });

  it("java — `toUpperCase(Locale.ROOT)`, never `.toUpper()`", async () => {
    files ??= await generateSystemFiles(SRC);
    const src = emitted("features/notes/Note.java");
    expect(src).toContain(
      'return this.note2 != null ? this.note2.toUpperCase(java.util.Locale.ROOT) : "none";',
    );
    expect(src).not.toContain(".toUpper()");
  });

  it("python — `.upper()` / `.strip()`, never `.to_upper()` / `.trim()`", async () => {
    files ??= await generateSystemFiles(SRC);
    const src = emitted("py_api/app/domain/note.py");
    expect(src).toContain('return (self._note2.upper() if self._note2 is not None else "none")');
    expect(src).toContain('return (self._note2.strip() if self._note2 is not None else "none")');
    expect(src).not.toContain(".to_upper()");
    expect(src).not.toContain("_note2.trim()");
  });

  it("elixir — `String.upcase/1` / `String.trim/1`, never a dotted `.to_upper()`", async () => {
    files ??= await generateSystemFiles(SRC);
    const src = emitted("controllers/note_controller.ex");
    expect(src).toContain("String.upcase(record.note2)");
    expect(src).toContain("String.trim(record.note2)");
    expect(src).not.toContain("record.note2.to_upper()");
  });
});
