import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { createInputFields, wireCreateDefault } from "../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { javaRequiredSets } from "../_helpers/java-openapi-annotations.js";
import { parseString } from "../_helpers/parse.js";
import { BACKEND_LABEL, BACKENDS, type Backend } from "../fixtures/corpus/backends.js";
import { corpusSource, generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// Create-input default parity (G1's silent-drop arm, caught statically).
//
// `= <expr>` on a field moves it from the REQUIRED to the OMITTABLE side of the
// create request, and the backend must apply the declared value when the client
// omits it.  `wireCreateDefault` (src/ir/enrich/wire-projection.ts) is the ONE
// IR seam that says so — every backend is supposed to render it into its native
// default slot.
//
// G1 (#2316) is what happens when one doesn't.  A `this`-reading default broke
// the boot on Hono and Python, but on .NET and Java it was SILENTLY DROPPED:
// the emitted create surface simply lost the default, quietly turning an
// optional input into a required one.  Nothing caught that — the projects
// compiled, no sentinel was written, and the divergence is invisible to the
// wire-golden differential because a dropped default only shows up in a request
// that OMITS the field, which no behavioural spec sent.
//
// So this asserts the seam is honoured on all five, per backend mechanism.  The
// mechanisms genuinely differ — this is not five spellings of one check:
//
//   node    zod `.default(1)` on the create-request schema
//   python  a Pydantic model field initialiser, `qty: int = 1`
//   dotnet  a record positional-parameter default, `int Qty = 1`
//   java    NO schema default — a boxed component plus a service-side coalesce,
//           `request.qty() != null ? request.qty() : 1`
//   elixir  an Ecto schema default, `field :qty, :integer, default: 1`
//
// A backend that drops the default matches NONE of them, which is the point:
// "emitted nothing" has no textual signature of its own, so the gate looks for
// the positive mechanism instead.
// ---------------------------------------------------------------------------

const FEATURE = "field-defaults";

/** Does `files` show `field` carrying a create-time default on `backend`? */
function appliesDefault(files: Map<string, string>, backend: Backend, field: string): boolean {
  const all = [...files.values()].join("\n");
  const pascal = field.charAt(0).toUpperCase() + field.slice(1);
  switch (backend) {
    case "node":
      // zod: `qty: z.coerce.number().int()….default(1),` inside CreateXRequest.
      // ANCHORED at line start rather than excluding commas: an `int` field's
      // chain now carries `.openapi({ format: "int32" })`, whose brace has a
      // comma in it, and the old `[^,\n]*` stopped dead there — reporting a
      // dropped default that was still being emitted. The anchor is what keeps
      // the match from drifting in from a previous field, which is what the
      // comma exclusion was really doing.
      return new RegExp(`^\\s*${field}:[^\\n]*\\.default\\(`, "m").test(
        createBlock(all, "z.object"),
      );
    case "python":
      // Pydantic: `qty: int = 1` on the create model (the update model has no
      // initialiser, so an `=` on this name anywhere in a request class is the
      // create one).
      return new RegExp(`^\\s*${field}:\\s*[^=\\n]+=\\s*\\S`, "m").test(all);
    case "dotnet":
      // record positional default: `int Qty = 1`.
      return new RegExp(`\\b${pascal}\\s*=\\s*[^,)\\n]+[,)]`).test(all);
    case "java":
      // DOMAIN-FACTORY coalesce on the boxed parameter: `qty != null ? qty : 1`
      // in `Item.create(...)`.  This used to look for the same shape in the
      // SERVICE (`request.qty() != null ? …`) — the coalesce moved into the
      // factory so one site per backend owns the rule, which is also what makes
      // the omission genuinely testable from the domain layer.
      return new RegExp(`e\\.${field} = ${field} != null \\? ${field} :`).test(all);
    case "vanilla":
      // Ecto schema default.
      return new RegExp(`field :${field},[^\\n]*default:`).test(all);
  }
}

/** Narrow to the zod object literals, so a `.default()` on an UPDATE schema
 *  can't stand in for a missing one on the create schema. */
function createBlock(source: string, marker: string): string {
  const at = source.indexOf(`CreateItemRequest = ${marker}`);
  if (at < 0) return source;
  // `\n})`, not the first `})`: an `int` field's chain now ends
  // `.openapi({ format: "int32" })`, and slicing at the first `})` truncated
  // the block at that field — every field after it vanished from the search
  // and read as "no default emitted". The object's own closer is the one at
  // the start of a line.
  const end = source.indexOf("\n})", at);
  return source.slice(at, end < 0 ? undefined : end);
}

/** The CLIENT-SUPPLIABLE fields carrying an explicit wire default — derived,
 *  not listed, so extending the fixture extends the gate.
 *
 *  Intersected with `createInputFields` deliberately: `version` (spliced by the
 *  `versioned` capability as `version: int = 1`) also carries a default, but it
 *  is a `token`-access field the client never supplies at create, so no backend
 *  owes it a create-request default slot. */
async function defaultedFields(): Promise<string[]> {
  const { model } = await parseString(corpusSource(FEATURE).replaceAll("__PLATFORM__", "node"));
  const loom = enrichLoomModel(lowerModel(model));
  return allAggregates(loom).flatMap((agg) =>
    createInputFields(agg)
      .filter((f) => wireCreateDefault(f) !== undefined)
      .map((f) => f.name),
  );
}

describe("create-input defaults reach every backend's create surface", () => {
  it("the fixture declares wire defaults for the IR to carry", async () => {
    // Guards the gate itself: if the fixture stopped declaring defaults, every
    // assertion below would vacuously pass.
    expect(await defaultedFields()).toEqual(expect.arrayContaining(["qty", "note", "active"]));
  });

  for (const backend of BACKENDS) {
    it(`${BACKEND_LABEL[backend]} applies each declared default`, async () => {
      const files = await generateCorpusCase(FEATURE, backend);
      for (const field of await defaultedFields()) {
        expect(
          appliesDefault(files, backend, field),
          `${BACKEND_LABEL[backend]} emits no create-time default for '${field}' — ` +
            `wireCreateDefault() carries one, so the client omitting it will not ` +
            `receive the declared value (this is G1's silent-drop shape)`,
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// COMMAND-side: an omitted bool must be REJECTED, never silently defaulted.
//
// The sibling half of the rule above, and the one that eats data.  A create
// default is a construction rule; on a command there is nothing to construct,
// so "absent" cannot mean "the default" — it can only mean "the client did not
// send a required field".  The fixture's `configure(active, archived, flag)` is
// that command.
//
// Applying a wire default there silently rewrote stored state: for
// `active: bool = true`, a body omitting `active` set it to FALSE — not even the
// declared default, because the value came from a hardcoded implicit-bool rule
// rather than the model.  This is the proto3 lesson: a wire-level default makes
// "absent" indistinguishable from "the default value", which is why proto3
// dropped custom field defaults and had to re-add explicit field presence.
//
// This is RS-26 (`test/conformance/semantics-rules.ts`, docs/conformance-
// semantics.md) — the exact inverse of RS-6, which says an omitted CREATE bool
// materializes its declared default.  No two backends express it the same way:
//
//   node     zodFor's `create-body` context keeps the implicit-bool rule off
//            every other body, and body bools are UNCOERCED
//   python   requestFieldDecl's `slot`
//   elixir   the `require_command_params` plug (what enforces) AND the
//            OpenApiSpex schema (what documents)
//   java     boxed components + `RequiredSet`
//   dotnet   `[property: JsonRequired]` — `[Required]` tests for null, and an
//            omitted value type binds to 0/false
//
// The crudish `update` is the merge-patch twin (RS-47): there an omitted bool
// keeps its STORED value — required by nothing, defaulted by nothing.  The
// second describe below holds that half.
// ---------------------------------------------------------------------------

// Empty, and kept as a ratchet rather than deleted: a backend that REGRESSES
// gets an entry here plus an RS-26 `targets` row, instead of the assertion
// being quietly relaxed.
const COMMAND_BOOL_WAIVED: Partial<Record<Backend, string>> = {};

/** Is `field` REQUIRED (no default, no optionality) in `<Op>ItemRequest`? */
function requestRequiresField(
  files: Map<string, string>,
  backend: Backend,
  op: "Configure" | "Update",
  field: string,
): boolean {
  const all = [...files.values()].join("\n");
  const pascal = field.charAt(0).toUpperCase() + field.slice(1);
  switch (backend) {
    case "node": {
      // `\n})` closes the object; a bare `})` would stop at the first
      // `.openapi({ … })` an `int` field carries and silently drop every field
      // after it — reading as "this backend requires nothing".
      const block = sliceBlock(all, `const ${op}ItemRequest = z.object({`, "\n})");
      const decl = new RegExp(`^\\s*${field}:([^\\n]*)`, "m").exec(block);
      if (decl === null) return false;
      // Requiredness in zod is "does the schema REJECT `undefined`" — which is
      // also exactly what zod-to-openapi asks (`schema.isOptional()`) when it
      // builds the served spec's `required[]`.  So the absence of `.default(`
      // is NOT enough: `z.coerce.boolean()` is `Boolean(input)`, and
      // `Boolean(undefined) === false`, so a COERCED bool accepts an omitted
      // key and yields `false` — the same silent wire default, spelled without
      // the word `default`.
      return !/\.default\(|\.optional\(|\.nullish\(|z\.coerce\.boolean/.test(decl[1]);
    }
    case "python": {
      const block = sliceBlock(all, `class ${op}ItemRequest(BaseModel):`, "\n\n");
      return new RegExp(`^\\s*${field}:\\s*[^=\\n]+$`, "m").test(block);
    }
    case "dotnet": {
      // `[property: JsonRequired]`, not `[Required]`: RequiredAttribute tests
      // for null, and an omitted value type binds to 0/false — non-null, so it
      // passes.  Presence is a DESERIALIZATION question, which is the one
      // JsonRequired asks.
      const block = sliceBlock(all, `public sealed record ${op}ItemRequest(`, ");");
      return new RegExp(`\\[property: JsonRequired\\][^,]*\\b${pascal}\\b`).test(block);
    }
    case "java": {
      return (javaRequiredSets(files).get(`${op}ItemRequest`) ?? []).includes(field);
    }
    case "vanilla": {
      // TWO artifacts, and BOTH must agree — the document and the enforcement
      // live in different files on this backend.  A gate that reads only the
      // OpenApiSpex schema certifies the promise, not the behaviour.
      const schema = fileNamed(files, new RegExp(`${op.toLowerCase()}_item_request\\.ex$`));
      const inSchema = new RegExp(`required: \\[[^\\]]*:${field}\\b`).test(schema);
      const controller = fileNamed(files, /item_controller\.ex$/);
      const plug = new RegExp(
        `@required_params %\\{[^}]*${op.toLowerCase()}: ~w\\([^)]*\\b${field}\\b`,
      );
      // The generic update's presence check lives in its changeset instead
      // (`__require_keys/3`, ahead of `cast`), because `validate_required/2`
      // reads through to the loaded row.
      const changeset = fileNamed(files, /item_changeset\.ex$/);
      const enforced =
        op === "Update"
          ? /\|> __require_keys\(attrs, @update_required\)/.test(changeset) || plug.test(controller)
          : plug.test(controller);
      return inSchema && enforced;
    }
  }
}

/** Does `<Op>ItemRequest` give `field` a WIRE default — a value the server
 *  substitutes for an omitted key? */
function requestDefaultsField(
  files: Map<string, string>,
  backend: Backend,
  op: "Update",
  field: string,
): boolean {
  const all = [...files.values()].join("\n");
  const pascal = field.charAt(0).toUpperCase() + field.slice(1);
  switch (backend) {
    case "node": {
      const block = sliceBlock(all, `const ${op}ItemRequest = z.object({`, "\n})");
      const decl = new RegExp(`^\\s*${field}:([^\\n]*)`, "m").exec(block);
      return decl !== null && /\.default\(|z\.coerce\.boolean/.test(decl[1]);
    }
    case "python": {
      const block = sliceBlock(all, `class ${op}ItemRequest(BaseModel):`, "\n\n");
      return new RegExp(`^\\s*${field}:[^\\n]*=\\s*(True|False)\\b`, "m").test(block);
    }
    case "dotnet": {
      const block = sliceBlock(all, `class ${op}ItemRequest`, "\n}");
      return new RegExp(`\\b${pascal}\\b[^\\n]*=\\s*(true|false)\\b`).test(block);
    }
    case "java":
    case "vanilla":
      // Neither has a request-side default slot: java's components are boxed
      // (null when absent), and Ecto's `cast/3` ignores an absent key.
      return false;
  }
}

/** The one emitted file whose path matches — "" when absent, so a missing file
 *  fails the assertion rather than passing it vacuously. */
function fileNamed(files: Map<string, string>, pattern: RegExp): string {
  for (const [path, content] of files) if (pattern.test(path)) return content;
  return "";
}

function sliceBlock(source: string, from: string, to: string): string {
  const at = source.indexOf(from);
  if (at < 0) return "";
  const end = source.indexOf(to, at + from.length);
  return source.slice(at, end < 0 ? undefined : end + to.length);
}

// `active`/`archived` carry an explicit `= default`, so a wire default on the
// command side can only come from the implicit-bool rule.  `flag` is BARE — it
// has nothing but the implicit rule — and it is the discriminating case: a
// backend that applies `hasImplicitDefault` (a CREATE-input predicate) to an
// operation body still requires the two explicitly-defaulted bools on some
// paths, and drops `flag` on all of them.
const BOOLS = ["active", "archived", "flag"];

describe("an omitted COMMAND bool is rejected, not silently defaulted (RS-26)", () => {
  for (const backend of BACKENDS) {
    const waiver = COMMAND_BOOL_WAIVED[backend];
    it(`${BACKEND_LABEL[backend]}${waiver ? " (waived)" : ""}`, async () => {
      const files = await generateCorpusCase(FEATURE, backend);
      const required = BOOLS.filter((f) => requestRequiresField(files, backend, "Configure", f));

      if (waiver) {
        // Ratchet: the waiver must still be EARNED.
        expect(
          required,
          `${BACKEND_LABEL[backend]} now requires ${required.join(", ")} on configure — ` +
            `drop its COMMAND_BOOL_WAIVED entry (${waiver})`,
        ).toHaveLength(0);
        return;
      }

      expect(
        required,
        `${BACKEND_LABEL[backend]} does not require ${BOOLS.filter((f) => !required.includes(f)).join(", ")} ` +
          `on a command — a body omitting the field is ACCEPTED here and rejected 422 elsewhere.`,
      ).toEqual(BOOLS);
    });
  }
});

describe("an omitted UPDATE bool keeps its stored value — required by nothing, defaulted by nothing (RS-47)", () => {
  for (const backend of BACKENDS) {
    it(BACKEND_LABEL[backend], async () => {
      const files = await generateCorpusCase(FEATURE, backend);
      // Non-vacuity: the update request this reads must exist.
      expect([...files.values()].some((c) => c.includes("UpdateItemRequest"))).toBe(true);
      expect(
        BOOLS.filter((f) => requestRequiresField(files, backend, "Update", f)),
        `${BACKEND_LABEL[backend]} still requires these on the merge-patch update`,
      ).toEqual([]);
      expect(
        BOOLS.filter((f) => requestDefaultsField(files, backend, "Update", f)),
        `${BACKEND_LABEL[backend]} gives these a wire default on update — an omitted key would overwrite the stored value`,
      ).toEqual([]);
    });
  }
});
