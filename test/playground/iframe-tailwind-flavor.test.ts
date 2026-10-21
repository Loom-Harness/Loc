import { describe, expect, it } from "vitest";

import { makePreviewHtml } from "../../web/src/preview/iframe-html.js";

// The playground bundles in-browser (esbuild-wasm), so Tailwind-
// authored CSS is compiled at iframe load time by an in-browser
// JIT, not at build time.  shadcn's `@import "tailwindcss";` (+ `@theme`
// inline) CSS goes through `@tailwindcss/browser` (no JS config object);
// Mantine ships pre-compiled CSS → plain `<style>`, no JIT script.
// Without the Tailwind branch the shadcn default would ship unstyled
// previews.

const TAILWIND_CSS = `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root { --radius: 0.5rem; }

@theme inline {
  --color-primary: hsl(var(--primary));
}`;

const MANTINE_CSS = `.m_abc { color: red; }`;

describe("iframe-html — Tailwind path (shadcn@v4)", () => {
  const html = makePreviewHtml({ js: "/* b */", css: TAILWIND_CSS });

  it("loads @tailwindcss/browser (the in-browser compiler)", () => {
    expect(html).toContain("@tailwindcss/browser@4");
  });

  it("inlines no JS `tailwind.config` object", () => {
    expect(html).not.toMatch(/tailwind\.config\s*=/);
  });

  it('keeps `@import "tailwindcss"` for the browser runtime to resolve', () => {
    expect(html).toContain('@import "tailwindcss"');
  });

  it('strips the unresolvable `@import "tw-animate-css"`', () => {
    // `@tailwindcss/browser` can't fetch the bare third-party
    // specifier — leaving it in errors the whole compile.
    expect(html).not.toContain("tw-animate-css");
  });

  it("routes the CSS through the JIT style block", () => {
    expect(html).toContain('<style id="loom-css" type="text/tailwindcss">');
  });
});

describe("iframe-html — non-Tailwind CSS (Mantine)", () => {
  const html = makePreviewHtml({ js: "/* b */", css: MANTINE_CSS });

  it("uses a plain <style> tag and no JIT script", () => {
    expect(html).toContain('<style id="loom-css">');
    expect(html).not.toContain('type="text/tailwindcss"');
    expect(html).not.toContain("@tailwindcss/browser");
  });
});
