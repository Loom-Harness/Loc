// The generated node Dockerfile only COPYs paths the project actually emits.
//
// `docker build` is the step every user runs (`docker compose up`), and no
// per-PR gate ran it for a `persistence: mikroorm` deployable: the MikroORM
// behavioural leg boots through `npm run dev` (tsx).  The Dockerfile was one
// constant for both adapters and ended with
//   COPY --from=build /app/db/migrations ./db/migrations
// — but MikroORM applies its schema with `orm.schema.updateSchema()` and emits
// no `db/migrations`, so every mikroorm image failed to build:
//   "/app/db/migrations": not found
// (docs/audits/2026-10-04-tested-vs-shipped.md, D-1).
//
// The invariant, for every node persistence adapter: each runtime-stage
// `COPY --from=build /app/<p>` names either a build OUTPUT (`dist`,
// `node_modules` — produced inside the image) or a path present in the
// emitted file map.  And the boot-time `migrate(...)` call and the migrations
// copy agree — one without the other crashes on boot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// The corpus `core-domain` fixture — the model D-1 was reproduced on with a real
// `docker build`.  Its deployable is `d`; the platform slot is a placeholder.
const CORE_DOMAIN = readFileSync(
  join(__dirname, "..", "..", "fixtures", "corpus", "core-domain.ddd"),
  "utf8",
);
const source = (persistence: string) =>
  CORE_DOMAIN.replace("platform: __PLATFORM__", `platform: node${persistence}`);

/** Produced inside the build stage, so absent from the emitted file map. */
const BUILD_OUTPUTS = new Set(["dist", "node_modules"]);

describe.each([
  ["drizzle", ""],
  ["mikroorm", " { persistence: mikroorm }"],
] as const)("node Dockerfile COPY sources exist — %s", (label, persistence) => {
  it("every runtime COPY --from=build path is emitted or built", async () => {
    const files = await generateSystemFiles(source(persistence));
    const dockerfile = files.get("d/Dockerfile");
    expect(dockerfile, "Dockerfile emitted").toBeDefined();
    const sources = [...(dockerfile ?? "").matchAll(/^COPY --from=build \/app\/(\S+)/gm)].map(
      (m) => m[1],
    );
    expect(sources.length, "vacuity: the runtime stage copies something").toBeGreaterThanOrEqual(3);
    const emitted = [...files.keys()].map((k) => k.replace(/^d\//, ""));
    for (const p of sources) {
      if (BUILD_OUTPUTS.has(p)) continue;
      const present = emitted.some((k) => k === p || k.startsWith(`${p}/`));
      expect(
        present,
        `${label}: Dockerfile copies /app/${p}, which the project does not emit`,
      ).toBe(true);
    }
  });

  it("the boot-time migrate() and the migrations COPY agree", async () => {
    const files = await generateSystemFiles(source(persistence));
    const copies = /COPY --from=build \/app\/db\/migrations/.test(files.get("d/Dockerfile") ?? "");
    const migrates = /await migrate\(db, \{ migrationsFolder: "\.\/db\/migrations" \}\)/.test(
      files.get("d/index.ts") ?? "",
    );
    expect(copies).toBe(migrates);
    expect(migrates).toBe(label === "drizzle");
  });
});
