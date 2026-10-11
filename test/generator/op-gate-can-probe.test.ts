// A `when`-gated operation's trigger honours the backend's `can_<op>` probe on
// EVERY walker frontend.
//
// Every backend serves `GET /<plural>/{id}/can_<op>` → `{ allowed }` for an op
// with a `when <pred>` state gate (docs/criterion.md).  The generated UIs never
// asked it: the op button on a scaffolded Detail page was always enabled, and a
// click on an already-done record opened the dialog only to end in a 409 toast.
//
// The scaffolded Detail page is the repro (a `Modal { OperationForm }` per op),
// so the property is pinned there, on each frontend and on each React pack shape
// (mantine renders the trigger at the call site; shadcn/mui/chakra inside the
// op-modal component).  `rename` is the ungated control: it must cost no probe.
//
// ONE file across frontends on purpose — the property under test is that they
// agree, and a per-frontend copy is how they drift.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const MODEL = (platform: string, design: string | undefined): string => `
system Library {
  subdomain Core {
    context Projects {
      aggregate Task with crudish {
        title: string
        done: bool
        operation complete() when !done { done := true }
        operation rename(t: string) { title := t }
      }
      repository Tasks for Task { }
    }
  }
  api CoreApi from Core
  ui WebApp with scaffold(subdomains: [Core]) {
  }
  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }
  deployable api { platform: node, contexts: [Projects], dataSources: [appState], port: 3000 }
  deployable web { platform: ${platform}, targets: api, ui: WebApp, port: 3001${design ? `, design: ${design}` : ""} }
}
`;

interface Case {
  name: string;
  platform: string;
  design?: string;
  /** The api-client half — the probe's fetch of `can_complete`. */
  client: string;
  /** The trigger half — the disabled binding on the `complete` trigger. */
  disabled: string;
  /** How the frontend names an `rename` probe, were one (wrongly) emitted. */
  ungated: RegExp;
}

const CASES: Case[] = [
  {
    name: "react / mantine (call-site trigger)",
    platform: "react",
    design: "mantine",
    client: "/can_complete`",
    disabled: "disabled={ canComplete.data?.allowed === false }",
    ungated: /canRename|can_rename/,
  },
  ...["shadcn", "mui", "chakra"].map((design) => ({
    name: `react / ${design} (component-owned trigger)`,
    platform: "react",
    design,
    client: "/can_complete`",
    disabled: "disabled={ canComplete.data?.allowed === false } disabledReason=",
    ungated: /canRename|can_rename/,
  })),
  ...["shadcnVue", "vuetify"].map((design) => ({
    name: `vue / ${design}`,
    platform: "vue",
    design,
    client: "/can_complete`",
    disabled: ":disabled='canComplete.data?.allowed === false'",
    ungated: /canRename|can_rename/,
  })),
  ...["shadcnSvelte", "flowbite"].map((design) => ({
    name: `svelte / ${design}`,
    platform: "svelte",
    design,
    client: "/can_complete`",
    disabled: "disabled={ canComplete.data?.allowed === false }",
    ungated: /canRename|can_rename/,
  })),
  ...["angularMaterial", "primeng", "spartanNg"].map((design) => ({
    name: `angular / ${design}`,
    platform: "angular",
    design,
    client: "/can_complete`",
    disabled: "[disabled]='canCompleteTask.data()?.allowed === false'",
    ungated: /canRename|can_rename/i,
  })),
  {
    name: "feliz",
    platform: "feliz",
    client: '/can_complete" id',
    disabled: "prop.disabled (model.CanCompleteTask = Loaded false)",
    ungated: /CanRename|can_rename/,
  },
  {
    name: "flutter",
    platform: "flutter",
    client: "/can_complete'",
    disabled: "ref.watch(canCompleteTaskProvider(id)).valueOrNull == false",
    ungated: /canRename|can_rename/,
  },
];

/** Every source file of the `web` frontend, concatenated (the probe's client
 *  half and its trigger half land in different files on every frontend).  The
 *  page objects are excluded: they name the op testids, not the probe. */
async function webSources(c: Case): Promise<string> {
  const files = await generateSystemFiles(MODEL(c.platform, c.design));
  const src = [...files.entries()]
    .filter(([p]) => p.startsWith("web/") && !p.includes("/e2e/"))
    .filter(([p]) => /\.(tsx?|vue|svelte|fs|dart)$/.test(p))
    .map(([, s]) => s)
    .join("\n");
  if (!src) throw new Error(`no web sources generated for ${c.name}`);
  return src;
}

describe("a `when`-gated op trigger queries GET /{id}/can_<op> and disables on allowed=false", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const src = await webSources(c);
      expect(src).toContain(c.client);
      expect(src).toContain(c.disabled);
      // The ungated `rename` costs no extra request on any frontend.
      expect(src).not.toMatch(c.ungated);
    });
  }
});

// The one-click `Action { <record>.<op> }` button is an op trigger too: it
// hoists the probe beside its mutation hook and binds the button's `disabled`.
const ACTION_MODEL = (platform: string): string => `
system Library {
  subdomain Core {
    context Projects {
      aggregate Task with crudish {
        title: string
        done: bool
        operation complete() when !done { done := true }
        operation archive() { done := true }
      }
      repository Tasks for Task { }
    }
  }
  api CoreApi from Core
  ui WebApp {
    api Core: CoreApi
    page TaskView {
      route: "/tasks/:id"
      body: QueryView { of: Core.Task.byId(id), single: true,
        loading: Text { "…" }, error: Text { "err" }, empty: Text { "none" },
        data: task => Stack { Text { task.title }, Action { task.complete }, Action { task.archive } } }
    }
  }
  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }
  deployable api { platform: node, contexts: [Projects], dataSources: [appState], serves: CoreApi, port: 3000 }
  deployable web { platform: ${platform}, targets: api, ui: WebApp { Core: api }, port: 3001 }
}
`;

const ACTION_CASES: { platform: string; disabled: string; ungated: RegExp }[] = [
  {
    platform: "react",
    disabled: "disabled={canCompleteTask.data?.allowed === false}",
    ungated: /canArchive|can_archive/,
  },
  {
    platform: "vue",
    disabled: ":disabled='canCompleteTask.data?.allowed === false'",
    ungated: /canArchive|can_archive/,
  },
  {
    platform: "svelte",
    disabled: "disabled={canCompleteTask.data?.allowed === false}",
    ungated: /canArchive|can_archive/,
  },
  {
    platform: "angular",
    disabled: "[disabled]='completeTask.isPending() || canCompleteTask.data()?.allowed === false'",
    ungated: /canArchive|can_archive/i,
  },
  {
    platform: "feliz",
    disabled: "prop.disabled (model.CanCompleteTask = Loaded false)",
    ungated: /CanArchive|can_archive/,
  },
  {
    platform: "flutter",
    disabled: "onPressed: opBlocked ? null : () async { final res = await http.post(",
    ungated: /canArchive|can_archive/,
  },
];

describe("a `when`-gated `Action` button disables on its can_<op> probe", () => {
  for (const c of ACTION_CASES) {
    it(c.platform, async () => {
      const files = await generateSystemFiles(ACTION_MODEL(c.platform));
      const src = [...files.entries()]
        .filter(([p]) => p.startsWith("web/") && !p.includes("/e2e/"))
        .filter(([p]) => /\.(tsx?|vue|svelte|fs|dart)$/.test(p))
        .map(([, s]) => s)
        .join("\n");
      expect(src).toContain("can_complete");
      expect(src).toContain(c.disabled);
      expect(src).not.toMatch(c.ungated);
    });
  }
});

// Vue's `setup` runs once, so an `Action` hoisted over an async QueryView
// record must hand its hooks a GETTER — a plain `rec.data?.id ?? ""` is read
// before the record loads and freezes at `""` (the mutation then POSTs to
// `/tasks//complete`, and the probe never fires).  The hooks take a
// `MaybeRefOrGetter` and read it through `toValue` when they run.
describe("vue: an `Action` over an async record binds its hooks to a getter id", () => {
  it("hoists the op + probe hooks with a getter, read by toValue at run time", async () => {
    const files = await generateSystemFiles(ACTION_MODEL("vue"));
    const page = [...files.entries()].find(([p]) => p.endsWith("pages/task_view.vue"))?.[1];
    const api = [...files.entries()].find(([p]) => p.endsWith("src/api/task.ts"))?.[1];
    expect(page).toContain('reactive(useCompleteTask(() => taskById.data?.id ?? ""))');
    expect(page).toContain('reactive(useCanCompleteTask(() => taskById.data?.id ?? ""))');
    expect(api).toContain("export function useCompleteTask(id: MaybeRefOrGetter<string>)");
    expect(api).toContain("api.post(`/tasks/${seg(toValue(id))}/complete`");
    expect(api).toContain('queryKey: computed(() => ["tasks", toValue(id), "can", "complete"])');
  });
});
