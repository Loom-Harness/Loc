// `toast(<msg>)` must resolve on every frontend that renders the call.
//
// The effect is an ordinary page-language call (docs/page-metamodel.md §15),
// legal in a named `action` body, and EVERY walker target renders it verbatim
// as `toast(<args>);` — exactly like `navigate(…)`.  So a target that renders
// the call without also wiring a binding for it emits a project that names a
// symbol it never declares.  React and Svelte were wired; Vue, Angular and
// Phoenix/LiveView rendered the call and nothing else, each failing in its own
// way (TS2304 under `vue-tsc`, TS2304 under `ng build`, and an Elixir
// CompileError for an undefined `toast/1`).
//
// The binding differs per target ON PURPOSE, because the right one already
// exists in three different shapes:
//
//   react / svelte / angular — the shared, DI-free, self-mounting module
//                              (`DOM_TOAST_SOURCE`).
//   vue                      — `pushToast`, from the reactive queue the Vue
//                              app-shell ALREADY hosts for realtime and
//                              form-success toasts.  Aliasing it beats standing
//                              a second mechanism up beside the pack's own.
//   elixir / HEEx            — `put_flash(socket, :info, …)`, the Phoenix idiom,
//                              through `then/2` because it RETURNS the new
//                              socket (`tap/2` would throw the result away).
//
// So the gate asserts the INVARIANT — the call resolves — not one spelling.
//
// Flutter is deliberately absent: it refuses the construct at validation with
// `loom.flutter-action-body-unsupported`, which is the honest answer and needs
// no wiring.  Feliz renders no page `action` body of this shape today.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const jsSrc = (frontend: string) => `
system ToastWiring {
  subdomain S { context C { aggregate T with crudish { label: string } repository Ts for T { } } }
  api CApi from S
  ui W {
    api C: CApi
    page P {
      route: "/"
      action save() { toast("Saved") }
      body: Stack { Button { "Save", onClick: save } }
    }
  }
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [cs], serves: CApi, port: 3000 }
  deployable w { platform: ${frontend}, targets: api, ui: W { C: api }, port: 3001 }
}
`;

const heexSrc = `
system ToastWiringHeex {
  subdomain S { context C { aggregate T with crudish { label: string } repository Ts for T { } } }
  api CApi from S
  ui W {
    api C: CApi
    page P {
      route: "/"
      action save() { toast("Saved") }
      body: Stack { Button { "Save", onClick: save } }
    }
  }
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [C]
    dataSources: [cs]
    serves: CApi
    ui: W { C: api }
    port: 4000
  }
}
`;

/** The emitted file that CALLS `toast(` — the page/component, never the module
 *  that defines it and never the realtime handler. */
function callerOf(files: Map<string, string>, re: RegExp): [string, string] {
  const hit = [...files].find(
    ([p, s]) => re.test(p) && /(?<![.\w])toast\s*\(/.test(s) && !/lib\/toast|toast\.svelte/.test(p),
  );
  if (!hit) throw new Error(`no emitted file matching ${re} calls toast(`);
  return hit;
}

/** The same page, but under an `area` so it emits into a SUBDIRECTORY.  The
 *  Vue/Angular import keys are folded by exact string and depth-adjusted
 *  afterwards, so a nested page is where a prefix written at the wrong moment
 *  stops matching — which the first draft of the Vue fix did. */
const nestedSrc = (frontend: string) => `
system ToastNested {
  subdomain S { context C { aggregate T with crudish { label: string } repository Ts for T { } } }
  api CApi from S
  ui W {
    api C: CApi
    area Ops {
      page Deep {
        route: "/ops/deep"
        action save() { toast("Saved") }
        body: Stack { Button { "Save", onClick: save } }
      }
    }
  }
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [cs], serves: CApi, port: 3000 }
  deployable w { platform: ${frontend}, targets: api, ui: W { C: api }, port: 3001 }
}
`;

describe("the toast(<msg>) page effect resolves on every frontend that renders it", () => {
  it("react — imports the shared self-mounting module", async () => {
    const [, src] = callerOf(await generateSystemFiles(jsSrc("react")), /\.tsx$/);
    expect(src).toMatch(/import \{[^}]*\btoast\b[^}]*\} from "[^"]*lib\/toast"/);
  });

  it("svelte — imports the shared module from $lib", async () => {
    const [, src] = callerOf(await generateSystemFiles(jsSrc("svelte")), /\+page\.svelte$/);
    expect(src).toMatch(/import \{[^}]*\btoast\b[^}]*\} from "\$lib\/toast-effect"/);
  });

  it("vue — aliases the queue the app-shell already hosts, and that module is emitted", async () => {
    const files = await generateSystemFiles(jsSrc("vue"));
    const [, src] = callerOf(files, /\.vue$/);
    expect(src).toMatch(/import \{[^}]*pushToast as toast[^}]*\} from "[^"]*lib\/toast"/);
    // A page importing a module the project never emits is the same bug in a
    // different place.
    expect([...files.keys()]).toContain("w/src/lib/toast.ts");
  });

  it("angular — imports the shared module (a bare call in a method body needs no member lift)", async () => {
    const files = await generateSystemFiles(jsSrc("angular"));
    const [, src] = callerOf(files, /\.component\.ts$/);
    expect(src).toMatch(/import \{ toast \} from "\.\.\/\.\.\/lib\/toast"/);
    expect([...files.keys()]).toContain("w/src/lib/toast.ts");
  });

  for (const frontend of ["react", "vue", "svelte", "angular"] as const) {
    it(`${frontend} — a nested page's import specifier matches its own depth`, async () => {
      const files = await generateSystemFiles(nestedSrc(frontend));
      const [path, src] = callerOf(files, /\.(tsx|vue|svelte|ts)$/);
      const spec = src.match(/import \{[^}]*\btoast\b[^}]*\} from "([^"]+)"/)?.[1];
      expect(spec, `${frontend}: nested page calls toast() with no import`).toBeDefined();
      // Not every frontend nests — Angular flattens `area Ops` into
      // `pages/ops-deep.component.ts`, Svelte resolves through `$lib`.  So the
      // claim is not "the path has a subdirectory", it is that the specifier
      // agrees with where the file actually landed.  A prefix computed at the
      // wrong moment fails exactly here (and only here), which is the hole the
      // first draft of the Vue fix had.
      if (!(spec ?? "").startsWith("../")) return; // alias-resolved ($lib, @/)
      const depthFromPath = path.replace(/^w\/src\//, "").split("/").length - 1;
      const hops = (spec ?? "").match(/\.\.\//g)?.length ?? 0;
      expect(hops, `${path} → ${spec}`).toBe(depthFromPath);
    });
  }

  it("elixir/HEEx — put_flash through then/2, never a bare toast/1", async () => {
    const files = await generateSystemFiles(heexSrc);
    const live = [...files].find(([p]) => /live\/p_live\.ex$/.test(p));
    expect(live, "no LiveView module emitted for page P").toBeDefined();
    const src = live?.[1] ?? "";
    expect(src).toContain("put_flash(socket, :info,");
    // `tap/2` would evaluate and discard put_flash's new socket even once the
    // function resolved, so the pipe shape is part of the contract.
    expect(src).not.toMatch(/tap\(fn _ -> toast\(/);
    expect(src).not.toMatch(/(?<![._\w])toast\(/);
  });
});
