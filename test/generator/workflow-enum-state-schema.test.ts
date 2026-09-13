// A workflow whose PERSISTED STATE field is an enum — #2864 D4 (node backend)
// and T3 (four frontends).  One root cause, two symptom shapes.
//
// The read-only workflow-instance surface publishes the correlation-state row,
// so its wire DTO is built from `instanceWireShape` — the workflow's state
// fields.  When one of those is an `enum`, the DTO names `<Enum>Schema`, and
// the emitter that writes that reference has to BIND it.  None of them did:
//
//   node     `claimState: ClaimStateSchema` — declared nowhere in the tree
//            (TS2304).  The collector behind the local `const <Enum>Schema =
//            z.enum([…])` declarations was seeded from workflow PARAMS only,
//            so a state-only enum was never collected.  The per-aggregate
//            routes file had always got this right, which is what made the
//            omission invisible.
//   react    `import { ClaimStateSchema } from "./agency";` — nothing exports
//   vue      it.  The resolver fell back to "the first aggregate in the
//   svelte   context" whenever NO aggregate used the enum, which is exactly
//            the case a state-only enum is in.  vue fails `vue-tsc` (TS2305),
//            svelte fails `svelte-check`; react never reached a build gate.
//   angular  `claimState: unknown;` — builds, contract silently degraded: the
//            row can no longer be narrowed.
//
// And underneath the node TS2304, a second one the fix uncovered: the fresh
// saga row allocated `claimState: ""`, but drizzle types a pg enum column as
// the literal union of its members, so `""` is not assignable (TS2345).
//
// What is pinned here, and why each half matters:
//   1. every `<Enum>Schema` / `<Enum>` the emitted workflows module NAMES is
//      BOUND — declared in that file, or imported from a module that really
//      exports it.  Stated as reachability, not as a string match, so it
//      cannot pass by emitting some other plausible-looking text.
//   2. the OWNED case still IMPORTS, and imports from the RIGHT module.  A fix
//      that simply declared the schema locally every time would pass (1) while
//      duplicating a symbol the aggregate module already exports — and would
//      have passed even with the `aggregates[0]` fallback still in place, since
//      that fallback is only wrong when no aggregate owns the enum.
//   3. the allocate literal seeds a real enum member.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

/** `ownedByAggregate` decides whether any AGGREGATE also carries the enum.
 *  With it off, `ClaimState` is reachable only from the workflow's state — the
 *  shape the defect needed.  `Agency` is declared first and never uses the
 *  enum, so it is the module the broken resolver aimed at. */
const system = (platforms: string[], ownedByAggregate: boolean) => `system ClaimsSys {
  subdomain Claims {
    context Claims {
      enum ClaimState { Filed, Approved }
      aggregate Agency with crudish {
        name: string
      }
      aggregate Doc with crudish {
        title: string${ownedByAggregate ? "\n        state: ClaimState" : ""}
      }
      event Submitted { doc: Doc id, at: datetime }
      channel Lifecycle { carries: Submitted  delivery: broadcast  retention: ephemeral }
      workflow Review {
        doc: Doc id
        claimState: ClaimState
        create(e: Submitted) by e.doc { claimState := Filed }
      }
    }
  }
  ui WebApp {
    page Home { route: "/"  title: "Home" }
  }
  storage pg { type: postgres }
  resource claimsState { for: Claims, kind: state, use: pg }
  deployable api { platform: node, contexts: [Claims], dataSources: [claimsState], port: 3000 }
${platforms.map((p, i) => `  deployable web${p} { platform: ${p}, targets: api, ui: WebApp, port: ${3001 + i} }`).join("\n")}
}`;

const FRONTENDS = ["react", "vue", "svelte", "angular"] as const;

/** The emitted workflows module for a deployable, whatever the frontend calls
 *  its api directory. */
function workflowsModule(files: Map<string, string>, dir: string): string {
  const hit = [...files.entries()].find(
    ([p]) => p.startsWith(`${dir}/`) && p.endsWith("api/workflows.ts"),
  );
  expect(hit, `${dir} emitted an api/workflows.ts`).toBeTruthy();
  return hit![1];
}

/** Names a module's top-level `export`s — enough to answer "does the module an
 *  import points at actually export this?", which is the whole question the
 *  broken resolver got wrong. */
function exportsOf(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/^export\s+(?:const|type|interface|function|class)\s+(\w+)/gm)) {
    out.add(m[1]!);
  }
  return out;
}

/** Every name the module binds locally — declared here, or imported from
 *  somewhere.  Import specifiers are resolved against the CITED module's real
 *  exports, so an import of a name that module does not export binds nothing. */
function boundNames(
  files: Map<string, string>,
  modulePath: string,
  src: string,
): { bound: Set<string>; danglingImports: string[] } {
  const bound = new Set<string>(exportsOf(src));
  for (const m of src.matchAll(/^(?:const|type|interface|function|class)\s+(\w+)/gm)) {
    bound.add(m[1]!);
  }
  const dangling: string[] = [];
  const dir = modulePath.slice(0, modulePath.lastIndexOf("/"));
  for (const m of src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(\.[^"]*)"/gm)) {
    const names = m[1]!.split(",").map((n) => n.trim().replace(/^type\s+/, ""));
    const target = `${dir}/${m[2]!.replace(/^\.\//, "")}`;
    const mod = files.get(`${target}.ts`) ?? files.get(target);
    for (const n of names) {
      if (!n) continue;
      if (mod && exportsOf(mod).has(n)) bound.add(n);
      else if (mod) dangling.push(`${n} <- ${m[2]!}`);
      else bound.add(n); // a module outside this deployable's tree — not ours to judge
    }
  }
  return { bound, danglingImports: dangling };
}

describe("a workflow whose state field is an enum binds the schema it names", () => {
  it("node declares the <Enum>Schema it references, before use", async () => {
    const files = await generateSystemFiles(system([], false));
    const src = files.get("api/http/workflows.ts");
    expect(src, "node emitted http/workflows.ts").toBeTruthy();

    const decl = src!.indexOf('const ClaimStateSchema = z.enum(["Filed", "Approved"])');
    const use = src!.indexOf("claimState: ClaimStateSchema");
    expect(use, "the instance DTO references ClaimStateSchema").toBeGreaterThan(-1);
    expect(decl, "ClaimStateSchema is declared in the file that uses it").toBeGreaterThan(-1);
    expect(decl, "the declaration precedes the use").toBeLessThan(use);
  });

  it("node seeds a fresh saga row with a real enum member, not an empty string", async () => {
    const files = await generateSystemFiles(system([], false));
    const src = files.get("api/http/workflows.ts")!;
    expect(src).toContain('?? { doc: __key, claimState: "Filed" }');
    expect(src, "no empty-string default for an enum column").not.toContain('claimState: ""');
  });

  it.each(FRONTENDS)("%s binds every schema name its workflows module uses", async (fe) => {
    const files = await generateSystemFiles(system([fe], false));
    const dir = `web${fe}`;
    const path = [...files.keys()].find(
      (p) => p.startsWith(`${dir}/`) && p.endsWith("api/workflows.ts"),
    )!;
    const src = workflowsModule(files, dir);

    const { bound, danglingImports } = boundNames(files, path, src);
    expect(danglingImports, `${fe} imports names the cited module does not export`).toEqual([]);

    // The schema/type name the instance row is typed against, per frontend
    // flavour: zod schema on the three zod frontends, a TS union on Angular.
    const needed = fe === "angular" ? "ClaimState" : "ClaimStateSchema";
    expect(src, `${fe} types the enum state field`).toMatch(
      new RegExp(`claimState:\\s*${needed}\\b`),
    );
    expect([...bound], `${fe} binds ${needed}`).toContain(needed);
    expect(src, `${fe} does not degrade the enum to unknown`).not.toMatch(/claimState:\s*unknown/);
  });

  it.each(
    FRONTENDS,
  )("%s imports from the aggregate that owns the enum when one does", async (fe) => {
    const files = await generateSystemFiles(system([fe], true));
    const dir = `web${fe}`;
    const path = [...files.keys()].find(
      (p) => p.startsWith(`${dir}/`) && p.endsWith("api/workflows.ts"),
    )!;
    const src = workflowsModule(files, dir);
    const needed = fe === "angular" ? "ClaimState" : "ClaimStateSchema";

    // `Doc` owns it; `Agency` is declared FIRST and does not — so an import
    // of `./agency` is the exact regression the fallback used to cause.
    expect(src, `${fe} imports ${needed} from the owning aggregate`).toMatch(
      new RegExp(`import\\s+(?:type\\s+)?\\{\\s*${needed}\\s*\\}\\s+from\\s+"\\./doc"`),
    );
    expect(src, `${fe} does not aim the import at the first aggregate`).not.toContain('./agency"');
    const { danglingImports } = boundNames(files, path, src);
    expect(danglingImports, `${fe} imports resolve`).toEqual([]);
  });
});
