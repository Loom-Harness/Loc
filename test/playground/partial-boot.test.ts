import { describe, expect, it } from "vitest";
import { deployableRows } from "../../web/src/backend/deployable-rows.js";
import {
  bootableBackends,
  bootPlan,
  unavailableDeployables,
} from "../../web/src/build/boot-plan.js";
import type { BundleOk, BundleResult } from "../../web/src/bundle/protocol.js";

// A system boots partly: the Hono backends that bundled run, and the system's
// other deployables — a platform the browser cannot run, or a backend whose
// bundle failed — are left out with a reason the Runtime panel shows and a
// cross-deployable call to one answers with.  The browser-level proof is
// web/e2e/partial-boot.spec.ts.

const ok = (code: string): BundleOk =>
  ({ ok: true, code, size: code.length, durationMs: 1, fetchedUrls: [] }) as unknown as BundleOk;
const failed: BundleResult = {
  ok: false,
  diagnostics: [{ severity: "error", message: "Could not resolve x" }],
};

describe("partial boot", () => {
  it("boots the backends that bundled and leaves the failed one out", () => {
    const booted = bootableBackends([
      { slug: "shipping", entry: "shipping/http/index.ts", bundle: ok("a") },
      { slug: "billing", entry: "billing/http/index.ts", bundle: failed },
    ]);
    expect(booted?.map((b) => b.slug)).toEqual(["shipping"]);
    expect(
      bootableBackends([{ slug: "billing", entry: "billing/http/index.ts", bundle: failed }]),
    ).toBeNull();
    expect(bootableBackends([])).toBeNull();
  });

  it("names every deployable the boot leaves out, with why", () => {
    expect(
      unavailableDeployables(
        ["shipping", "billing"],
        ["shipping"],
        [{ slug: "orders", label: ".NET" }],
      ),
    ).toEqual([
      { slug: "billing", reason: "its bundle failed (see the Bundle stage)" },
      { slug: "orders", reason: ".NET runs outside the playground" },
    ]);
  });

  it("carries the left-out deployables on the boot plan", () => {
    const { plan } = bootPlan(
      [{ slug: "shipping", entry: "shipping/http/index.ts", bundle: ok("a") }],
      { kind: "unversioned" } as never,
      [],
      () => ({ dataDir: ":memory:", island: null }),
      undefined,
      [],
      null,
      [{ slug: "orders", reason: ".NET runs outside the playground" }],
    );
    expect(plan.backends.map((b) => b.slug)).toEqual(["shipping"]);
    expect(plan.unavailable).toEqual([
      { slug: "orders", reason: ".NET runs outside the playground" },
    ]);
  });

  it("lists a left-out deployable as not runnable, after the booted ones", () => {
    expect(
      deployableRows(["shipping"], [{ slug: "shipping", storage: "db" }], null, [
        { slug: "orders", reason: ".NET runs outside the playground" },
      ]),
    ).toEqual([
      { slug: "shipping", state: "booted", storage: "db" },
      {
        slug: "orders",
        state: "unavailable",
        storage: null,
        reason: ".NET runs outside the playground",
      },
    ]);
  });
});
