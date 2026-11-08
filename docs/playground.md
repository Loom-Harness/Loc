# Playground

The playground is Loom running entirely in your browser: type a `.ddd`
source, watch the multi-project tree regenerate, then bundle and boot the
generated Hono backend on an in-process Postgres and click through the
generated React app — no server, no install, no Docker. It is live at
<https://loom-harness.github.io/Loc/playground/> (landing page at
<https://loom-harness.github.io/Loc/>) and lives in the `web/` workspace.

The headline point: it runs **the exact same toolchain the `ddd` CLI
runs**. There is no second, browser-flavoured compiler — `web/` imports
the parser, IR lowering, validators, and generators straight from
`../src`. What you see generated in the browser is byte-for-byte what
`ddd generate system` produces on disk.

## How it imports the toolchain

`web/` is a separate Vite + React package, but it has no copy of the
compiler. It imports `../src` directly because the Loom toolchain is pure
TypeScript with no Node-only APIs — the only Node-bound seams are
`src/cli/` and `src/language/main.ts` (plus `src/mcp/`), none of which the
playground imports. Vite's bundler handles the `.js`-extension import
specifiers used throughout `src/`.

One module needs a swap. The React generator's design-pack loader has a
Node variant (`src/generator/_packs/loader-fs.ts`) that reads `.hbs`
templates off disk via `node:fs`. A small Vite plugin
(`loomLoaderShim` in `web/vite.config.ts`) resolves any import ending in
`/_packs/loader-fs.js` to `web/src/build/loader-vfs.ts` instead — a
VFS-backed loader that reads the pack templates from an in-memory virtual
filesystem seeded at worker boot. The shim is registered both for the
main app build and for the worker build (the build worker transitively
pulls the generator in), so neither tries to bundle `node:fs`.

Heavy work runs in Web Workers, not on the UI thread:

- an **LSP worker** (`src/lsp/`) — the real Langium language server, the
  same one the VS Code extension speaks, over `monaco-languageclient`;
- a **build worker** — runs the generator over a workspace VFS and returns
  the generated file tree;
- a **runtime worker per Node deployable** (`src/runtime/runtime.worker.ts`)
  — imports that deployable's bundle and serves its requests;
- an **infra worker** (`src/runtime/infra.worker.ts`) — the shared
  infrastructure `docker-compose.yml` runs beside the services: one PGlite
  per `storage`, each in a nested storage host worker, and the services
  registered in `src/runtime/infra/services.ts`. A deployable reaches a
  storage through `PGliteWorker` and every other service through its
  `InfraPort`, a `MessagePort` the engine hands it at boot (routing:
  `src/runtime/infra/router.ts`; a service implements
  `src/runtime/infra/service.ts` and adds its ops to `InfraServiceOps` in
  `src/runtime/infra-protocol.ts`).

## The four capabilities

The landing page advertises "typed editor + visual system builder + live
preview + in-browser test runner." All four exist in the code; here is
what each actually is.

### Typed editor

A Monaco editor wired to the Langium LSP worker over `monaco-languageclient`
+ `@codingame/monaco-vscode-api` — so diagnostics, completion, hover, and
go-to-definition are the real language server, not a regex highlighter.
The workspace is multi-file: you can add companion `.ddd` files and
`import "./shared/x.ddd"` resolves because every workspace source is pushed
into the LSP worker as a Monaco model. Sources persist to IndexedDB and are
versioned in an isomorphic-git-backed workspace (auto-commit on save). A
single-file source can also be shared by URL (the `s=` / `p=` hash
payload).

### Visual system builder

There are three graphical editors (the "Code" tab's sub-views),
all backed by craft.js / React Flow, that edit the **same `.ddd` source**
round-trip — they parse the current source, let you manipulate it visually,
then splice the result back in (preserving everything else) and push it
through the live Monaco model so the source tab and Problems panel update
immediately:

- a **page builder** (`src/builder/page/`) — drag/drop the page-body
  primitives (`List`/`Detail`/`Form`/`Stack`/…) onto a craft.js canvas;
- a **model builder** (`src/builder/system-v2/`, over the shared edit
  library in `src/builder/system/`) — a React-Flow **drill-down navigator**
  where the canvas *is* the breadcrumb: each level shows the children of the
  current construct (system → module → context → aggregate → operation →
  statement flow), and every node carries its own rename / delete / clause
  edits. At the root it also offers **Overview** — the whole model as one
  flat, *read-only* graph, with the coverage heatmap, cross-model search +
  kind filter, module/context nesting and the wire-shape (DTO) inspector;
  opening a construct there jumps the navigator to it, ancestors and all.
  (Until M-T8.13 this shipped as *two* panes — a flat "Model" editor and a
  "Model v2" drill-down. They are one pane now: one mutation surface, with
  the flat canvas surviving as the read-only Overview mode.)
- a **requirements** pane (`src/builder/requirements/`).

These are genuine source-editing surfaces, not read-only diagrams. On
mobile they render as the plain source editor until explicitly opened
(they are heavy to mount).

### Live preview

When the generated tree contains Hono backends and a React frontend, the
engine bundles each of them (an in-browser npm install + esbuild-wasm
bundle, `src/engine/`), boots every backend in its own runtime worker, and
the React app renders in a sandboxed iframe. Iframe `fetch()` calls to `http://localhost:*` are
intercepted by an in-iframe shim and routed via `postMessage` to the
parent, which dispatches them through the runtime worker of the backend the
frontend `targets:` — so the
generated React → Hono → Postgres round-trip runs end-to-end under one
origin. In live mode the preview refreshes in place as you type (debounced
~5 s).

The runtime is **Hono + React only**. A system that declares only .NET,
Phoenix LiveView, Java, or Python deployables — or a Vue/Svelte frontend —
generates fully and is browsable in the Files pane, but the preview names
those as "run outside the playground" rather than booting them. The
playground surfaces this explicitly instead of failing silently.

### The backend's start-up sequence in the preview

The runtime worker boots the generated backend through its own start-up
sequence — `bootApp` in the deployable's `boot.ts`, the same function the
generated `index.ts` runs before `serve()` — so seeds, the user verifier, the
tenant-registry `orgPath` resolver, the channel consumers, the outbox relay
and the timers all run in the preview as they do deployed. The worker passes
the browser's answers, each announced at warn level in the runtime log:

| Option | Preview behaviour | Why |
|---|---|---|
| `verifier: "dev-stub"` | the dev stub, even under `auth { oidc }` | no identity provider is reachable from the worker |
| `infra: "in-process"` — channels | every `channelSource` binding on one in-memory transport (`channel_transport_in_process`): broadcast fan-out and round-robin consumer groups, asynchronous delivery | no broker; retention, replay and dead-lettering are not emulated |
| `infra: "in-process"` — `cron:` timers | an in-process loop at each cron boundary (`timer_cron_in_process`) instead of pg-boss | pg-boss opens its own Postgres connection, which PGlite cannot give it; no durability, retry or cross-replica single-fire |
| `infra: "in-process"` — `every:` timers | fire without the advisory-lock transaction | one process, and PGlite's single connection would deadlock the tick's writes behind the lock |

The broker and job-queue client packages (`ioredis`, `kafkajs`, `amqplib`,
`pg-boss`) are swapped at bundle time for stubs whose constructors throw
(`BROWSER_STUBBED_PACKAGES` in `src/engine/npm/esbuild-vfs-plugin.ts`): their
module bodies cannot evaluate in a worker, and the in-process boot never
constructs them. `bootApp`'s `channelTransport` option is the seam an emulated
broker plugs into. **Reset** stops what boot started before it closes PGlite.

### In-browser test runner

The Postgres is **PGlite** — a WebAssembly Postgres — one database per
`storage` the system's Node deployables bind, not one per deployable. Each
runs in a storage host worker under the infra worker
(`src/runtime/storage-host.worker.ts`), and every deployable bound to the
storage connects to it through PGlite's `PGliteWorker` client, so two backends
on one `storage` read and write the same rows (the Shared storage example).
Each storage holds the union of the schemas of the modules its deployables
host. A request through the extra hop costs about 6 ms per SQL statement. The
Runtime tab's request composer picks which backend a request goes to when the
system has several. Its schema comes only from
the workspace's **recorded migration chain** (`migrations/*.json`, below), the
way a deployed backend's does. On every Boot the build worker renders the
chain to the migration files the generated Hono backend carries in
`db/migrations/` (`migrationPlan` in `src/build/evolution.ts`, over the same
`migrationUnits` renderer `ddd generate system` uses), and the runtime applies
the units after the last one the database applied, which
`__loom.schema_meta` records as `chain_head` (`src/runtime/migrate.ts`). A
transactional unit commits with its head update, so a failed unit leaves the
database at the one before it. Each database is an OPFS island keyed by the
workspace, its entry and — when the system has several — its storage (in
memory on mobile), so it survives reloads and
schema edits; a recorded change migrates it in place and keeps the rows.

Boot never writes to the database while the model has **unrecorded** schema
changes: it stops with *migration required* (`backend-status`), names the
modules and steps, and leaves the database as it is. That includes a workspace
with no chain, every built-in example among them — no migration is implied, so
the database is created only once the initial migration is recorded. A database the chain cannot describe — one at a unit the chain
no longer has, or one an earlier playground built without migration tracking
(a `ddl_hash` row) — is reported, not dropped. The only actions that drop the
user schemas are the explicit ones: **Reset database** (Database sub-view —
drops every row of every storage and rebuilds each schema from its recorded
units) and **Reset
database & boot** / **Clear stored data & retry** (drop the island's stored
data, then boot). A source with no `system` block cannot record migrations;
its schema is synthesised from the bundled Drizzle tables (`src/runtime/ddl.ts`,
`synthDDL`), applied to an empty database only, and a changed schema is
reported for an explicit reset.

The pipeline strip shows where the schema stands without a boot or an open
tab. On every source change the build worker re-runs the check Boot runs
(`migrate.plan`), and a badge beside Boot reads one of:

- *migration required · initial schema* — nothing is recorded yet (every
  built-in example on open). Boot is blocked until the initial migration is
  recorded.
- *migration required · N unrecorded changes* — what `ddd migrate status`
  lists, with a *destructive* flag when one of them needs
  `--allow-destructive`.
- *migration recorded · N migrations not applied* — the chain records the
  model, and the database this session booted has not applied its newest
  entries.

**Record migration…** opens a dialog that previews exactly what recording
writes — every table's `Initial` for a first recording, the next entry
otherwise — with the Migrations tab's diagram, SQL and destructive gate, and
records through the same path as the tab (`ddd migrate add`). **Apply**
regenerates, bundles and boots, and the boot applies the recorded entries the
database lacks; the badge then clears. The Problems pane shows unrecorded
changes as one notice row that opens the same dialog.

The Agent tab's chat drives the same flow explicitly. It layers three host
tools over the catalog (`web/src/agent/host-tools.ts`): `loom_migration_status`
(the catalog tool, with the workspace's model and chain filled in),
`loom_migration_record` (records through the tab's path, so the badge and the
Migrations tab move with it; a destructive change needs `allowDestructive:
true`) and `loom_migration_apply` (the badge's **Apply**, returning whether
the boot started the app, stopped on a pending migration, or failed and
where). The three act on the model the workspace holds: an edit the plan gate
has not written yet is refused, and the agent records and applies in the next
turn. The scripted demo checks the status and records the initial migration
after it generates.

On top of that live runtime, the playground runs the **DSL-emitted test
suites** — the same files `ddd generate system` writes:

- **api/unit tests** (`src/testing/run-api-tests.ts`, `harness.ts`) — the
  generated `e2e/<System>.e2e.test.ts` (vitest + `fetch`) and the
  aggregate unit tests. The harness re-implements the tiny slice of vitest
  those files use (`describe`/`it`/`expect`) and injects a `fetch` backed
  by the runtime dispatch, so they run with no Node, no real vitest, no
  network.
- **ui tests** (`src/testing/run-ui-tests.ts`) — the generated
  `*.ui.spec.ts` Playwright spec, run against the preview iframe through a
  message-driven page-object driver (`packages/ui-test-driver/`) with a
  `@playwright/test` shim, capturing a final-state screenshot per test.

A Backend console (OpenAPI-driven endpoint picker) and a SQL console round
out the runtime panel for poking the booted backend by hand.

## Workspaces across tabs

Each workspace is one git repo over one IndexedDB (LightningFS +
`isomorphic-git`), so **two tabs on the same workspace are two writers on one
filesystem**. LightningFS's own mutex only covers 500 ms activation windows,
which is far shorter than a git sequence (`stageAll` → `commit` → `writeRef`),
so the playground coordinates a level up:

- **One writer.** Opening a workspace takes an exclusive **Web Lock**
  (`loom.workspace.<gitDb>.writer`, `web/src/workspace/tab-lock.ts`), held for
  the tab's session. The first tab is the writer; a second tab opens the same
  workspace **read-only** — every mutation is refused at the `GitStore` choke
  point (`WorkspaceReadOnlyError`), so auto-commit, the generated-tree merge
  and History's "Restore this version" are all suppressed, not just greyed out.
  Two tabs on *different* workspaces are both writable.
- **Take over.** The read-only tab shows a header banner and a **Take over**
  button; it steals the lock, and the previous holder visibly flips to
  read-only rather than continuing to write. Closing or crashing the writer
  tab releases the lock automatically (that is the Web Locks contract), and
  the waiting tab becomes the writer with no reload.
- **Live readers.** A per-workspace `BroadcastChannel`
  (`web/src/workspace/tab-channel.ts`) carries file / commit / role /
  deleted invalidations. The receiving tab drops its stale LightningFS
  activation window and replays the message into the store's existing
  notifier, so the editor follows through the same external-content `epoch`
  a history restore uses, and History reloads on the commit channel.
  Received messages never re-broadcast, so there is no echo loop.
- **Deleting a workspace** broadcasts first, so other tabs close their
  IndexedDB connection and `deleteDatabase` completes instead of hanging on
  `blocked`; the workspace *list* also syncs across tabs through the
  registry's localStorage `storage` event (the active workspace stays
  per-tab).

A browser without `navigator.locks` / `BroadcastChannel` degrades to the old
single-tab assumption — every tab writable — rather than to a hard failure or
a spurious read-only banner.

## Runtime & evolution surfaces

The dock's **Runtime** tab has four sub-views once the backend is booted: **API** (the spec-driven endpoint console), **Database** (the SQL console + Reset), **Tables** (read-only — `information_schema.tables` across every generated schema, click a table for its first 50 rows; a *Users* strip beside it names the identities requests carry: the generated dev stub's built-in identity and the Auth tab's override) and **Requests** (every OpenAPI operation with the number of requests it served, matched from the runtime log's `request_end` lines by `web/src/backend/route-match.ts`; unmatched paths collect in a *404s* list). Every raw runtime error — a boot failure, a 4xx/5xx body, a dispatch that produced no response — carries one line of interpretation and a *See Output → Runtime logs* link above the raw text.

The **Migrations** tab compares the live source with a baseline (*Last save* by default, or any commit pinned from History) and draws the schema as a table diagram tinted by the pending migration — added green, changed amber, removed red, untouched dimmed (`web/src/layout/migration-tint.ts` over the evolution worker's `tables` + per-step `table`) — beside the migration SQL. A destructive change renders as the gate `ddd migrate add` raises: the `--allow-destructive` flag and the data it would drop. The comparison runs when the tab opens; **Refresh** re-runs it.

The workspace holds the committed migration chain in the same format the CLI keeps on disk: `migrations/*.json` beside the entry `.ddd` (`/workspace/migrations/` for `main.ddd`, see [migrations.md § The migration chain](migrations.md#the-migration-chain--migrations-beside-the-source)). When the chain exists, generate renders it whole, like `ddd generate system`. A chain that does not read as one list fails the generate with a diagnostic. A model with schema changes the chain does not record still generates — unlike the CLI, which refuses — with a warning: the generated migrations stop at the recorded chain, and Boot leaves the database as it is until the change is recorded. The Migrations tab then uses the chain's head as the schema baseline, so the SQL it shows is exactly what `ddd migrate add` would record. The baseline source still drives the wire-contract diff. Every diff passes the model's `migration { … }` intents, so a declared rename shows as a `RENAME COLUMN`, not a drop and add. A status line under the baseline picker gives the chain's entry count, its head, and the unrecorded steps. On two heads it names both files and says to run `ddd migrate rebase` locally. **Record migration** takes a kebab-case name and is the playground's `ddd migrate add`, numbered from the browser's UTC clock. A destructive change also needs its `--allow-destructive` box ticked. Recording writes the new entries into the workspace's working tree like any other edit, then re-runs the diff and the generate. With no chain yet, the first recording starts one with each module's `Initial`. Like `ddd migrate add`, the diff and the record run the IR validator on the live source first: a model it refuses (an `index:` naming a removed field, a missing `dataSources:` binding) shows its diagnostics instead of a migration, because the SQL derived from it would not apply. A baseline pinned from History only has to load. The diff core is `evolveSystem` (`src/system/migration-diff.ts`), which the toolkit's `loom_diff` shares.

The **Tests** tab's requirement verdicts read *Verified / Failing / Untested / Unverified* with a one-line legend; a discovery failure (in a sandbox with no registry: `Failed to resolve module specifier "uuidv7"`) shows one line of interpretation with the raw text folded behind *Show details*, and discovery reports per-suite progress with a *Cancel*.

## The `.loom/` bundle as views, and source ↔ output correspondence

`generate system` emits a documentation bundle beside the code
([`loom-artifacts.md`](loom-artifacts.md)). The Explorer switcher renders it
rather than only listing it: **Diagrams** opens the `.loom/*.mmd` files in the
mermaid viewer, **Traceability** renders the `.loom/*.md` reports, and **API**
lists every HTTP operation grouped by aggregate plus the system's channels.
The API view is derived from the IR (`deriveContextOperations` — the same
derivation all five backend route builders render from), not parsed out of
generated source, so it describes a .NET / Java / Phoenix / Python deployable's
surface just as accurately, with nothing booted. The files stay browsable under
**Generated**.

The generated tree also marks what **changed since the last generate** (the
build worker returns a per-file content hash), and each History commit carries
a *What changed in the output* section grouped by deployable.

**Source ↔ output correspondence** is the Compiler-Explorer feature over
`.loom/sourcemap.json`, which the build worker now records on every system
generate (the artifact itself is still only written into the tree under
`--sourcemap`, so the emitted output is unchanged). Hovering a `.ddd`
declaration names it, marks the generated files it produced and decorates
their lines when one is open; hovering generated code flashes the `.ddd` span
it came from; a **Colour map** toggle tints every declaration and every region
it owns with one hue on both sides. Because the map is construct-granular
rather than language-specific, one hover lights up files across every
deployable at once. Which lines get painted follows the map: a region whose
origin *begins* on the hovered line is a declaration you are pointing at (its
whole file lights up), one that merely covers the line is a declaration you
are inside (only that construct's lines light up). The mapping logic is pure
in `web/src/build/correspondence.ts`.

Finally, a **Select** toggle in the preview footer arms the running app: the
next click is swallowed and its element's `data-testid` is resolved — through
the generated page that emits it, then the sourcemap — to the `.ddd`
declaration, which is revealed in the editor with *Open in Builder* and *Ask
the agent* beside it.

## Crash reporting & diagnostics

The playground is a static GitHub Pages site: **there is no telemetry and no
beacon**, and nothing is ever transmitted automatically. A crash is therefore
only reportable if the app can hand you a self-sufficient artifact — which is
what this layer does.

**On device.** Every crash-class event lands in a 12-entry ring persisted at
`localStorage["loom.diag"]`, so it survives the reload a crash causes. Read it
either in **Output → Diagnostics** (newest first, with the message and stack
inline) or from the console:

```js
__loomDiag()          // the whole ring, oldest-first
```

Five reasons are error classes — `react-error` (the root boundary),
`react-error-pane` (a pane boundary; carries the pane name),
`window-error`, `unhandledrejection`, and `worker-error` (the build worker
died — previously invisible). Everything else (`hidden`, `pagehide`) is a
pressure breadcrumb: heap and storage readings captured *before* a crash. Each
entry carries the **build SHA** of the bundle that produced it; the deployed
bundle ships minified with no sourcemap, so the SHA is the key that makes a
stack resolvable (rebuild that commit).

**Reporting.** *Copy crash report* and *Report on GitHub* sit on both crash
fallbacks, on the "crashed last session" notice, and in the Diagnostics
stream. Copy puts the complete markdown report on the clipboard **and renders
it on screen** so you can read exactly what you are about to share. *Report on
GitHub* opens the [crash-report issue form](https://github.com/Loom-Harness/Loc/issues/new?template=crash-report.yml)
with the report prefilled (abridged to fit the URL — the clipboard copy is
always complete); it is an ordinary link, nothing is sent until you submit.

**A report contains** the build SHA and build time; the crash class, pane,
message, stack and React component stack; the user-agent, viewport and page
URL (path only); heap/storage pressure; and a workspace *fingerprint* — one
row per file with its path, byte length and a truncated SHA-256.

**A report never contains** `.ddd` or generated source text (files appear as
the fingerprint only), the URL query or hash (the share hash encodes your
whole model), any credential shape found in free text (`sk-…`, `ghp_…`,
bearer tokens, JWTs, `key=`/`token=` parameters — all replaced with
`[redacted]`), or your BYOK provider key. That last one is structural, not a
filter: the assembler (`web/src/util/crash-report.ts`) performs no ambient
storage read at all, and a unit test pins that it never names the settings
entry the key lives in.

**Self-test.** `?crash=app` forces a throw inside the root boundary and
`?crash=pane` inside a pane boundary — the way to check that reporting works
on your device without waiting for a real crash (and how the e2e spec covers
the boundaries, which run in the production bundle).

## How it's built and deployed

`npm --prefix web run build` runs `tsc -b` + `vite build`; the output is a
fully static bundle (relative `base`, so it runs from any sub-path). The
`pages.yml` workflow typechecks, smoke-tests (a Node-side end-to-end of the
pipeline), prebuilds the same-origin `npm-mirror/` so the deployed runtime
installs without registry round-trips, builds, and stages `web/dist/` under
`docs/_site/playground/` for GitHub Pages — deployed on every push to
`main` that touches `web/**`. The Playwright e2e specs (`web/e2e/`) gate the
production-built playground; see `web/e2e/README.md`.

## Conventions for changing the playground

- **One UI vocabulary.** Every user-visible string comes from
  `web/src/layout/vocabulary.ts` (the RUNTIME / GENERATE / BUNDLE / BOOT / RUN
  labels, pipeline-stage labels, pane names). A new literal such as "Backend
  logs" in a `.tsx` is a review reject; `test/playground/runtime-views.test.ts`
  asserts the copy comes from the vocabulary.
- **Test ids are a public contract.** The Playwright specs under `web/e2e/`
  address controls by id (`btn-generate`, `btn-bundle`, `btn-boot`,
  `devtools-tab-*`, `mobile-tab-*`, `output-stream-select`, `doc-tab-*`, …).
  Moving a control keeps its id on the new element; removing one lists the specs
  it edited.
- **Gates.** The no-network Playwright lane plus the headless
  `test/playground/*.test.ts` suites gate a change. Anything that bundles or
  boots runs in the heavy, network-gated lane and must not be the only proof.
- **No server.** The playground is a static site: no short links, GitHub push,
  telemetry or multiplayer.

## One source of truth

The value of the playground is that it is not a demo of Loom — it *is*
Loom, minus the filesystem. Generate, validate, the design-pack rendering,
the wire shape, the emitted tests: every one of those is the code under
`src/` that the CLI and CI run. A `.ddd` that compiles, boots, and passes
its tests in the browser does so because the real toolchain made it,
which is exactly why the playground doubles as a fast feedback loop while
developing the toolchain itself.
