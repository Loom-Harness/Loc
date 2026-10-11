// M-FT.5 — `Action { <instance>.<op>, then: <effect> }` on the two self-hosted
// frontends (Feliz, Flutter).
//
// The four JSX frontends chain the effect after the mutation
// (`archiveNote.mutateAsync({}).then(() => { toast("Archived"); })`).  Feliz
// never read `then:` at all, and Flutter replaced it with a hard-coded
// `SnackBar('Archive done')` — valid `.ddd`, `0 error(s)`, and the author's
// effect silently gone.
//
// A second Feliz defect sat under the first: the Action COLLECTOR keyed on the
// literal `single: true` flag while the RENDERER derived single-ness from the
// read (`queryShape`), so an unflagged `QueryView { of: N.Note.byId(id) }`
// rendered `dispatch (ArchiveNote id)` against a `Msg` that declared no
// `ArchiveNote` case (F# FS0039).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const model = (platform: "feliz" | "flutter", action: string, single = "") => `
system S {
  subdomain Notes {
    context NotesCtx {
      aggregate Note with crudish {
        title: string
        archived: bool
        operation archive() { archived := true }
      }
      repository Notes for Note { }
    }
  }
  api NotesApi from Notes
  storage db { type: postgres }
  resource notesState { for: NotesCtx, kind: state, use: db }
  deployable api { platform: node  contexts: [NotesCtx]  dataSources: [notesState]  serves: NotesApi  port: 3000 }
  ui Web {
    api N: NotesApi
    page NoteView(id: Note id) {
      route: "/notes/:id"
      body: QueryView { of: N.Note.byId(id),${single} data: n => Stack {
        Heading { n.title },
        ${action}
      } }
    }
  }
  deployable web { platform: ${platform}  targets: api  ui: Web { N: api }  port: 3001 }
}
`;

async function file(src: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix}`).toBeDefined();
  return hit![1];
}

describe("M-FT.5 — Feliz Action", () => {
  it("an UNFLAGGED byId QueryView still declares the Msg case its view dispatches", async () => {
    const app = await file(model("feliz", "Action { n.archive }"), "src/App.fs");
    expect(app).toContain("dispatch (ArchiveNote id)");
    // The collector now derives single-ness the way the renderer does.
    expect(app).toContain("  | ArchiveNote of string");
    expect(app).toContain("  | ArchiveNoteDone of Result<unit, string>");
    expect(app).toContain("let archiveNote (id: string)");
  }, 90_000);

  it("`then: toast(...)` runs the author's toast after the POST succeeds", async () => {
    const app = await file(
      model("feliz", 'Action { n.archive, then: toast("Archived") }'),
      "src/App.fs",
    );
    // The view hands the effect to the trigger as a closure…
    expect(app).toContain(
      'dispatch (ArchiveNoteThen (id, (fun () -> actionToast (string ("Archived")))))',
    );
    // …the Msg pair carries it…
    expect(app).toContain("  | ArchiveNoteThen of string * (unit -> unit)");
    expect(app).toContain("  | ArchiveNoteThenDone of Result<unit, string> * (unit -> unit)");
    // …and `update` runs it on success only, after queuing the refetch.
    expect(app).toContain(
      "  | ArchiveNoteThen (id, andThen) -> model, Cmd.OfAsync.perform Api.archiveNote id (fun r -> ArchiveNoteThenDone (r, andThen))",
    );
    expect(app).toContain(
      "  | ArchiveNoteThenDone (Ok (), andThen) -> model, Cmd.batch [ pageCmd model.CurrentPage; Cmd.ofEffect (fun _ -> andThen ()) ]",
    );
    expect(app).toContain("  | ArchiveNoteThenDone (Error _, _) -> model, Cmd.none");
    // The toast the closure calls is declared BEFORE the views (F# is ordered).
    const decl = app.indexOf("let actionToast (message: string) : unit");
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(app.indexOf("dispatch (ArchiveNoteThen"));
  }, 90_000);

  it("a then-less ui stays byte-identical (no Then pair, no toast decl)", async () => {
    const app = await file(model("feliz", "Action { n.archive }", " single: true,"), "src/App.fs");
    expect(app).not.toContain("ArchiveNoteThen");
    expect(app).not.toContain("actionToast");
  }, 90_000);
});

describe("M-FT.5 — Flutter Action", () => {
  it("`then: toast(...)` shows the author's message, not a hard-coded one", async () => {
    const page = await file(
      model("flutter", 'Action { n.archive, then: toast("Archived") }'),
      "lib/pages/note_view_page.dart",
    );
    expect(page).toContain(
      "context.mounted) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Archived'))); }",
    );
    expect(page).not.toContain("Archive done");
  }, 90_000);

  it("`then: navigate(...)` navigates instead of toasting", async () => {
    const page = await file(
      model("flutter", "Action { n.archive, then: navigate(NoteView) }"),
      "lib/pages/note_view_page.dart",
    );
    expect(page).toMatch(/context\.mounted\) \{ Navigator\.pushNamed\(context, /);
    expect(page).not.toContain("Archive done");
  }, 90_000);

  it("a then-less Action keeps its default confirmation", async () => {
    const page = await file(
      model("flutter", "Action { n.archive }"),
      "lib/pages/note_view_page.dart",
    );
    expect(page).toContain("Text('Archive done')");
  }, 90_000);
});
