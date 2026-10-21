// Feliz — `toast(<msg>)` as an action-body STATEMENT.
//
// `toast(…)` is the documented page effect (docs/page-metamodel.md §15).  In a
// named `action` body it lowers as a `private-operation` call (it resolves to
// no declaration, exactly like `navigate`), and the Feliz `update` renderer had
// no arm for it: `ddd generate system` threw for the whole system on a model
// that validated with 0 errors.  It now shows the same built-in DOM toast an
// `Action { …, then: toast(…) }` closure runs, declared ONCE ahead of `update`
// (F# is order-sensitive, and a module may not bind the name twice).
//
// The emitted App.fs for the combined model below (both callers) builds under
// `dotnet fable` + `vite build`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const model = (pages: string) => `
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
${pages}
  }
  deployable web { platform: feliz  targets: api  ui: Web { N: api }  port: 3001 }
}
`;

const HOME = `
    page Home {
      route: "/"
      state { n: int = 0 }
      action save() { toast("Saved") }
      action bump() { n := n + 1  toast(string(n)) }
      body: Stack { Button { "Save", onClick: save }, Button { "Bump", onClick: bump } }
    }`;

const NOTE_VIEW = `
    page NoteView(id: Note id) {
      route: "/notes/:id"
      body: QueryView { of: N.Note.byId(id), data: n => Stack {
        Heading { n.title },
        Action { n.archive, then: toast("Archived") }
      } }
    }`;

async function appFs(pages: string): Promise<string> {
  const files = await generateSystemFiles(model(pages));
  const app = files.get("web/src/App.fs");
  expect(app, "no web/src/App.fs emitted").toBeDefined();
  return app!;
}

const DECL = "let actionToast (message: string) : unit =";

describe("feliz — toast(<msg>) in an action body", () => {
  it("renders the built-in toast in the update arm, declared before `update`", async () => {
    const fs = await appFs(HOME);
    expect(fs).toContain(
      '  | Save ->\n      actionToast (string ("Saved"))\n      model, Cmd.none',
    );
    // Reads the state AFTER the preceding write, like every other arm statement.
    expect(fs).toContain("      actionToast (string ((string model.N)))");
    expect(fs.split(DECL)).toHaveLength(2);
    expect(fs.indexOf(DECL)).toBeLessThan(fs.indexOf("let update (msg: Msg)"));
  });

  it("an update-arm toast and a view `then: toast` share ONE declaration", async () => {
    const fs = await appFs(`${HOME}\n${NOTE_VIEW}`);
    expect(fs).toContain('(fun () -> actionToast (string ("Archived")))');
    expect(fs.split(DECL)).toHaveLength(2);
    expect(fs.indexOf(DECL)).toBeLessThan(fs.indexOf("let update (msg: Msg)"));
  });

  it("a view-only `then: toast` keeps its declaration after `update`", async () => {
    const fs = await appFs(NOTE_VIEW);
    expect(fs.split(DECL)).toHaveLength(2);
    expect(fs.indexOf(DECL)).toBeGreaterThan(fs.indexOf("let update (msg: Msg)"));
  });
});
