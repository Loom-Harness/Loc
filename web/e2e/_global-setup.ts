// Make the PGlite snapshot the e2e fixture seeds into every page (`_test.ts`):
// a freshly initialised cluster at the runtime's PGlite version, dumped once
// per run (and kept across local runs) instead of once per Boot.  The storage
// host would make the same dump on its first cold boot — see
// `src/runtime/pglite-snapshot.ts`.
//
// Best effort: with no network, or any failure, no seed file is written and
// every Boot runs initdb as it would without this.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { pgliteModuleUrl } from "../src/bundle/plugin";
import { pgliteSeedPath } from "./_pglite-seed";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const out = pgliteSeedPath();
  if (existsSync(out)) return;
  const launchOptions = config.projects[0]?.use.launchOptions;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ ...launchOptions, headless: true });
    const page = await browser.newPage();
    const b64 = await page.evaluate(async (url) => {
      const { PGlite } = (await import(/* @vite-ignore */ url)) as {
        PGlite: { create(): Promise<{ dumpDataDir(c: "gzip"): Promise<Blob>; close(): Promise<void> }> };
      };
      const pg = await PGlite.create();
      const blob = await pg.dumpDataDir("gzip");
      await pg.close();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, pgliteModuleUrl("index.js"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(b64, "base64"));
  } catch (err) {
    console.warn(`[e2e] no PGlite snapshot seed — every Boot runs initdb: ${String(err).slice(0, 200)}`);
  } finally {
    await browser?.close();
  }
}
