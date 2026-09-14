// F-010 — an OMITTED optional field on a contained entity part.
//
// `entity NoteLine { text: string  tag: Tag id? }` plus an operation body that
// spells only the required half:
//
//     lines += NoteLine { text: text }
//
// is legal `.ddd` — the DSL lets an optional be omitted, `ddd parse` is clean,
// and the four other backends were already fine with it (dotnet `init` +
// `= default!`, java's `renderNew` fills an omitted field with `null`, elixir
// builds a struct literal).  The two backends that emit a KEYWORD/STATE-shaped
// factory were not:
//
//   * node   — `NoteLine._create({ id, parentId, text })` against a state type
//              `{ …; tag: TagId | null }` → TS2345 "Property 'tag' is missing
//              in type … but required", i.e. the emitted project does not
//              compile at all.
//   * python — `_create(cls, *, …, tag: TagId | None)`, keyword-only with no
//              default → `TypeError: _create() missing 1 required keyword-only
//              argument: 'tag'` the first time the operation runs.
//
// Both are fixed where the emitters ALREADY relax the `_create` contract for an
// omitted CONTAINMENT (`lines?: NoteLine[]` / `lines: … | None = None`): the
// op-body factory accepts the omission and writes what an omitted optional
// means, `null` / `None`.  `_rehydrate` deliberately keeps the full required
// contract — the store has a value for every column.
//
// The full proof is a real `tsc --noEmit` on the emitted api and a real
// `python3` call of the emitted operation; these assertions are what fail in
// seconds when a refactor drops the relaxation.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: "node" | "python") => `
  system OptGap {
    subdomain S {
      context C {
        aggregate Tag { label: string  derived display: string = label }
        repository Tags for Tag { }
        aggregate Note {
          title: string
          derived display: string = title
          contains lines: NoteLine[]
          operation addLine(text: string) {
            lines += NoteLine { text: text }
          }
          entity NoteLine {
            text: string
            tag: Tag id?
          }
        }
        repository Notes for Note { }
      }
    }
    storage primary { type: postgres }
    resource st { for: C, kind: state, use: primary }
    deployable api { platform: ${platform} contexts: [C] dataSources: [st] port: 3000 }
  }
`;

describe("F-010 — an omitted optional field on a contained part", () => {
  it("node: `_create` accepts the omission and writes null", async () => {
    const files = await generateSystemFiles(SOURCE("node"));
    const domain = files.get("api/domain/note.ts")!;

    // The construction site spells only `text` — that is the DSL's own reading
    // of an omitted optional, and it must stay that way.
    expect(domain).toContain(
      "NoteLine._create({ id: Ids.newNoteLineId(), parentId: this._id, text: text })",
    );
    // …so the factory's state slot for `tag` must be OPTIONAL.  The required
    // spelling (`tag: Ids.TagId | null` in the `_create` signature) is the
    // TS2345.
    expect(domain).toMatch(
      /static _create\(state: \{[^}]*\btag\?: Ids\.TagId \| null\b[^}]*\}\)/,
    );
    // …and the omission is materialised as `null`, not left `undefined`.
    expect(domain).toContain("new NoteLine({ ...state, tag: state.tag ?? null })");

    // `_rehydrate` keeps the FULL contract — the store always has the column,
    // and relaxing it there would hide a hydration bug.
    expect(domain).toMatch(
      /static _rehydrate\(state: \{[^}]*\btag: Ids\.TagId \| null\b[^}]*\}\)/,
    );
  });

  it("node: a REQUIRED field stays required in `_create`", async () => {
    const files = await generateSystemFiles(SOURCE("node"));
    const domain = files.get("api/domain/note.ts")!;
    // The relaxation is `T?`-only: `text: string` must NOT pick up a `?`.
    expect(domain).toMatch(/static _create\(state: \{[^}]*\btext: string\b[^}]*\}\)/);
    expect(domain).not.toMatch(/static _create\(state: \{[^}]*\btext\?: string\b/);
  });

  it("python: the keyword-only optional param carries a `= None` default", async () => {
    const files = await generateSystemFiles(SOURCE("python"));
    const domain = files.get("api/app/domain/note.py")!;

    expect(domain).toContain(
      "NoteLine._create(id=new_note_line_id(), parent_id=self._id, text=text)",
    );
    // No default here is the `TypeError` at the first call.
    expect(domain).toContain(
      "def _create(cls, *, id: NoteLineId, parent_id: NoteId, text: str, tag: TagId | None = None)",
    );
    // `_rehydrate` keeps the full required contract.
    expect(domain).toContain(
      "def _rehydrate(cls, *, id: NoteLineId, parent_id: NoteId, text: str, tag: TagId | None)",
    );
  });

  it("python: a REQUIRED field gets no default", async () => {
    const files = await generateSystemFiles(SOURCE("python"));
    const domain = files.get("api/app/domain/note.py")!;
    expect(domain).not.toContain("text: str = None");
  });
});
