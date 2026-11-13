# @loom/ui-test-driver

A framework-neutral, **in-browser** UI test driver that implements a closed subset of the
Playwright `Page` / `Locator` API.

The point: the **same** Playwright-style page-object spec can run both under real Playwright
in CI **and** entirely in the browser — no Node, no WebDriver/CDP, no browser-automation
engine — against an app mounted in an iframe.

## How it works

- **Parent side** (`RemotePage` / `RemoteLocator`) holds no DOM. A locator just accumulates a
  serialisable `ChainNode[]`; each leaf op (`click`, `fill`, …) is sent as a `DriverOp` over a
  `DriverTransport` and awaits the reply.
- **Sandbox side** (`executeDriverOp` + `DomPage` / `DomLocator`) rebuilds the locator from the
  chain, resolves it against the live document with Playwright-like actionability/auto-wait, and
  acts.
- **Transport** is pluggable. `makeIframeTransport` runs ops directly against a same-origin
  iframe's document; `makePostMessageTransport` (parent side) paired with `serveDriverOps`
  (sandbox side) drives a cross-origin sandbox over `postMessage` without changing the
  `RemotePage` contract.
- **No host coupling.** Environment specifics (router basename, in-flight network state for
  network-idle waits) are passed in as accessor functions via options — the package names no
  application globals.

## Supported Playwright API (subset)

The table lists the closed subset that drives generated page objects (see `remote-page.ts` and `locator-assertions.ts` for the exact surface). It is **not** full Playwright.

| Surface | Supported |
|---|---|
| `Page` | `goto`, `url`, `locator`, `getByTestId`, `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `waitForURL`, `waitForLoadState`, `screenshot` |
| `Locator` | the same `getBy*` selectors and `locator`, plus `filter`, `first`, `last`, `nth`, `click`, `dblclick`, `hover`, `press`, `fill`, `clear`, `focus`, `blur`, `check`, `uncheck`, `selectOption`, `innerText`, `inputValue`, `count`, `isVisible`, `isEnabled`, `isChecked`, `waitFor({ state })` |
| Web-first assertions | `expect(locator)` via `createLocatorMatchers`: `toBeVisible`, `toBeHidden`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveCount`, `toBeEnabled`, `toBeDisabled`, `toBeChecked`, each with `.not` |

Notable semantics modelled: strict single-match resolution (throws on multiple matches —
use `.first()`), actionability gates (`visible` / `enabled` / `editable`), React-aware `fill`
(native value setter + `input`/`change` events), and poll-loop auto-wait (no layout engine
required, so it runs under happy-dom). Hit-testing / stability checks that need a real layout
engine are intentionally not modelled.

Anything outside the table is outside the closed subset.

## Status

`0.0.0-experimental`, currently consumed in-repo by the Loom playground. Extracted as a
self-contained package as the first step toward a standalone, permissively-licensed release.
