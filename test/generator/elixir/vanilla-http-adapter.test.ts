// The generated Phoenix app serves on BANDIT, not Plug.Cowboy.
//
// This is a supply-chain fix, not a preference.  `plug_cowboy` pulls
// `cowboy`, which pulls `cowlib` — and cowlib's LATEST release, 2.20.0, is
// itself the one carrying CVE-2026-43966 (HTTP response splitting, MEDIUM)
// and CVE-2026-43969 (cookie header injection, LOW).  There is no fixed
// version to pin to, so while the emitter spelled `plug_cowboy` every
// generated Elixir project shipped a flagged transitive dependency, and
// `mix deps.get` printed "Found packages with security advisories" on every
// single build.  Bandit is pure Elixir, is Phoenix 1.8's own default
// adapter, and pulls none of that chain.
//
// The assertions below pin the EMITTED SOURCE.  The claim that actually
// matters — that the dependency chain is gone — is pinned one tier up, in
// `test/e2e/generated-elixir-vanilla-build.test.ts`, which asserts on the
// real `mix.lock` after a real `mix deps.get`.  A source-shape test cannot
// prove a lockfile.

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system Shop {
  subdomain S {
    context C {
      aggregate Order with crudish { total: int }
      repository Orders for Order { }
    }
  }
  api CApi from S
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [C]
    dataSources: [cs]
    serves: CApi
    port: 4000
  }
}
`;

describe("the generated Phoenix app serves on Bandit", () => {
  let mix = "";
  let config = "";
  beforeAll(async () => {
    const files = await generateSystemFiles(SOURCE);
    const get = (suffix: string) =>
      files.get([...files.keys()].find((k) => k.endsWith(suffix)) as string) as string;
    mix = get("/mix.exs");
    config = get("/config/config.exs");
  });

  it("declares bandit and not plug_cowboy", () => {
    expect(mix).toContain('{:bandit, "~> 1.12"},');
    // The whole point: the cowboy chain must not be reachable from the
    // dependency list at all.  `plug_cowboy` is the only edge into it.
    expect(mix).not.toContain(":plug_cowboy,");
  });

  it("points the endpoint at Bandit.PhoenixAdapter", () => {
    expect(config).toContain("adapter: Bandit.PhoenixAdapter,");
    expect(config).not.toContain("Cowboy2Adapter");
  });
});
