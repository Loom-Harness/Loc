import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// `platform: web` — the one frontend platform for the static-bundle
// frameworks.  The bound ui's `framework:` picks react / vue / svelte /
// angular (absent = react); the deployable targets a backend, mounts a `ui:`,
// owns no contexts and carries no realization axes, and its design pack must
// match the ui's framework.
// ---------------------------------------------------------------------------

const BASE = `
  subdomain M { context C { aggregate A { x: int } } }
`;

const sys = (body: string): string => `
  system S {
    ${BASE}
    deployable api { platform: node, contexts: [C], port: 3000 }
    ${body}
  }
`;

describe("validator: web deployable", () => {
  it.each([
    "",
    "framework: react",
    "framework: vue",
    "framework: svelte",
    "framework: angular",
  ])("accepts a web deployable with `targets:` + `ui:` (%s)", async (fw) => {
    const { errors } = await parseString(
      sys(`ui WebApp { ${fw} }
             deployable web { platform: web, targets: api, ui: WebApp }`),
    );
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("accepts a scaffold-populated `ui:` binding", async () => {
    const { errors } = await parseString(`
      system S {
        subdomain M {
          context C {
            aggregate A { name: string  derived display: string = name }
            repository As for A { }
          }
        }
        ui WebApp with scaffold(subdomains: [M]) { }
        deployable api { platform: node, contexts: [C], port: 3000 }
        deployable web { platform: web, targets: api, ui: WebApp, port: 3001 }
      }
    `);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("emits `loom.web-deployable-missing-ui` on a web deployable with no ui binding", async () => {
    const { errors } = await parseString(sys(`deployable web { platform: web, targets: api }`));
    expect(
      errors.some(
        (e) => /Web deployable 'web' must declare a 'ui:' binding/.test(e) && /scaffold/.test(e),
      ),
      errors.join("\n"),
    ).toBe(true);
  });

  it("requires `targets:`", async () => {
    const { errors } = await parseString(
      sys(`ui WebApp { }
           deployable web { platform: web, ui: WebApp }`),
    );
    expect(
      errors.some((e) => /Frontend deployable 'web' must declare 'targets:/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("rejects a web deployable targeting another frontend", async () => {
    const { errors } = await parseString(
      sys(`ui WebApp { }
           deployable web1 { platform: web, targets: api, ui: WebApp }
           deployable web2 { platform: web, targets: web1, ui: WebApp }`),
    );
    expect(
      errors.some((e) => /cannot target another frontend/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it.each([
    { fw: "", design: "vuetify", says: /is a vue pack but framework 'react' renders tsx/ },
    {
      fw: "framework: vue",
      design: "mantine",
      says: /is a tsx pack but framework 'vue' renders vue/,
    },
    {
      fw: "framework: svelte",
      design: "shadcnVue",
      says: /is a vue pack but framework 'svelte' renders svelte/,
    },
    {
      fw: "framework: angular",
      design: "mantine",
      says: /is a tsx pack but framework 'angular' renders angular.*angularMaterial.*primeng.*spartanNg/s,
    },
  ])("rejects a $design pack under a ui with `$fw` (format mismatch)", async ({
    fw,
    design,
    says,
  }) => {
    const { errors } = await parseString(
      sys(`ui WebApp { ${fw} }
           deployable web { platform: web, targets: api, ui: WebApp, design: ${design} }`),
    );
    expect(
      errors.some((e) => says.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("rejects realization axes (frontends carry none)", async () => {
    const { errors } = await parseString(
      sys(`ui WebApp { }
           deployable web { platform: web { persistence: drizzle }, targets: api, ui: WebApp }`),
    );
    expect(
      errors.some((e) => /realization axes apply to backend deployables/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });
});
