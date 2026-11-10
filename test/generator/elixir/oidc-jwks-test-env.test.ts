// `mix test` on an OIDC app has no issuer to fetch keys from, so the JWKS
// strategy (synchronous first fetch) is gated on an app env that `config/test.exs`
// turns off.  Dev and prod never set it, so they still fetch at boot.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const fixture = (name: string): string =>
  readFileSync(`test/e2e/fixtures/elixir-vanilla-build/${name}`, "utf8");

const find = (files: Map<string, string>, suffix: string): string => {
  const key = [...files.keys()].find((p) => p.endsWith(suffix));
  expect(key, suffix).toBeDefined();
  return files.get(key as string) as string;
};

describe("elixir — OIDC JWKS strategy under mix test", () => {
  it("gates the strategy on :start_jwks_strategy and filters the nil child", async () => {
    const files = await generateSystemFiles(fixture("vanilla-tenancy-liveview-reads.ddd"));
    const app = find(files, "lib/api/application.ex");
    expect(app).toContain(
      "if(Application.get_env(:api, :start_jwks_strategy, true), do: {ApiWeb.Auth.JwksStrategy, first_fetch_sync: true",
    );
    expect(app).toContain("|> Enum.reject(&is_nil/1)");
  });

  it("turns the strategy off in config/test.exs only, never in dev/prod/runtime", async () => {
    const files = await generateSystemFiles(fixture("vanilla-tenancy-liveview-reads.ddd"));
    expect(find(files, "config/test.exs")).toContain("config :api, :start_jwks_strategy, false");
    for (const f of [
      "config/config.exs",
      "config/dev.exs",
      "config/prod.exs",
      "config/runtime.exs",
    ]) {
      expect(find(files, f)).not.toContain("start_jwks_strategy");
    }
  });

  it("leaves a non-OIDC app's supervision tree and test config untouched", async () => {
    const files = await generateSystemFiles(fixture("vanilla-domain-tests.ddd"));
    expect(find(files, "lib/api/application.ex")).not.toContain("is_nil");
    expect(find(files, "config/test.exs")).not.toContain("start_jwks_strategy");
  });
});
