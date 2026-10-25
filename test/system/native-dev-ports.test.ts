// A generated project started natively — `npm run dev`, `dotnet run`,
// `gradle bootRun`, `mix phx.server`, `ng serve` — listens on its deployable's
// DECLARED port and reaches its target backend on THAT deployable's declared
// port, while the container still serves its fixed internal port.
//
// The model gives every deployable a port no default would land on (4105 for
// the backend, 4106 for the frontend), so a hard-coded container port or a
// framework default shows up as a mismatch.  A frontend that listened on the
// container port (3000) collided with a backend declared on 3000 the moment
// both ran on one host; the README promised the declared port and the dev
// server ignored it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const API_PORT = 4105;
const WEB_PORT = 4106;

function model(backend: string, frontend?: { platform: string; design?: string }): string {
  return `
  system Clinic {
    subdomain Care {
      context Scheduling {
        aggregate Doctor with crudish {
          name: string
        }
        repository Doctors for Doctor { }
      }
    }
    storage primary { type: postgres }
    resource state { for: Scheduling, kind: state, use: primary }
    ${frontend ? "ui Front with scaffold(subdomains: [Care]) { }" : ""}
    deployable api {
      platform: ${backend}, contexts: [Scheduling], dataSources: [state], port: ${API_PORT}
    }
    ${
      frontend
        ? `deployable web {
      platform: ${frontend.platform}, targets: api, ui: Front, port: ${WEB_PORT}${
        frontend.design ? `, design: ${frontend.design}` : ""
      }
    }`
        : ""
    }
  }
`;
}

/** The `PORT ?? <n>` / `PORT || "<n>"` default a native run falls back to. */
function portDefault(src: string): string | undefined {
  return /PORT"?\)?\s*(?:\?\?|\|\|)\s*"?(\d+)"?/.exec(src)?.[1];
}

describe("native dev servers default to the deployable's declared port", () => {
  describe.each([
    { platform: "react", design: "mantine" },
    { platform: "react", design: "shadcn" },
    { platform: "vue", design: "vuetify" },
    { platform: "vue", design: "shadcnVue" },
    { platform: "svelte", design: "flowbite" },
    { platform: "svelte", design: "shadcnSvelte" },
  ])("$platform ($design) vite config", (frontend) => {
    it("dev + preview listen on the declared port and proxy /api to the target's", async () => {
      const files = await generateSystemFiles(model("node", frontend));
      const vite = files.get("web/vite.config.ts")!;
      expect(portDefault(vite)).toBe(String(WEB_PORT));
      expect(vite).toMatch(/server: \{ port, /);
      expect(vite).toMatch(/preview: \{ port, /);
      expect(vite).not.toMatch(/port: 3000/);
      expect(vite).toContain(`?? "http://localhost:${API_PORT}"`);
      // The script no longer pins a port that would beat the config.
      const scripts = JSON.parse(files.get("web/package.json")!).scripts as Record<string, string>;
      expect(scripts.preview).not.toMatch(/--port/);
      // The container keeps its internal port: the image passes it explicitly.
      expect(files.get("web/Dockerfile")!).toMatch(/"--port", "3000"/);
      expect(files.get("docker-compose.yml")!).toContain(`"${WEB_PORT}:3000"`);
    });
  });

  it("angular: ng serve + server.mjs listen on the declared port; ng serve proxies /api", async () => {
    const files = await generateSystemFiles(model("node", { platform: "angular" }));
    const ng = JSON.parse(files.get("web/angular.json")!);
    const serve = Object.values(
      ng.projects as Record<string, { architect: { serve: { options: Record<string, unknown> } } }>,
    )[0].architect.serve.options;
    expect(serve.port).toBe(WEB_PORT);
    expect(serve.proxyConfig).toBe("proxy.conf.json");
    expect(JSON.parse(files.get("web/proxy.conf.json")!)).toEqual({
      "/api": { target: `http://localhost:${API_PORT}`, secure: false },
    });
    expect(JSON.parse(files.get("web/package.json")!).scripts.dev).toBe("ng serve");
    expect(portDefault(files.get("web/server.mjs")!)).toBe(String(WEB_PORT));
    expect(files.get("web/Dockerfile")!).toContain("ENV PORT=3000");
  });

  it("feliz: vite dev listens on the declared port and proxies /api to the target's", async () => {
    const files = await generateSystemFiles(model("node", { platform: "feliz" }));
    const vite = files.get("web/vite.config.js")!;
    expect(portDefault(vite)).toBe(String(WEB_PORT));
    expect(vite).toContain(`?? "http://localhost:${API_PORT}"`);
    expect(vite).toContain("server: { port, host: true, proxy }");
  });

  it("node: index.ts listens on the declared port unless PORT is set; the image sets PORT", async () => {
    const files = await generateSystemFiles(model("node"));
    expect(portDefault(files.get("api/index.ts")!)).toBe(String(API_PORT));
    expect(files.get("api/Dockerfile")!).toContain("PORT=3000");
  });

  it("dotnet: an unconfigured `dotnet run` binds the declared port; the image sets ASPNETCORE_URLS", async () => {
    const files = await generateSystemFiles(model("dotnet"));
    const program = files.get("api/Program.cs")!;
    expect(program).toContain(`builder.WebHost.UseUrls("http://localhost:${API_PORT}");`);
    expect(program).toContain('string.IsNullOrEmpty(builder.Configuration["urls"])');
    expect(files.get("api/Dockerfile")!).toContain("ENV ASPNETCORE_URLS=http://+:8080");
  });

  it("java: application.yml names the declared port; the image overrides it with SERVER_PORT", async () => {
    const files = await generateSystemFiles(model("java"));
    const yml = [...files].find(([p]) => p.endsWith("src/main/resources/application.yml"))![1];
    expect(yml).toMatch(new RegExp(`^server:\\n  port: ${API_PORT}\\n`));
    expect(files.get("api/Dockerfile")!).toContain("ENV SERVER_PORT=8080");
  });

  it("elixir: dev.exs defaults to the declared port; the release reads PORT from compose", async () => {
    const files = await generateSystemFiles(model("elixir"));
    expect(portDefault(files.get("api/config/dev.exs")!)).toBe(String(API_PORT));
    expect(files.get("docker-compose.yml")!).toMatch(/PORT: "4000"/);
  });
});
