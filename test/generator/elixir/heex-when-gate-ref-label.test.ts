// Phoenix LiveView — two newcomer-trial UI bugs on the scaffolded pages
// (fleet slice C; the JSX/Feliz/Flutter halves are separate slices).
//
//   1. `when` gate.  `operation complete() when !done` rendered an
//      always-enabled trigger, and the modal submit called `update_<agg>` — the
//      op body never ran, and the handler's `%{"complete" => params}` head never
//      matched the schema-named form (`"task"`), so a click crashed the
//      LiveView.  Now: `@can_complete` is assigned from the façade's
//      `can_complete_task(record)` probe on load and after every submit, the
//      trigger renders `disabled` with a reason, and submit runs the op.
//   2. Reference label.  `project: Project id` rendered the raw id.  Now the
//      façade's `project_labels(ids)` loads every label a page needs in ONE
//      query, and `IdLink` reads `@project_labels`, falling back to the id.

import { describe, expect, it } from "vitest";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../../_helpers/index.js";

const model = (opts: { design: string; display?: boolean }) => `
system Library {
  subdomain Core {
    context Projects {
      aggregate Project with crudish {
        name: string
        ${opts.display === false ? "" : "derived display: string = name"}
      }
      repository Projects for Project { }

      aggregate Task with crudish {
        title: string
        done: bool
        project: Project id
        operation complete() when !done { done := true }
        operation reopen() { done := false }
      }
      repository Tasks for Task { }
    }
  }
  ui WebApp with scaffold(subdomains: [Core]) { }
  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }
  deployable app {
    platform: elixir, contexts: [Projects], dataSources: [appState],
    ui: WebApp, port: 4000, design: ${opts.design}
  }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(
    `no ${suffix} in ${[...files.keys()].filter((p) => p.includes("live")).join(", ")}`,
  );
}

describe.each([
  "coreComponents",
  "daisyui",
])("HEEx `when` gate + reference label (%s)", (design) => {
  const files = () => generateSystemFiles(model({ design }));

  describe("`when`-gated operation", () => {
    it("assigns @can_<op> from the façade probe on load, defaulting to enabled in mount", async () => {
      const live = file(await files(), "/live/task_detail_live.ex");
      expect(live).toContain("|> assign(:can_complete, true)");
      const load = live.slice(live.indexOf("def handle_params"), live.indexOf("def handle_event"));
      expect(load).toContain("|> assign(:can_complete, App.Projects.can_complete_task(record))");
    });

    it("renders the trigger and the modal submit disabled while the gate refuses", async () => {
      const live = file(await files(), "/live/task_detail_live.ex");
      expect(live).toMatch(
        /<\.button phx-click=\{show_modal\("task-op-complete-modal"\)\} disabled=\{!@can_complete\} title=\{unless @can_complete, do: "Complete is not available in the current state"\}>/,
      );
      expect(live).toContain('<.button type="submit" disabled={!@can_complete}>');
    });

    it("submit runs the operation itself and re-probes every gate after any submit", async () => {
      const live = file(await files(), "/live/task_detail_live.ex");
      const submit = live.slice(live.indexOf('def handle_event("submit_complete"'));
      expect(submit).toContain("case App.Projects.complete_task(socket.assigns.data, params) do");
      expect(submit).toContain(
        '{:error, reason} ->\n        {:noreply, put_flash(socket, :error, "Complete failed:',
      );
      // The CRUD update can flip `done` too, so its success re-probes the gate.
      const update = live.slice(live.indexOf('def handle_event("submit_update"'));
      expect(update.slice(0, update.indexOf("\n  end\n"))).toContain(
        "|> assign(:can_complete, App.Projects.can_complete_task(record))",
      );
    });

    it("names each op form so its submit reaches the clause (schema-named forms never matched)", async () => {
      const live = file(await files(), "/live/task_detail_live.ex");
      expect(live).toContain('change_task(record) |> to_form(as: "complete")');
      expect(live).toContain('def handle_event("submit_complete", params, socket) do');
      expect(live).toContain('params = Map.get(params, "complete", %{})');
      expect(live).not.toContain('%{"complete" => params}');
    });

    it("an un-gated operation renders no disabled state and assigns no probe", async () => {
      const live = file(await files(), "/live/task_detail_live.ex");
      expect(live).toMatch(/<\.button phx-click=\{show_modal\("task-op-reopen-modal"\)\}>/);
      expect(live).not.toContain("can_reopen");
      // …but it still submits through its own op, not the field update.
      expect(live).toContain("case App.Projects.reopen_task(socket.assigns.data, params) do");
    });
  });

  describe("reference label", () => {
    it("the façade loads labels for many ids in one query, rendered from `display`", async () => {
      const ctx = file(await files(), "/lib/app/projects.ex");
      expect(ctx).toContain("def project_label(%App.Projects.Project{} = record), do: record.name");
      expect(ctx).toContain("def project_labels(ids) when is_list(ids) do");
      expect(ctx).toContain("from(record in App.Projects.Project, where: record.id in ^ids)");
    });

    it("list and detail render the label with the id as fallback", async () => {
      const fs = await files();
      const list = file(fs, "/live/task_list_live.ex");
      const detail = file(fs, "/live/task_detail_live.ex");
      expect(list).toContain(
        '<.link navigate={~p"/projects/#{o.project}"}><%= Map.get(@project_labels, o.project) || o.project %></.link>',
      );
      expect(detail).toContain("<%= Map.get(@project_labels, @data.project) || @data.project %>");
      // The Project list's own ID column still shows the id.
      const projects = file(fs, "/live/project_list_live.ex");
      expect(projects).toContain('<.link navigate={~p"/projects/#{o.id}"}><%= o.id %></.link>');
      expect(projects).not.toContain("_labels");
    });

    it("one batched load per page, refreshed after every read — never inside the row render", async () => {
      const list = file(await files(), "/live/task_list_live.ex");
      expect(list).toContain("|> assign(:project_labels, %{})");
      expect(list).toContain(
        "|> assign(:project_labels, App.Projects.project_labels(Enum.map(__loom_label_rows(socket.assigns[:items]), & &1.project)))",
      );
      // handle_params + loom-sort + loom-page each re-load once.
      expect(list.match(/socket = __loom_ref_labels\(socket\)/g)).toHaveLength(3);
      const render = list.slice(list.indexOf("def render(assigns)"));
      expect(render).not.toContain("project_labels(");
    });

    it("the id picker labels its options with `display`", async () => {
      const newLive = file(await files(), "/live/task_new_live.ex");
      expect(newLive).toContain("Enum.map(fn r -> {App.Projects.project_label(r), r.id} end)");
    });

    it("a target with no `display` keeps the raw id and emits no label seam", async () => {
      const fs = await generateSystemFilesUnchecked(
        model({ design, display: false }),
        "an id-ref to an aggregate with no `display` is what loom.ui-id-ref-no-display " +
          "rejects — the raw-id FALLBACK is the subject",
      );
      const list = file(fs, "/live/task_list_live.ex");
      expect(list).toContain(
        '<.link navigate={~p"/projects/#{o.project}"}><%= o.project %></.link>',
      );
      expect(list).not.toContain("__loom_ref_labels");
      expect(file(fs, "/lib/app/projects.ex")).not.toContain("project_label");
      expect(file(fs, "/live/task_new_live.ex")).toContain("fn r -> {to_string(r.id), r.id} end");
    });
  });
});
