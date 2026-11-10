// The generated `test/locale_test.exs` exercises locale negotiation, so it is
// emitted only where a LiveView app negotiates (two or more shipped locales,
// or a LocaleSwitcher): an app with a single locale has nothing to negotiate.
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
