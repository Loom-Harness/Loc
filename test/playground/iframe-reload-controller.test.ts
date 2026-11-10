import { describe, expect, it } from "vitest";

import { makePreviewHtml } from "../../web/src/preview/iframe-html.js";

// The preview now refreshes in place: instead of remounting the iframe
// on every rebuild, the parent pushes a `loom-reload` message over the
// existing bridge port and a controller embedded in the document swaps
// the bundle in `#root` without rewriting the document.  These asserts
// pin that contract on the synthesised HTML so a refactor of the
// document shape can't silently drop the controller (which would make
// the playground fall back to the old full-remount behaviour).

describe("iframe-html — in-place reload controller", () => {
  const html = makePreviewHtml({ js: "/* bundle */", sandboxBase: "/sandbox" });

  it("embeds the reload controller listening for `loom-reload`", () => {
    // The controller ignores everything but reload messages…
    expect(html).toContain('r.kind !== "reload"');
    // …and mounts the new bundle as a blob module (no document rewrite).
    expect(html).toContain("URL.createObjectURL");
    expect(html).toContain('s.type = "module"');
  });

  it("still ships the initial bundle as an inline module for first paint", () => {
    expect(html).toContain('<script type="module">/* bundle */</script>');
  });

  it("allows blob: module scripts in the CSP (the reload mechanism)", () => {
    const csp = /content="([^"]*default-src 'none'[^"]*)"/.exec(html)?.[1] ?? "";
    expect(csp).toMatch(/script-src[^;]*\bblob:/);
  });

  it("does not reset history on its own — only the first-load hostScript does", () => {
    // The start-route replaceState lives in the hostScript (runs once at
    // document parse); the reload controller must NOT touch history, so a
    // reload preserves the current route.  The only other replaceState is
    // the sign-in navigation's explicit `route` message.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    const reload = scripts.filter((s) => s.includes('r.kind !== "reload"'));
    expect(reload).toHaveLength(1);
    expect(reload[0]).not.toContain("replaceState");
    const others = scripts.filter(
      (s) => s.includes("history.replaceState") && !s.includes('r.kind === "route"'),
    );
    expect(others).toHaveLength(1);
  });
});
