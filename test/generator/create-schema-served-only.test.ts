// A create request schema exists only for an aggregate that serves a create.
//
// String tier, ABSENCE: the claim is that a file / export is NOT emitted, which
// no compile or booted leg observes (a dead schema compiles and is never
// called).  `Squad` is `crudish(updateOnly: true)`, so it serves no create; the
// Elixir OpenAPI emitter and the Svelte api module emitted a
// `Create<Agg>Request` for it anyway (Svelte also a `useCreate<Agg>` hook
// POSTing to a route that does not exist).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (backend: string, frontend: string) => `
system S {
  subdomain Sub { context C {
    aggregate Squad with crudish(updateOnly: true) { name: string }
    aggregate Team with crudish { name: string }
    repository Squads for Squad
    repository Teams for Team
  } }
  api Api from Sub
  ui Web with scaffold(subdomains: [Sub]) { framework: ${frontend} }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${backend} contexts: [C] dataSources: [st] serves: Api port: 3000 }
  deployable web { platform: web targets: api ui: Web port: 3001 }
}`;

describe("create request schema only for a served create", () => {
  it("elixir: no create_<agg>_request/response schema for an aggregate with no create", async () => {
    const files = await generateSystemFiles(src("elixir", "svelte"));
    const paths = [...files.keys()];
    expect(paths.some((p) => p.endsWith("/create_team_request.ex"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/create_squad_request.ex"))).toBe(false);
    expect(paths.some((p) => p.endsWith("/create_squad_response.ex"))).toBe(false);
  });

  it("svelte: no Create<Agg>Request schema or useCreate<Agg> hook for an aggregate with no create", async () => {
    const files = await generateSystemFiles(src("node", "svelte"));
    const of = (name: string) =>
      [...files].find(([p]) => p.endsWith(`/lib/api/${name}.ts`))?.[1] ?? "";
    expect(of("team")).toContain("export function useCreateTeam(");
    expect(of("squad")).not.toBe("");
    expect(of("squad")).not.toContain("CreateSquadRequest");
    expect(of("squad")).not.toContain("useCreateSquad");
  });
});
