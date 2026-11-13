// Fallback browser for the Playwright legs.  The e2e dir pins its own
// `@playwright/test`, whose Chromium revision may not be installed under
// PLAYWRIGHT_BROWSERS_PATH (a pre-provisioned sandbox store holds other
// revisions).  When — and only when — the pinned build is absent, the run
// launches an installed Chromium by `executablePath` instead.  Where the pinned
// build exists (CI) nothing changes.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const BINARIES = [
  ["chromium-", "chrome-linux64/chrome"],
  ["chromium_headless_shell-", "chrome-headless-shell-linux64/chrome-headless-shell"],
];

/** Highest revision first, so the newest installed build wins. */
function newestInstalled(root, exists, readdir) {
  let names = [];
  try {
    names = readdir(root);
  } catch {
    return undefined;
  }
  const found = [];
  for (const [prefix, bin] of BINARIES) {
    for (const n of names) {
      if (!n.startsWith(prefix)) continue;
      const rev = Number(n.slice(prefix.length));
      if (Number.isFinite(rev)) found.push({ rev, path: join(root, n, bin) });
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found.find((f) => exists(f.path))?.path;
}

/** The one place the env knob is read: canonical name, then the deprecated alias. */
export function chromiumOverride(env = process.env) {
  return env.LOOM_CHROMIUM_PATH || env.LOOM_PW_CHROMIUM || undefined;
}

/**
 * The `executablePath` to launch instead of the pinned browser, or `undefined`
 * when the pinned one is installed (or nothing usable is).
 * Preference: `LOOM_CHROMIUM_PATH` (deprecated alias `LOOM_PW_CHROMIUM`; the
 * canonical name wins when both are set), `<root>/chromium`, newest installed build.
 */
export function resolveChromiumFallback({
  pinned,
  env = process.env,
  root = env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers",
  exists = existsSync,
  readdir = readdirSync,
}) {
  if (pinned && exists(pinned)) return undefined;
  const override = chromiumOverride(env);
  if (override && exists(override)) return override;
  const stable = join(root, "chromium");
  if (exists(stable)) return stable;
  return newestInstalled(root, exists, readdir);
}

export const FALLBACK_CONFIG = "playwright.loom-fallback.config.ts";

/**
 * `playwright test` args for `e2eDir`: a wrapper config adding the fallback
 * `executablePath` over the emitted config, or `[]` when the pinned browser is
 * installed.
 */
export function playwrightFallbackArgs(e2eDir, env = process.env) {
  let pinned;
  try {
    pinned = createRequire(join(e2eDir, "package.json"))("@playwright/test").chromium.executablePath();
  } catch {
    return [];
  }
  const executablePath = resolveChromiumFallback({ pinned, env });
  if (!executablePath) return [];
  writeFileSync(
    join(e2eDir, FALLBACK_CONFIG),
    `import base from "./playwright.config";
export default {
  ...base,
  use: { ...base.use, launchOptions: { ...base.use?.launchOptions, executablePath: ${JSON.stringify(executablePath)} } },
};
`,
  );
  return ["--config", FALLBACK_CONFIG];
}

/**
 * Launch options for an in-harness `chromium.launch(...)`: `{ executablePath }`
 * when the pinned browser (`pinnedExecutablePath`, from the `chromium` import's
 * own `executablePath()`) is not installed and a fallback is, else `{}`.
 */
export function chromiumLaunchOptions(pinnedExecutablePath, env = process.env, deps = {}) {
  const executablePath = resolveChromiumFallback({ pinned: pinnedExecutablePath, env, ...deps });
  return executablePath ? { executablePath } : {};
}
