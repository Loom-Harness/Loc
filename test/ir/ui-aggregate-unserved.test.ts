// ---------------------------------------------------------------------------
// `loom.ui-aggregate-unserved` — a ui page reading an aggregate its frontend's
// `targets:` backend does not serve (eval-closure item #18 / G8-02).
//
// Two node backends: `api` serves Notes, `tasksApi` serves Tasks.  The ui
// scaffolds BOTH subdomains, but the frontend `web` targets only `api`.  Before
// the gate this parsed with 0 errors and then:
//   - no api handle   → `generate` failed with 12× `loom.method-call-
//     unresolved-receiver` on `web/src/pages/tasks/*.tsx` (Task.all resolves
//     model-wide at F2, but the walker binds only the target's aggregates);
//   - one handle bound → the scaffold routed `Notes.Task.all` through it,
//     `generate` exited 0 and `pages/tasks/list.tsx` imported `../../api/task`,
//     a module never written (TS2307).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.ui-aggregate-unserved";

const system = (opts: {
  scaffold: string;
  uiMembers?: string;
  binding?: string;
  apiContexts?: string;
  apiServes?: string;
  apiDataSources?: string;
  platform?: string;
}) => `
system S {
  subdomain Notes {
    context NotesCtx {
      aggregate Note with crudish { title: string }
      repository Notes for Note { }
    }
  }
  subdomain Tasks {
    context TasksCtx {
      aggregate Task with crudish { name: string }
      repository Tasks for Task { }
    }
  }
  api NotesApi from Notes
  api TasksApi from Tasks
  storage db { type: postgres }
  resource notesState { for: NotesCtx, kind: state, use: db }
  resource tasksState { for: TasksCtx, kind: state, use: db }
  deployable api {
    platform: node
    contexts: ${opts.apiContexts ?? "[NotesCtx]"}
    dataSources: ${opts.apiDataSources ?? "[notesState]"}
    serves: ${opts.apiServes ?? "NotesApi"}
    port: 3000
  }
  deployable tasksApi {
    platform: node
    contexts: [TasksCtx]
    dataSources: [tasksState]
    serves: TasksApi
    port: 3002
  }
  ui Web ${opts.scaffold} {
    ${opts.uiMembers ?? ""}
  }
  deployable web {
    platform: ${opts.platform ?? "static"}
    targets: api
    ui: Web${opts.binding ?? ""}
    port: 3001
  }
}`;

async function diags(src: string) {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(`unexpected parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const hits = async (src: string) => (await diags(src)).filter((d) => d.code === CODE);

describe(CODE, () => {
  it("fires for a scaffolded subdomain the targets: backend does not serve (no api handle)", async () => {
    const found = await hits(system({ scaffold: "with scaffold(subdomains: [Notes, Tasks])" }));
    // Once per unserved context — not once per page.
    expect(found).toHaveLength(1);
    const [d] = found;
    expect(d.severity).toBe("error");
    expect(d.source).toBe("web/Web");
    // Names the ui, the subdomain, the context, the targets: deployable, the
    // pages, and the fixes.
    expect(d.message).toContain("ui 'Web'");
    expect(d.message).toContain("subdomain 'Tasks'");
    expect(d.message).toContain("context 'TasksCtx'");
    expect(d.message).toContain("frontend deployable 'web'");
    expect(d.message).toContain("against 'api' (its 'targets:')");
    expect(d.message).toContain("page List (/tasks)");
    expect(d.message).toContain("scaffold(subdomains: …)");
    expect(d.message).not.toContain("NoteCtx'");
  });

  it("fires when the scaffold routes the unserved aggregate through a bound handle", async () => {
    const found = await hits(
      system({
        scaffold: "with scaffold(subdomains: [Notes, Tasks])",
        uiMembers: "api Notes: NotesApi",
        binding: " { Notes: api }",
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("reads Task from subdomain 'Tasks'");
  });

  it("fires for a hand-written page reading an unserved aggregate", async () => {
    const found = await hits(
      system({
        scaffold: "",
        uiMembers: `page Board { route: "/board"
          body: Stack { CreateForm { of: Task } } }`,
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("page Board (/board)");
  });

  it("fires on every frontend platform, not just the static bundle host", async () => {
    for (const platform of ["react", "vue", "svelte", "angular", "feliz", "flutter"]) {
      const found = await hits(
        system({ scaffold: "with scaffold(subdomains: [Notes, Tasks])", platform }),
      );
      expect(
        found.map((d) => d.source),
        platform,
      ).toEqual(["web/Web"]);
    }
  });

  it("stays silent when the scaffold selects only served subdomains", async () => {
    expect(await hits(system({ scaffold: "with scaffold(subdomains: [Notes])" }))).toEqual([]);
  });

  it("stays silent when the targets: backend serves every scaffolded subdomain", async () => {
    expect(
      await hits(
        system({
          scaffold: "with scaffold(subdomains: [Notes, Tasks])",
          apiContexts: "[NotesCtx, TasksCtx]",
          apiServes: "NotesApi, TasksApi",
          apiDataSources: "[notesState, tasksState]",
        }),
      ),
    ).toEqual([]);
  });

  it("does not match a local binding that shadows an aggregate name", async () => {
    // `Task` here is a lambda parameter, so it lowers to `refKind: "lambda"`.
    expect(
      await hits(
        system({
          scaffold: "",
          uiMembers: `page Board { route: "/board"
            body: QueryView {
              of: Note.all,
              loading: Skeleton { count: 1 },
              error: Alert { "err" },
              empty: Empty { "none" },
              data: Task => Text { Task.length }
            } }`,
        }),
      ),
    ).toEqual([]);
  });
});
