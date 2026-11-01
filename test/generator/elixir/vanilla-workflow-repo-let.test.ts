import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Slice 5c body-lowering follow-up #4 — `repo-let` (load an existing
// aggregate by id).
//
//   let t = Tasks.getById(taskId)  →  {:ok, t} <- Context.get_task(task_id)
//
// The auto-generated `getById` finder maps to the vanilla context's
// `get_<agg>/1` (find_by_id) facade — `{:ok, _} | {:error, :not_found}`,
// so it slots straight into the `with`-chain and a failed load surfaces
// `{:error, :not_found}` (controller → 404).  The arg is param-surfaced
// like any other create-param reference.
//
// A criterion read (`if let i = Items.find(C(x))`) routes through the
// criterion retrieval's context defdelegate (`run_find_all_by_<c>_<agg>`,
// first row).
// ---------------------------------------------------------------------------

function sys(body: string): string {
  return `
system Tasks {
  subdomain Productivity {
    context Tracker {
      aggregate Task with crudish {
        title: string
        done: bool

        operation markDone() {
          done := true
        }
      }
      ${body}
    }
  }
  api TrackerApi from Productivity
  storage primary { type: postgres }
  resource trackerState { for: Tracker, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Tracker]
    dataSources: [trackerState]
    serves: TrackerApi
    port: 4000
  }
}
`;
}

async function workflowFor(body: string, file: string): Promise<string> {
  const files = await generateSystemFiles(sys(body));
  return files.get([...files.keys()].find((k) => k.endsWith(`/workflows/${file}.ex`))!)!;
}

const GET_BY_ID = `repository Tasks for Task { }

      workflow completeExisting transactional {
        create(taskId: Task id) {
          let t = Tasks.getById(taskId)
          t.markDone()
        }
      }`;

describe("vanilla — workflow body lowering (repo-let / getById)", () => {
  it("lowers `Tasks.getById(taskId)` to a Context.get_task with-clause", async () => {
    const wf = await workflowFor(GET_BY_ID, "complete_existing");
    // M-T5.1 A4 — the load tags its miss with the detail the other four
    // backends' AggregateNotFound carries, so the 404 names the row.
    expect(wf).toContain("{:ok, t} <- (case Context.get_task(task_id) do");
    expect(wf).toContain(
      '{:error, :not_found} -> {:error, {:not_found, "Task #{task_id} not found"}}',
    );
  });

  it("surfaces the id arg as a destructured create-param", async () => {
    const wf = await workflowFor(GET_BY_ID, "complete_existing");
    expect(wf).toContain(`%{"taskId" => task_id} = params`);
  });

  it("the loaded record flows into the subsequent op-call", async () => {
    const wf = await workflowFor(GET_BY_ID, "complete_existing");
    // get_task binds `t`; the op-call targets it.
    expect(wf).toMatch(
      /\{:ok, t\} <- \(case Context\.get_task\(task_id\) do[\s\S]*?end\),\s*\n\s*\{:ok, _\} <- Context\.mark_done_task\(t, %\{\}\)/,
    );
  });

  it("a failed load short-circuits the with-chain (→ {:error, :not_found})", async () => {
    // Structural: the clause pattern-matches {:ok, t}; find_by_id returns
    // {:error, :not_found} on a miss, which the with-chain propagates and
    // the WorkflowsController maps to 404.
    const wf = await workflowFor(GET_BY_ID, "complete_existing");
    const ctrlFiles = await generateSystemFiles(sys(GET_BY_ID));
    const ctrl = ctrlFiles.get(
      [...ctrlFiles.keys()].find((k) => k.endsWith("/controllers/workflows_controller.ex"))!,
    )!;
    expect(wf).toContain("{:ok, t} <- (case Context.get_task(task_id) do");
    expect(ctrl).toMatch(/def respond\(conn, \{:error, :not_found\}\)/);
    // …and the tagged miss has its own arm, answering the 404 with the detail.
    expect(ctrl).toMatch(/def respond\(conn, \{:error, \{:not_found, detail\}\}\)/);
  });
});

describe("vanilla — workflow body lowering (criterion read routes through context defdelegate)", () => {
  it("an `if let` criterion read lowers to the retrieval's context fn, and the op-call stays in the chain", async () => {
    // Self-contained source so the aggregate carries the field the
    // criterion's predicate references (the shared `sys()` helper above
    // hardcodes a `title`/`done` Task that doesn't expose the field shape we
    // need here).
    const files = await generateSystemFiles(`
      system Catalog {
        subdomain Inventory {
          context Items {
            aggregate Item with crudish {
              label: string

              operation markFound() {
                label := "found"
              }
            }
            repository Items for Item { }
            criterion ItemsByLabel(label: string) of Item = this.label == label

            workflow findThenMark transactional {
              create(wanted: string) {
                if let i = Items.find(ItemsByLabel(wanted)) {
                  i.markFound()
                } else {
                  notFound
                }
              }
            }
          }
        }
        api CatalogApi from Inventory
        storage primary { type: postgres }
        resource itemsState { for: Items, kind: state, use: primary }
        deployable api {
          platform: elixir
          contexts: [Items]
          dataSources: [itemsState]
          serves: CatalogApi
          port: 4000
        }
      }
    `);
    const wf = files.get(
      [...files.keys()].find((k) => k.endsWith("/workflows/find_then_mark.ex"))!,
    )!;
    expect(wf).toContain("i = case Context.run_find_all_by_items_by_label_item(wanted, limit: 1) do");
    expect(wf).toContain(`%{"wanted" => wanted} = params`);
    expect(wf).not.toContain("# TODO: lower workflow statement kind 'repo-let'");
    // The op-call on the narrowed binding `i` must route to the right
    // aggregate's context fn — not `mark_found_unknown` (the optional read
    // `Item?` must unwrap to `Item` for receiver resolution) — and its result
    // must gate the chain: a failed op is the workflow's failure.
    expect(wf).toContain("{:ok, _} <- Context.mark_found_item(i, %{})");
    expect(wf).not.toContain("_unknown(");
  });
});
