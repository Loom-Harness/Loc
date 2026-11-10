// The generated `test/locale_test.exs` exercises locale negotiation, so it is
// emitted only where a LiveView app negotiates (two or more shipped locales,
// or a LocaleSwitcher).  Emitting it into every i18n-enabled app made the build
// harness run `mix test` on apps that cannot boot under test (an OIDC JWKS
// fetch with no issuer), with nothing to negotiate.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const fixture = (name: string): string =>
  readFileSync(`test/e2e/fixtures/elixir-vanilla-build/${name}`, "utf8");

describe("elixir — generated locale test emission", () => {
  it("is absent for a single-locale i18n app", async () => {
    const files = await generateSystemFiles(fixture("vanilla-tenancy-liveview-reads.ddd"));
    expect([...files.keys()].some((p) => p.endsWith("test/locale_test.exs"))).toBe(false);
  });

  it("is present when the app negotiates between shipped locales", async () => {
    const files = await generateSystemFiles(fixture("vanilla-locales.ddd"));
    expect([...files.keys()].some((p) => p.endsWith("test/locale_test.exs"))).toBe(true);
  });
});
