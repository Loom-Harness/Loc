// Auto-generated.  Pins the test root to THIS project so
// vitest never walks up into an enclosing repo's config — without this file a
// generated tree dropped inside such a repo ran zero of its own tests and still
// exited 0.  No `include`: vitest's default globs decide what runs.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
});
