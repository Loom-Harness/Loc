// Auto-generated.  Do not edit by hand.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pinned so vitest never walks up out of this project looking for a config.
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["**/*.e2e.test.ts"],
  },
});
