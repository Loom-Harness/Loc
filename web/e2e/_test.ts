// The playground specs' `test`: Playwright's, plus an opt-in timing fixture.
//
// With `LOOM_E2E_TIMING=<dir>` set, every test writes `<dir>/<testId>.json`:
// the app's `loom:<phase>` User Timing marks (`markPhase` / `clearPhase` in
// `src/util/diagnostics.ts`), the bundler's `[npm-engine]` install / bundle
// lines, and page loads, each stamped in epoch ms.  `scripts/e2e-timing.mjs`
// folds those files into the per-spec breakdown.  Unset, the fixture does
// nothing, so a normal run pays nothing for it.
//
// `pgliteSnapshot` (default on) seeds the PGlite snapshot the global setup
// made into each page's IndexedDB, so a Boot starts its storages from it
// instead of running initdb (`src/runtime/pglite-snapshot.ts`).  A spec that
// covers the cold path sets `test.use({ pgliteSnapshot: false })`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import { SNAPSHOT_DB, SNAPSHOT_STORE } from "../src/runtime/pglite-snapshot";
import { PGLITE_VERSION, pgliteSeedPath } from "./_pglite-seed";

export * from "@playwright/test";

export interface TimingEvent {
  /** epoch ms */
  t: number;
  kind: "mark" | "engine" | "load" | "goto";
  name: string;
  detail?: string;
}

const TIMING_DIR = process.env.LOOM_E2E_TIMING;

let seed: string | null | undefined;
function seedBase64(): string | null {
  if (seed === undefined) {
    const path = pgliteSeedPath();
    seed = existsSync(path) ? readFileSync(path).toString("base64") : null;
  }
  return seed;
}

export const test = base.extend<{ loomTiming: void; pgliteSnapshot: boolean; pgliteSeed: void }>({
  pgliteSnapshot: [true, { option: true }],
  pgliteSeed: [
    async ({ page, pgliteSnapshot }, use) => {
      const b64 = pgliteSnapshot ? seedBase64() : null;
      if (b64) {
        await page.exposeBinding("__loomPgliteSeed", () => b64);
        // Every navigation (a spec may wipe IndexedDB and reload): write the
        // snapshot unless this version's is already there.  The storage host
        // reads it at Boot, long after this settles.
        await page.addInitScript(
          ({ db, store, version }) => {
            if (window !== window.top) return;
            const req = indexedDB.open(db, 1);
            req.onupgradeneeded = () => {
              if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
            };
            req.onsuccess = () => {
              const conn = req.result;
              const get = conn.transaction(store, "readonly").objectStore(store).get(version);
              get.onsuccess = async () => {
                if (get.result instanceof Blob) return conn.close();
                const b64 = await (window as unknown as { __loomPgliteSeed: () => Promise<string> }).__loomPgliteSeed();
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const tx = conn.transaction(store, "readwrite");
                tx.objectStore(store).put(new Blob([bytes], { type: "application/gzip" }), version);
                tx.oncomplete = () => conn.close();
              };
            };
          },
          { db: SNAPSHOT_DB, store: SNAPSHOT_STORE, version: PGLITE_VERSION },
        );
      }
      await use();
    },
    { auto: true },
  ],
  loomTiming: [
    async ({ page }, use, testInfo) => {
      if (!TIMING_DIR) {
        await use();
        return;
      }
      const events: TimingEvent[] = [];
      const started = Date.now();
      await page.exposeBinding("__loomTiming", (_src, name: string, t: number, detail?: string) => {
        events.push({ t, kind: "mark", name, ...(detail ? { detail } : {}) });
      });
      await page.addInitScript(() => {
        const sink = (window as unknown as { __loomTiming?: (n: string, t: number, d?: string) => void })
          .__loomTiming;
        const mark = performance.mark.bind(performance);
        performance.mark = ((name: string, opts?: PerformanceMarkOptions) => {
          const m = mark(name, opts);
          if (name.startsWith("loom:")) {
            const d = opts?.detail;
            void (window as unknown as { __loomTiming?: typeof sink }).__loomTiming?.(
              name.slice(5),
              Date.now(),
              typeof d === "string" ? d : undefined,
            );
          }
          return m;
        }) as typeof performance.mark;
      });
      page.on("console", (msg) => {
        const text = msg.text();
        if (text.startsWith("[npm-engine]")) events.push({ t: Date.now(), kind: "engine", name: text });
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) events.push({ t: Date.now(), kind: "goto", name: frame.url() });
      });
      page.on("load", () => events.push({ t: Date.now(), kind: "load", name: page.url() }));
      await use();
      mkdirSync(TIMING_DIR, { recursive: true });
      writeFileSync(
        join(TIMING_DIR, `${testInfo.testId}-${testInfo.retry}.json`),
        JSON.stringify(
          {
            file: testInfo.file.replace(/^.*\/e2e\//, ""),
            title: testInfo.titlePath.slice(1).join(" › "),
            project: testInfo.project.name,
            status: testInfo.status,
            retry: testInfo.retry,
            started,
            ended: Date.now(),
            events,
          },
          null,
          1,
        ),
      );
    },
    { auto: true },
  ],
});
