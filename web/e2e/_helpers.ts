import { type Locator, type Page, expect } from "@playwright/test";

// Probe the npm registry from the page context so the test can decide
// whether to exercise the network-dependent bundle/boot stages.  The
// playground installs real npm tarballs in-browser, so the registry
// is the first external dependency; some CI / sandbox environments
// allow Node-side network but block browser-context cross-origin
// fetches, in which case we skip the network steps cleanly instead of
// failing the run.  A real CORS GET against a tiny known-good URL
// (registry.npmjs.org sets `access-control-allow-origin: *`), with an
// AbortController cap so the probe can't hang the whole test.
export async function browserCanReachNetwork(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch("https://registry.npmjs.org/react/latest", {
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  });
}

// The generated Explorer tree is a react-arborist virtualized list, so a row
// far down (or a deep file) isn't in the DOM until scrolled into view.  Wheel
// the scrollable descendant until the first row matching `name` mounts, then
// return it.  Shared by every spec that opens a generated file.
export async function revealTreeRow(
  page: Page,
  tree: Locator,
  name: string | RegExp,
): Promise<Locator> {
  const row = tree.getByText(name).first();
  for (let i = 0; i < 120 && (await row.count()) === 0; i++) {
    await tree.evaluate((el) => {
      const scroller = [el, ...el.querySelectorAll<HTMLElement>("*")].find(
        (n): n is HTMLElement => n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 4,
      );
      scroller?.scrollBy(0, 300);
    });
    await page.waitForTimeout(50);
  }
  await expect(row).toBeVisible();
  return row;
}

// Wait for the playground to have rendered + the LSP worker to
// have parsed the starter source (visible as the "0 errors" badge).
export async function waitForPlaygroundReady(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: /Loom Playground/i })).toBeVisible();
  await expect(page.getByText(/^0 errors$/)).toBeVisible({ timeout: 30_000 });
  await dismissFirstRun(page);
}

/** Close the first-run card (M-T8.18) if it is showing — a fresh browser
 *  profile shows it over the editor on the never-edited default workspace,
 *  and the *Write .ddd* door is the dismissal that keeps the editor focused.
 *  The choice persists (`loom.firstRun.dismissed`), so a spec that creates a
 *  second workspace does not see it again.  Specs that assert on the card
 *  itself (`problems-and-help.spec.ts`) drive it before calling this. */
export async function dismissFirstRun(page: Page): Promise<void> {
  const door = page.getByTestId("first-run-write");
  if (await door.isVisible().catch(() => false)) {
    await door.click();
    await expect(page.getByTestId("first-run-card")).toBeHidden();
  }
}

/** Wait until an editor has published the `__loomSetSource`/`__loomGetSource`
 *  automation seam, then return the live source.
 *
 *  Both editors publish it — Monaco on desktop, `PlainEditor` on mobile — but
 *  neither publishes it synchronously any more: Monaco now arrives through
 *  `await import(...)` so it never ships to a phone (M-T8.15), which means a
 *  spec that reads the hook the instant the page settles can beat it.  Waiting
 *  for the seam is what the specs were implicitly relying on before; now it is
 *  explicit. */
export async function readEditorSource(page: Page): Promise<string> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __loomGetSource?: unknown }).__loomGetSource === "function",
    null,
    { timeout: 45_000 },
  );
  return page.evaluate(
    () => (window as unknown as { __loomGetSource: () => string }).__loomGetSource(),
  );
}

/** Prepend a marker line to the active source through the `__loomSetSource`
 *  automation seam — the house pattern (`builder-page`, `builder-scaffold`,
 *  `destructive-actions`, `loom-views`, `migrations-panel` all edit this way).
 *  `setValue` dispatches Monaco's change event, so this takes exactly the same
 *  onChange → workspace-write path a keystroke does.
 *
 *  It replaces `click()` + `keyboard.type(...)`, which additionally required
 *  the editor to HOLD DOM FOCUS for the whole burst — a requirement the specs
 *  never asserted and CI does not grant.  Measured in the trace of the
 *  2026-09-09 `playground-e2e-no-network` failure (run 34415602347): clicking
 *  the editor took 2.7 s to become actionable and the 38-character marker then
 *  took 3.6 s to type. Anything that moved focus inside that window truncated
 *  the marker at a random character — the model kept the prefix, the trailing
 *  newline never landed, and the spec failed later on the RELOAD, reporting a
 *  persistence loss that had not happened. Both specs that still typed raw
 *  keystrokes (`workspace-persistence`, `multi-tab`) failed in that run; none
 *  of the five using this seam did.
 *
 *  Asserting the edit reached the model is part of the contract: a failure
 *  then names the EDIT, at the line that made it, instead of surfacing as a
 *  restore failure ten seconds and one navigation later. */
export async function prependMarker(page: Page, marker: string): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __loomSetSource?: unknown }).__loomSetSource === "function" &&
      typeof (window as unknown as { __loomGetSource?: unknown }).__loomGetSource === "function",
    null,
    { timeout: 45_000 },
  );
  await page.evaluate((m) => {
    const w = window as unknown as {
      __loomSetSource: (t: string) => void;
      __loomGetSource: () => string;
    };
    w.__loomSetSource(`${m}\n${w.__loomGetSource()}`);
  }, marker);
  expect(await readEditorSource(page), "the marker never reached the editor model").toContain(
    marker,
  );
}

/** Click into whichever source editor this viewport actually rendered.
 *  Desktop gets Monaco; mobile gets the plain textarea. */
export async function focusSourceEditor(page: Page): Promise<void> {
  const monaco = page.locator(".monaco-editor").first();
  const plain = page.locator('[data-testid="plain-editor"] textarea');
  await expect(monaco.or(plain).first()).toBeVisible({ timeout: 45_000 });
  if ((await plain.count()) > 0) {
    await plain.click();
  } else {
    await monaco.click();
  }
}

// Console / page-error messages that are known, non-fatal noise — they
// signal neither a broken generated bundle nor a broken editor.  ONE
// allow-list shared by every console-asserting e2e spec.  These filters
// were copy-pasted inline across the specs and DRIFTED: `editor.spec`
// learned to suppress the @codingame/monaco-vscode-api init rejections
// while the six preview-runtime gates never did, so every nightly
// Playground-e2e run went red on host noise the editor smoke already
// treated as expected.  Centralising kills that drift class.
//
// Two families:
//   1. Host playground noise that fires regardless of the preview iframe:
//      - @codingame/monaco-vscode-api lightweight EditorService-mode init
//        rejections.  The playground runs the api without a views service
//        (loom-services.ts); registering the `ddd` grammar extension makes
//        monaco's contribution processing touch the views registry, so it
//        logs `getViewContainersByLocation is not supported` and a service
//        whose `.startup` is missing.  Editor + LSP work regardless; a
//        views-service-override to silence them at the source was tried and
//        *breaks* the editor, so they're the intended lightweight-mode
//        trade-off.  Each surfaces twice — a console "Unhandled promise
//        rejection:" and a window "pageerror:".
//      - esbuild-wasm's direct-eval advisory (PGlite loader), Chrome's
//        passive-listener advisory, vite HMR dynamic-import failures.
//   2. Transient registry / CDN failures while the in-browser bundler
//      fetches deps under load (npm 50x, CORP) — not a bundle defect.
//
// Anchored (with an optional "console: " capture prefix that some specs
// prepend) so a real error that merely *contains* the noise text mid-stack
// can't hide behind an entry.
export const KNOWN_CONSOLE_NOISE: RegExp[] = [
  /Fetch failed \(50[34]\)/,
  /Cross-Origin-Resource-Policy/i,
  /Using direct eval/i,
  /passive event listener/i,
  /Failed to fetch dynamically imported module/i,
  /^(?:console: )?Unhandled promise rejection: TypeError: .*\bstartup is not a function\b/,
  /^pageerror: .*\bstartup is not a function\b/,
  /^(?:console: )?Unhandled promise rejection: Error: Unsupported: .*getViewContainersByLocation is not supported/,
  /^pageerror: Unsupported: .*getViewContainersByLocation is not supported/,
];

// Drop the known-noise entries from a captured console/page-error list,
// returning only messages that signal a genuinely broken bundle or editor.
export function fatalConsoleErrors(messages: string[]): string[] {
  return messages.filter((m) => !KNOWN_CONSOLE_NOISE.some((re) => re.test(m)));
}

// On a preview-render failure, dump what the in-browser bundle actually
// produced.  The nightly job log otherwise shows only the bare
// `getByText(...).toBeVisible` timeout — never WHY the generated app didn't
// mount.  Surfaces two things the trace artifact would otherwise be the only
// source of:
//   1. the RAW captured console/page errors (UNfiltered — the real iframe
//      React crash hides among the host noise `fatalConsoleErrors`
//      allow-lists, so we print everything here);
//   2. the preview iframe's own `<body>` HTML — an error-boundary message or
//      an empty root tells us mount-vs-blank at a glance.
// Best-effort: never throws (callers rethrow the original assertion error).
export async function dumpPreviewDiagnostics(
  page: Page,
  captured: string[],
  label: string,
): Promise<void> {
  console.log(
    `[${label}] preview iframe did not render — ${captured.length} captured console/page error(s):`,
  );
  for (const m of captured) console.log(`  ${m.slice(0, 400)}`);
  const body = page.frameLocator('[data-testid="preview-iframe"]').locator("body");
  // Visible innerText is the decisive signal: it tells us whether the app
  // actually rendered content (and, if the target nav/landing text is present
  // at all, whether it's merely off-screen / in a collapsed drawer vs absent).
  try {
    const text = await body.innerText({ timeout: 5_000 });
    console.log(`[${label}] preview iframe innerText (first 1500 chars):\n${text.slice(0, 1500)}`);
  } catch (e) {
    console.log(`[${label}] could not read preview iframe innerText: ${(e as Error).message}`);
  }
  // Does the gate's target text exist in the DOM at all, and is any match
  // visible?  Distinguishes "not rendered" from "rendered but not visible".
  try {
    const target = page
      .frameLocator('[data-testid="preview-iframe"]')
      .getByText(/Welcome/i);
    const total = await target.count();
    let visible = 0;
    for (let i = 0; i < total; i++) {
      if (await target.nth(i).isVisible().catch(() => false)) visible++;
    }
    console.log(`[${label}] target-text matches: ${total} in DOM, ${visible} visible`);
  } catch (e) {
    console.log(`[${label}] could not probe target text: ${(e as Error).message}`);
  }
  try {
    const html = await body.innerHTML({ timeout: 5_000 });
    console.log(`[${label}] preview iframe <body> (first 2000 chars):\n${html.slice(0, 2000)}`);
  } catch (e) {
    console.log(`[${label}] could not read preview iframe <body>: ${(e as Error).message}`);
  }
}

// Open a specific example.  Examples are now starting points for
// workspaces (not a destructive "replace active" dropdown), so this
// creates a NEW workspace seeded from `label` via the WorkspaceSwitcher
// "+" popover: open it, choose the example, Create.  Tests that rely on
// a particular starter source call this after `waitForPlaygroundReady`.
//
// We target `role="textbox"` with the accessible name (not `getByLabel`)
// because Mantine threads the same `aria-label` onto both the `<input>`
// AND the listbox container; `getByRole("textbox")` limits to the input.
export async function selectExample(page: Page, label: string | RegExp): Promise<void> {
  await page.getByTestId("workspace-new").click();
  await page.getByRole("textbox", { name: "Choose example" }).click();
  await page.getByRole("option", { name: label }).first().click();
  await clickWorkspaceCreate(page);
  // Re-wait for the LSP "0 errors" badge — the new workspace remounts
  // the editor and re-parses the source, so the badge momentarily
  // flickers to "—" before the new source validates.
  await expect(page.getByText(/^0 errors$/)).toBeVisible({ timeout: 30_000 });
}

// Click the "Create workspace" button in the new-workspace popover, robustly.
//
// Call this AFTER the example option has been chosen.  The create popover is
// held open across the option pick by `closeOnClickOutside={false}` on the
// Mantine Popover (see WorkspaceSwitcher.tsx) — that's what stops it
// auto-dismissing when the portal'd example option is clicked.  This retry is
// the belt-and-braces for any remaining transient (a click landing mid
// re-render): re-find the button each attempt and stop once the popover
// closes (`workspace-create` is absent once the workspace is created).
export async function clickWorkspaceCreate(page: Page): Promise<void> {
  const create = page.getByTestId("workspace-create");
  await expect(async () => {
    await create.click({ timeout: 5_000 });
    await expect(create).toBeHidden({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

// Wait for the in-browser Hono bundle to settle, racing the success banner
// against the footer's error state.
//
// Why not just `expect(successBanner).toBeVisible({ timeout: 600_000 })`:
// the bundler worker already caps a single run at 180s (RUN_TIMEOUT_MS in
// vfs-bundler-client.ts) and, on any failure — an esbuild error, a dep that
// won't resolve, or a network stall that trips that cap — settles the result
// to `{ ok: false }`.  The footer then reads `bundle: N error(s)` and the
// Files pane shows the worker's message.  A success-only wait ignores that
// settled failure and burns the whole 600s before reporting a useless
// "locator not found", hiding *why* the bundle broke.  Racing the two states
// fails fast with the real message while keeping the generous ceiling for a
// legitimately-slow cold npm install on the happy path.
export async function waitForBundle(page: Page, timeout = 600_000): Promise<void> {
  const ok = page.getByText(/bundled [\d.]+ [KM]?B in \d+ ms \(\d+ deps fetched\)/);
  const failed = page.getByText(/bundle: \d+ error\(s\)/);

  // FIRST: did the bundle even start?  A click that is a complete no-op —
  // no bundling state, no result, no network — is indistinguishable from a
  // slow bundle to the wait below, so it used to burn the whole 600s ceiling
  // and then report "element(s) not found", which names neither the step nor
  // the cause.  That is exactly how the `lastBundleReadyRef` race presented
  // when it turned `main` red (see `bundle-starts.spec.ts`), and it cost far
  // more to diagnose than it should have.  A settled result also satisfies
  // this — a bundle fast enough to finish before we look is not a failure.
  const bundling = page.locator('[data-testid="btn-bundle"][data-loading="true"]');
  try {
    await expect(bundling.or(ok).or(failed).first()).toBeVisible({ timeout: 30_000 });
  } catch {
    throw new Error(
      "Bundle never started: 30s after clicking Bundle the pipeline is still " +
        "idle — no bundling state, no result, no diagnostic.  That is a no-op " +
        "click (the button was enabled while the action's input was missing), " +
        "not a slow bundle.  See web/e2e/bundle-starts.spec.ts.",
    );
  }

  await expect(ok.or(failed).first()).toBeVisible({ timeout });
  if (await failed.isVisible()) {
    // Surface the worker's actual diagnostic (the auto-rendered bundle-error
    // drawer in the Files pane) so the failure is actionable, not just a count.
    const drawer = page.getByTestId("bundle-errors");
    const detail = (await drawer.count()) ? await drawer.innerText().catch(() => "") : "";
    throw new Error(`In-browser bundle failed (${await failed.innerText()}).\n${detail}`.trim());
  }
}

// Workspace-switch helpers (`workspace-switch-lsp`, `examples-sweep`): open an example in a NEW workspace,
// then prove the language server's verdict on it is clean and Generate works.

/** Open `label` in a new workspace (+ → Choose example → Create).  `label` is
 *  matched exactly — several example labels share a prefix ("Acme"). */
export async function openExampleWorkspace(page: Page, label: string): Promise<void> {
  await page.getByTestId("workspace-new").click();
  await page.getByRole("textbox", { name: "Choose example" }).click();
  await page.getByRole("option", { name: label, exact: true }).first().click();
  await clickWorkspaceCreate(page);
}

/** Show the Problems stream in the Output dock. */
export async function openProblems(page: Page): Promise<void> {
  await page.getByTestId("devtools-tab-output").click();
  const select = page.getByTestId("output-stream-select");
  if ((await select.inputValue().catch(() => "")) !== "Problems") {
    await select.click();
    await page.getByRole("option", { name: "Problems" }).click();
  }
}

/** Generate the open workspace and require it to succeed. */
export async function generateOk(page: Page, label: string): Promise<void> {
  const generate = page.getByTestId("btn-generate");
  // Opening a workspace schedules an auto-generate; the button is disabled
  // while it runs, so let it settle before judging whether Generate is
  // actionable.
  await expect(generate).not.toHaveAttribute("data-state", "running", { timeout: 120_000 });
  await expect(generate, `Generate is not actionable for "${label}"`).toBeEnabled({
    timeout: 60_000,
  });
  await generate.click();
  await expect(generate, `Generate did not succeed for "${label}"`).toHaveAttribute(
    "data-state",
    "ok",
    { timeout: 120_000 },
  );
  await expect(page.getByTestId("pipeline-count-generate")).toHaveText(/^\d+ files?$/);
  await expect(page.getByText(/Generation failed/)).toHaveCount(0);
}

/** The language server's verdict on the open workspace is clean: `0 errors`
 *  on the Validate segment and nothing in Problems.
 *
 *  The count reads `0 errors` the instant a workspace opens — the diagnostics
 *  slot is reset before the server has looked at the new documents — so one
 *  sample proves nothing.  Callers run this after Generate, which takes
 *  longer than the server's validation pass, and the verdict must then HOLD
 *  over a window: a leaked declaration shows up as errors once validation
 *  lands and stays. */
export async function expectCleanValidation(page: Page, label: string): Promise<void> {
  const count = page.getByTestId("pipeline-count-validate");
  const empty = page.getByTestId("problems-empty");
  for (let i = 0; i < 6; i++) {
    await expect(count, `"${label}" should validate clean in the playground`).toHaveText(
      "0 errors",
    );
    await expect(empty, `Problems should be empty for "${label}"`).toBeVisible();
    await page.waitForTimeout(500);
  }
}

/** Record the open workspace's initial migration, the way a user does before
 *  the first Boot: the runtime creates its database only from recorded
 *  migrations, and a fresh workspace — every built-in example — has none, so
 *  Boot otherwise stops at "migration required".  Opens the Migrations tab
 *  (desktop dock, or the mobile More sheet), records `initial`, and waits for
 *  the generate the recording kicks to settle, because that generate clears
 *  any bundle a caller made before it.  Call it before Generate / Bundle. */
export async function recordInitialMigration(page: Page): Promise<void> {
  const desktopTab = page.getByTestId("devtools-tab-migrations");
  if (await desktopTab.isVisible()) {
    await desktopTab.click();
  } else {
    await page.getByTestId("mobile-tab-more").click();
    await page.getByTestId("mobile-tab-migrations").click();
  }
  const name = page.getByTestId("migration-record-name");
  await expect(name, "the Migrations tab offers to record the initial migration").toBeVisible({
    timeout: 60_000,
  });
  await name.fill("initial");
  const record = page.getByTestId("migration-record");
  await expect(record).toBeEnabled();
  await record.click();
  await expect(page.getByTestId("migration-record-result")).toContainText(
    /Recorded \d+ migration file/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("migration-chain-status")).toContainText("nothing unrecorded", {
    timeout: 30_000,
  });
  const generate = page.getByTestId("btn-generate");
  if (await generate.isVisible()) {
    await expect(generate).toHaveAttribute("data-state", "ok", { timeout: 120_000 });
  }
}

/** How each storage's PGlite came up in this page so far — the notes on the
 *  `loom:boot:pglite-construct` marks, e.g. `"primary: snapshot"` or
 *  `"primary: initdb"` (see `src/runtime/storage-host.worker.ts`). */
export async function pgliteStarts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByName("loom:boot:pglite-construct")
      .map((m) => String((m as PerformanceMark).detail ?? "")),
  );
}
