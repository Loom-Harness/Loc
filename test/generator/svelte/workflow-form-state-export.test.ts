// A `WorkflowForm` over a command workflow whose request parses form text (a
// `money` param) imports `<Wf>FormState` from the app's workflows module, so the
// module must export it.  `workflowFormStateAliases`
// (`src/generator/_frontend/workflows-module.ts`) is the one gate every
// frontend's workflows module emits the alias through.
//
// Binding claim over generated source, on every JS-family frontend: each name a
// generated page imports from the app's api modules is exported by that module.
// A missing export is a compile error (`svelte-check`: "Module
// '$lib/api/workflows' has no exported member …"); `svelte-check` on the
// generated app is the slow-tier witness.  Non-vacuity: the page does import
// the form-state type (React and Svelte; Vue's form imports none).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const model = (framework: string) => `
system Crm {
  subdomain Sales {
    context Sales {
      aggregate Customer with crudish { name: string  creditLimit: money }
      repository Customers for Customer { }
      workflow OnboardCustomer {
        name: string
        create(name: string, creditLimit: money) { let c = Customer.create(name: name, creditLimit: creditLimit) }
      }
    }
  }
  api SalesApi from Sales
  ui Web with scaffold(subdomains: [Sales]) { framework: ${framework} }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable api { platform: node  contexts: [Sales]  dataSources: [st]  serves: SalesApi  port: 3000 }
  deployable web { platform: web  targets: api  ui: Web  port: 3001 }
}
`;

/** `import { A, type B } from "<spec>"` → [spec, names] for every named import. */
function namedImports(src: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    const names = m[1]!
      .split(",")
      .map((n) =>
        n
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]!
          .trim(),
      )
      .filter(Boolean);
    out.push([m[2]!, names]);
  }
  return out;
}

/** The generated file an api-module import specifier names, or undefined. */
function apiModuleFor(spec: string, files: Map<string, string>): string | undefined {
  const leaf = spec.match(/(?:\$lib\/api|\/api)\/([\w-]+)$/)?.[1];
  if (!leaf) return undefined;
  return [...files.keys()].find((p) => p.startsWith("web/src/") && p.endsWith(`/api/${leaf}.ts`));
}

function exportsName(src: string, name: string): boolean {
  return new RegExp(
    `export\\s+(?:const|type|function|interface|class|async function)\\s+${name}\\b`,
  ).test(src);
}

describe("every name a page imports from the api modules is exported there", () => {
  it.each(["react", "vue", "svelte"])("%s", async (framework) => {
    const files = await generateSystemFiles(model(framework));
    const missing: string[] = [];
    let importsFormState = false;
    let checked = 0;
    for (const [path, src] of files) {
      if (!path.startsWith("web/src/") || path.includes("/api/")) continue;
      for (const [spec, names] of namedImports(src)) {
        const mod = apiModuleFor(spec, files);
        if (!mod) continue;
        for (const n of names) {
          checked++;
          if (n === "OnboardCustomerFormState") importsFormState = true;
          if (!exportsName(files.get(mod)!, n)) missing.push(`${path}: ${n} from ${mod}`);
        }
      }
    }
    expect(missing, `${framework}: imported but not exported`).toEqual([]);
    expect(checked, `${framework}: pages import from the api modules`).toBeGreaterThan(0);
    // Vue's form binds the request schema directly and imports no form-state type.
    if (framework !== "vue") {
      expect(importsFormState, `${framework}: a page imports the workflow form state`).toBe(true);
    }
  }, 120_000);
});
