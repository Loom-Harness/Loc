import { describe, expect, it } from "vitest";
import {
  formatUnsupportedDeployables,
  type UnsupportedPlatform,
  unsupportedPlatformLabel,
} from "../../web/src/layout/ctx.js";

// ---------------------------------------------------------------------------
// Playground "preview unsupported" surfacing.
//
// The in-browser preview engine bundles only the React SPA shape, so
// dotnet / phoenix backends — and the feliz / flutter frontends, whose
// Fable and Flutter builds aren't reproduced
// in-browser — are listed in the UI instead of showing a silent blank
// Preview.  These pin the labels + the comma-joined formatter so each
// platform reads cleanly (`analyzeDeployables` in
// web/src/build/deployables.ts maps the generated project markers to these;
// `deployables.test.ts` pins that detection).
// ---------------------------------------------------------------------------

describe("unsupported-platform labels", () => {
  it("labels every UnsupportedPlatform with a human name", () => {
    const labels: Record<UnsupportedPlatform, string> = {
      dotnet: ".NET",
      elixir: "Phoenix LiveView",
      java: "Spring Boot",
      python: "FastAPI",
      feliz: "Feliz",
      flutter: "Flutter",
    };
    for (const [platform, label] of Object.entries(labels)) {
      expect(unsupportedPlatformLabel(platform as UnsupportedPlatform)).toBe(label);
    }
  });

  it("formats a mixed deployable list as 'slug (Label)' joined by commas", () => {
    expect(
      formatUnsupportedDeployables([
        { slug: "web", platform: "feliz" },
        { slug: "admin", platform: "flutter" },
        { slug: "api", platform: "dotnet" },
      ]),
    ).toBe("web (Feliz), admin (Flutter), api (.NET)");
  });
});
