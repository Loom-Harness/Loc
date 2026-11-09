import { describe, expect, it } from "vitest";
import type { GenerateOk } from "../../web/src/build/protocol.js";
import type { BundleOk } from "../../web/src/bundle/protocol.js";
import { describePendingMigration } from "../../web/src/layout/pending-migration.js";
import { deriveStages, nextStage, type StageInputs } from "../../web/src/layout/pipeline-stages.js";
import { initialPipelineState, type PipelineState } from "../../web/src/pipeline/state.js";

// The pipeline strip's state derivation (M-T8.16 slice 1) — the pure half of
// `PipelineStrip.tsx`, so every segment state is pinned here without a
// browser.  The e2e spec (`web/e2e/pipeline-strip.spec.ts`) covers the
// rendering + tooltips.

const generated: GenerateOk = {
  ok: true,
  mode: "system",
  files: [
    { path: "a.ts", content: "", size: 0 },
    { path: "b.ts", content: "", size: 0 },
  ],
  diagnostics: [],
};

const hono: BundleOk = {
  ok: true,
  code: "",
  css: "",
  size: 2048,
  durationMs: 1,
  fetchedUrls: [],
  diagnostics: [],
} as unknown as BundleOk;

function inputs(
  over: Partial<StageInputs> & { pipeline?: Partial<PipelineState> } = {},
): StageInputs {
  const { pipeline, ...rest } = over;
  return {
    isDesktop: true,
    errorCount: 0,
    generateResult: null,
    generateSuccess: null,
    honoBundleResult: null,
    reactBundleResult: null,
    honoBundle: null,
    ddl: null,
    bootErrorMessage: null,
    bootPending: null,
    pendingMigration: null,
    ...rest,
    pipeline: { ...initialPipelineState, ...pipeline },
  };
}

const byId = (c: StageInputs) => Object.fromEntries(deriveStages(c).map((s) => [s.id, s]));

describe("deriveStages", () => {
  it("fresh desktop load: Validate ok (0 errors), Generate idle, Bundle + Boot blocked with their blockers", () => {
    const s = byId(inputs());
    expect(s.validate).toMatchObject({ state: "ok", count: "0 errors" });
    expect(s.generate).toMatchObject({ state: "idle", enabled: true });
    expect(s.bundle).toMatchObject({ state: "blocked", enabled: false });
    expect(s.bundle.blocker).toMatch(/^Generate first/);
    expect(s.boot).toMatchObject({ state: "blocked", enabled: false });
    expect(s.boot.blocker).toMatch(/^Generate, then Bundle, then Boot/);
    expect(nextStage(deriveStages(inputs()))).toBe("generate");
  });

  it("errors block Generate and name the count; Validate is failed with the count", () => {
    const s = byId(
      inputs({ errorCount: 2, generateSuccess: generated, generateResult: generated }),
    );
    expect(s.validate).toMatchObject({ state: "failed", count: "2 errors" });
    expect(s.generate).toMatchObject({ state: "blocked", enabled: false });
    expect(s.generate.blocker).toContain("Fix the 2 errors");
    // The stale generate output still bundles (today's gating) — only the
    // strip's Generate segment is blocked.
    expect(s.bundle.state).toBe("idle");
    expect(nextStage(deriveStages(inputs({ errorCount: 1 })))).toBeNull();
  });

  it("a successful generate unblocks Bundle and carries the file count", () => {
    const s = byId(inputs({ generateSuccess: generated, generateResult: generated }));
    expect(s.generate).toMatchObject({ state: "ok", count: "2 files" });
    expect(s.bundle).toMatchObject({ state: "idle", enabled: true, blocker: null });
    expect(s.boot.state).toBe("blocked");
    expect(
      nextStage(deriveStages(inputs({ generateSuccess: generated, generateResult: generated }))),
    ).toBe("bundle");
  });

  it("running flags win over everything else", () => {
    const s = byId(inputs({ errorCount: 1, pipeline: { generating: true } }));
    expect(s.generate).toMatchObject({ state: "running", enabled: false });
    expect(nextStage(deriveStages(inputs({ pipeline: { bundling: true } })))).toBeNull();
  });

  it("a failed generate is failed with its error count", () => {
    const failed = {
      ok: false as const,
      diagnostics: [
        { severity: "error" as const, message: "x" },
        { severity: "warning" as const, message: "y" },
      ],
    };
    const s = byId(inputs({ generateResult: failed }));
    expect(s.generate).toMatchObject({ state: "failed", count: "1 error", enabled: true });
  });

  it("bundle ok carries the size; boot then idles, boots, or fails", () => {
    const base = inputs({
      generateSuccess: generated,
      generateResult: generated,
      honoBundleResult: hono,
      honoBundle: hono,
    });
    expect(byId(base).bundle).toMatchObject({ state: "ok", count: "2.0 KB" });
    expect(byId(base).boot).toMatchObject({ state: "idle", enabled: true });
    expect(nextStage(deriveStages(base))).toBe("boot");
    expect(byId({ ...base, ddl: "create table" }).boot.state).toBe("ok");
    expect(byId({ ...base, bootErrorMessage: "boom" }).boot.state).toBe("failed");
    const pending = byId({
      ...base,
      bootPending: {
        migration: {
          kind: "unrecorded",
          head: null,
          initial: true,
          modules: ["Sales"],
          steps: 2,
          destructive: false,
        },
        message: "Migration required — record it",
      },
    }).boot;
    expect(pending).toMatchObject({
      state: "failed",
      count: "migration required",
      hint: "Migration required — record it",
      enabled: true,
    });
    expect(nextStage(deriveStages({ ...base, ddl: "x" }))).toBeNull();
  });

  it("a failed bundle is failed with its error count and Boot stays blocked", () => {
    const fail = {
      ok: false as const,
      diagnostics: [{ severity: "error" as const, message: "nope" }],
    };
    const s = byId(
      inputs({ generateSuccess: generated, generateResult: generated, honoBundleResult: fail }),
    );
    expect(s.bundle).toMatchObject({ state: "failed", count: "1 error" });
    expect(s.boot.state).toBe("blocked");
  });

  it("mobile before the first Run: Validate idle (no LSP, no result yet)", () => {
    expect(byId(inputs({ isDesktop: false })).validate).toMatchObject({
      state: "idle",
      count: null,
    });
    expect(
      byId(inputs({ isDesktop: false, generateResult: generated, generateSuccess: generated }))
        .validate.state,
    ).toBe("ok");
  });
});

describe("the migration badge", () => {
  const bundled = inputs({
    generateSuccess: generated,
    generateResult: generated,
    honoBundleResult: hono,
    honoBundle: hono,
  });
  const initial = {
    kind: "unrecorded" as const,
    initial: true,
    modules: ["Sales", "Billing", "Shipping"],
    steps: 14,
    destructive: false,
  };

  it("an unrecorded initial migration blocks Boot with the record-first blocker", () => {
    const boot = byId({ ...bundled, pendingMigration: initial }).boot;
    expect(boot).toMatchObject({ state: "blocked", enabled: false, count: "migration required" });
    expect(boot.blocker).toMatch(/^Record the initial migration first, then apply it/);
    // An incremental unrecorded change leaves Boot to report it.
    expect(
      byId({ ...bundled, pendingMigration: { ...initial, initial: false, steps: 1 } }).boot,
    ).toMatchObject({ state: "idle", enabled: true });
    expect(byId({ ...bundled, pendingMigration: { kind: "up-to-date" } }).boot.state).toBe("idle");
  });

  it("reads the initial schema as one line whatever its size, and offers Record", () => {
    expect(describePendingMigration(initial)).toMatchObject({
      kind: "unrecorded",
      title: "migration required",
      detail: "initial schema",
      destructive: false,
      action: "record",
    });
    expect(describePendingMigration(initial)?.hint).toContain("modules Sales, Billing, Shipping");
  });

  it("counts unrecorded changes in the CLI's words and flags a destructive one", () => {
    const view = describePendingMigration({
      ...initial,
      initial: false,
      steps: 3,
      modules: ["Sales"],
      destructive: true,
    });
    expect(view).toMatchObject({
      detail: "3 unrecorded changes",
      destructive: true,
      action: "record",
    });
    expect(view?.hint).toMatch(/not recorded in migrations\/ \(what ddd migrate status lists\)/);
    expect(view?.hint).toContain("--allow-destructive");
    expect(describePendingMigration({ ...initial, initial: false, steps: 1 })?.detail).toBe(
      "1 unrecorded change",
    );
  });

  it("recorded, not applied offers Apply; up to date and unknown show nothing", () => {
    expect(
      describePendingMigration({ kind: "recorded-not-applied", units: ["v2_sales_add_phone"] }),
    ).toMatchObject({
      kind: "recorded-not-applied",
      title: "migration recorded",
      detail: "1 migration not applied",
      action: "apply",
    });
    expect(describePendingMigration({ kind: "up-to-date" })).toBeNull();
    expect(describePendingMigration(null)).toBeNull();
  });
});
