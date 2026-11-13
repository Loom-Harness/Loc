import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveChromiumFallback } from "./browser-fallback.mjs";

function store(...revs: string[]) {
  const root = mkdtempSync(join(tmpdir(), "pw-store-"));
  for (const r of revs) {
    const bin = r.startsWith("chromium_headless_shell")
      ? "chrome-headless-shell-linux64/chrome-headless-shell"
      : "chrome-linux64/chrome";
    mkdirSync(dirname(join(root, r, bin)), { recursive: true });
    writeFileSync(join(root, r, bin), "");
  }
  return root;
}

describe("resolveChromiumFallback", () => {
  it("is a no-op when the pinned browser is installed", () => {
    const root = store("chromium-1228", "chromium-1243");
    const pinned = join(root, "chromium-1228/chrome-linux64/chrome");
    expect(resolveChromiumFallback({ pinned, env: {}, root })).toBeUndefined();
  });

  it("picks the newest installed build when the pinned one is missing", () => {
    const root = store("chromium-1234", "chromium-1243");
    const pinned = join(root, "chromium-1228/chrome-linux64/chrome");
    expect(resolveChromiumFallback({ pinned, env: {}, root })).toBe(
      join(root, "chromium-1243/chrome-linux64/chrome"),
    );
  });

  it("falls back to a headless shell when no full chromium is installed", () => {
    const root = store("chromium_headless_shell-1243");
    expect(resolveChromiumFallback({ pinned: join(root, "x"), env: {}, root })).toBe(
      join(
        root,
        "chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
      ),
    );
  });

  it("prefers <root>/chromium over scanning, and LOOM_CHROMIUM_PATH over both", () => {
    const root = store("chromium-1243");
    writeFileSync(join(root, "chromium"), "");
    const pinned = join(root, "missing");
    expect(resolveChromiumFallback({ pinned, env: {}, root })).toBe(join(root, "chromium"));
    const override = join(root, "custom");
    writeFileSync(override, "");
    expect(resolveChromiumFallback({ pinned, env: { LOOM_CHROMIUM_PATH: override }, root })).toBe(
      override,
    );
  });

  it("returns undefined when nothing is installed", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-empty-"));
    expect(resolveChromiumFallback({ pinned: join(root, "x"), env: {}, root })).toBeUndefined();
    expect(
      resolveChromiumFallback({ pinned: "x", env: {}, root: join(root, "absent") }),
    ).toBeUndefined();
  });
});
