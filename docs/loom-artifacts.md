# Derived artifacts in a generated tree

Every `ddd generate system` run emits, alongside the per-deployable
project trees, **derived artefacts** — Markdown / Mermaid / C4 documents
under `docs/` and machine-readable contracts under `contracts/`.  They are
produced for tooling and review, not for runtime consumption, and the
generator never reads them back.

```
<outdir>/
├── docker-compose.yml
├── docker-compose.obs.yml   # opt-in observability overlay (see docs/observability.md)
├── monitoring/prometheus.yml
├── db-init/
├── <deployable-1>/
├── <deployable-2>/
├── ...
├── docs/
│   ├── README.md            # the orientation page, regenerated every run
│   ├── diagrams/
│   │   ├── domain.mmd
│   │   ├── workflows.mmd
│   │   ├── er.mmd
│   │   ├── sequence.mmd
│   │   ├── deployment.mmd
│   │   └── traceability.mmd
│   ├── architecture.c4
│   ├── datasources.md
│   ├── traceability.md
│   ├── traceability-matrix.md
│   ├── traceability.json
│   ├── coverage.md
│   └── gaps.md
├── contracts/
│   ├── wire-spec.json
│   ├── asyncapi.yaml        # AsyncAPI 3.0 view of the system's channels
│   └── messages.<source>.json
└── debug/sourcemap.json     # opt-in, only under `generate system --sourcemap`
```

The CLI writes its own records beside the `.ddd` source, not into the
generated tree: `ddd verify` writes `verification/verification.{json,md,mmd}`
(or into `--out`), `ddd snapshot` writes `provenance/<ts>-<guid>.json`, and
`ddd i18n` keeps its merge base and review state in `locales/.sync/`.

None of these files ship to runtime.  Check them into the project
alongside the generated code if you want pull-request-time diff
visibility on wire contracts or traceability coverage.

## Wire contract

| File | Producer | What it is |
|---|---|---|
| `wire-spec.json` | `src/system/wire-spec.ts` (phase ⑨) | JSON-Schema-shaped rendering of the declared contract records, in four buckets: `aggregates` and `parts` (each exposed entity's `response <X>Response` record — the read wire every backend serializes, so `internal` fields are absent), `valueObjects` (each value object's declared fields and derived values), and `requests` (every `command` / `query` record — `Create<Agg>Command`, `<Op><Agg>Command`, `Get<Agg>Query`, … — plus a `<Workflow>Command` for each command-started workflow, from its `create` parameters).  A context no deployable exposes declares no records and contributes no read or request entry.  Language-agnostic; `ddd diff` compares two of these to classify wire changes.  Diffable — wire-contract drift between regens shows up as a clean JSON diff.  Carries the CONSTRAINTS the drift check needs, not just carrier types: an `enum` field publishes its declared members (`{"type":"string","enum":["New","Qualified"]}`, in declaration order, resolved in the referring context), so removing an enum value — a breaking change — moves the file instead of leaving it byte-identical. |
| Frontend Contract (stdout) | `src/ir/contract/frontend-contract.ts` (`ddd emit-frontend-contract`, not `generate system`) | The Frontend Contract: one system's resolved UI (pages, components, stores, layouts, their expression trees) plus the exposed wire surface (operations, declared response / command / query records, the events a UI subscribes to, the value objects and enums they name).  Built by allowlist, so it carries nothing beyond what a frontend target needs; a masked field ships as `maskable: true`, never its predicate.  See D-FRONTEND-CONTRACT in `docs/decisions.md`. |

## i18n catalog

| File | Producer | What it is |
|---|---|---|
| `messages.<source>.json` (`messages.en.json` unless `i18n { source }` says otherwise) | `src/system/i18n-catalog.ts` (phase ⑨) | Source-language message catalog — every user-visible string extracted from the system's UIs, as a flat, key-sorted `{ key: message }` object.  Hand-written text is keyed by content hash (`<Ui>.page.<Page>.<role>.<hash>` / `<Ui>.component.<Comp>.<role>.<hash>` / `<Ui>.menu.<role>.<hash>`) and model-derived text by identity (`<Ctx>.<Type>.<facet>[.<member>]`, D-I18N-KEY) so the catalog is reorder-invariant and a rephrase re-keys cleanly (delete-old + add-new).  The THEIRS side of the `ddd i18n sync` three-way merge each locale is reconciled against ([`i18n.md`](i18n.md)). Plain literals and interpolated templates (`"Order ${o.id}"` becomes the ICU message `Order {id}`) are both extracted. Generated UI chrome is keyed `chrome.*`, English baked into a built-in design pack's templates `pack.<family>.<role>.<hash>`, and the wire validation catalog `msg.<hash>`. Extraction: `src/generator/_walker/i18n-extract.ts`. |

## Storage routing

| File | Producer | What it is |
|---|---|---|
| `datasources.md` | `src/system/datasources.ts` → `renderDataSourcesMd` | Per-system Markdown view of how `resource` declarations route domain contexts to physical storage.  Two sections: per-deployable routing (context → kind → storage with effective schema / table-prefix), and per-storage usage roll-up.  Catches accidental "primary" sharing and unused bindings at PR-review time. |

## Eventing

| File | Producer | What it is |
|---|---|---|
| `asyncapi.yaml` | `src/system/asyncapi.ts` → `renderAsyncApi` | AsyncAPI 3.0 view of the system's `channel` declarations — one channel object per `channel`, its carried events as messages, the `delivery` / `retention` / `key` knobs and the `channelSource` binding under `x-loom`.  Always emitted (`channels: {}` when the system declares none).  See [`channels.md`](channels.md). |

## Diagrams

| File | Producer | What it is |
|---|---|---|
| `domain.mmd` | `src/system/mermaid.ts` → `renderDomainDiagram` | Mermaid class diagram of every aggregate, value object, enum, and event in the system, with containments and `X id` references drawn as relationships. |
| `er.mmd` | `src/system/mermaid.ts` → `renderErDiagram` | Mermaid entity-relationship diagram of every persisted aggregate + part — schema-shaped (PK / FK / columns), not class-shaped. |
| `workflows.mmd` | `src/system/mermaid.ts` → `renderWorkflowDiagram` | One Mermaid flowchart per workflow, showing the create / load / mutate / emit steps. |
| `sequence.mmd` | `src/system/mermaid.ts` → `renderSequenceDiagram` | Mermaid sequence diagram of an operation lifecycle (client → route → repository → DB → events). |
| `deployment.mmd` | `src/system/mermaid.ts` → `renderDeploymentDiagram` | Mermaid deployment diagram of the system's deployables, their target backends, and their shared storage. |
| `architecture.c4` | `src/system/likec4.ts` → `renderC4Model` | [LikeC4](https://likec4.dev/) model of the system at C4 levels 1–3 (context, container, component).  Renderable in the LikeC4 viewer / VS Code extension. |

## Traceability

| File | Producer | What it is |
|---|---|---|
| `traceability.md` | `src/system/traceability.ts` → `renderTraceabilityDoc` | Per-requirement Markdown index: each `requirement` block with its linked `solution`s, `testCase`s, and the runnable `test` / `test e2e` that verifies each test case. |
| `traceability-matrix.md` | `src/system/traceability.ts` → `renderMatrix` | Two-axis matrix view (requirement × test case). |
| `traceability.mmd` | `src/system/traceability.ts` → `renderTraceabilityDiagram` | Mermaid graph of the requirement → solution → testCase → test graph. |
| `traceability.json` | `src/system/traceability.ts` → `renderTraceabilityJson` | Machine-readable form of the same graph (for CI gating, custom reports). |
| `coverage.md` | `src/system/traceability.ts` → `renderCoverageReport` | Per-solution and per-requirement coverage roll-up. |
| `gaps.md` | `src/system/traceability.ts` → `renderGapsReport` | Inverse of coverage — requirements with no solution, solutions with no test case, test cases with no test. |
| `verification.json` | `ddd verify` (`src/cli/commands/verify.ts`) | Join of the requirements graph with a JSON of test results — every requirement gets a `VERIFIED / FAILING / UNVERIFIED / UNTESTED` verdict. |
| `verification.md` | `ddd verify` | Human-readable companion to `verification.json`. |
| `verification.mmd` | `ddd verify` | Mermaid graph of the requirement → test verdicts. |

`ddd verify` writes into `--out <dir>`, defaulting to `verification/` beside the `.ddd` — not into the `generate system` output directory.

See [`traceability.md`](traceability.md) for the surface that
populates these.

## Provenance snapshots

`provenance/`, beside the `.ddd`, carries the immutable provenance captures:

| Pattern | Producer | What it is |
|---|---|---|
| `<ts>-<guid>.json` | `ddd snapshot` (`src/system/loomsnap.ts`) | Provenance rule snapshot.  One immutable timestamped+GUID file per system; captures the rule snapshots for every `provenanced` field.  See [`provenance.md`](provenance.md). |

They are only written by the explicit `ddd snapshot` sub-command — never
by `generate`.

### Migration state is not under `-o`

The output tree holds no migration state.  The migration history is the
committed `migrations/` directory beside the `.ddd` — recorded by
`ddd migrate add`, rendered by every `generate system` — so an output
tree can be deleted and regenerated anywhere.  See
[`migrations.md`](migrations.md) § The migration chain.

## Source map (opt-in)

`debug/sourcemap.json` is the one artifact **not** written by default — it lands only
when `generate system` is passed `--sourcemap`.  Emitted by `src/system/sourcemap.ts`
from an `Origin` spine that all five backends thread through their emitters, it maps
each generated line back to the `.ddd` construct — and, for operation bodies, the
`.ddd` statement — it came from, at both construct and statement granularity.

Its consumer is `ddd trace <logfile>`: given a runtime stack-trace from a generated
backend, it rewrites each frame to point at the originating `.ddd` source line, so a
failure in the generated code reads against the model the author actually wrote.  See
[`tools.md`](tools.md) for the CLI.

Note that "opt-in" is about the **artifact**, not the recorder.  The web playground
records the map on every system generate and reads it in memory — that is what powers
its source ↔ output correspondence ([`playground.md`](playground.md)) — while still
passing the flag off, so the emitted tree it shows and downloads stays byte-identical.
The distinction is possible because the Source Map v3 / JSR-45 sidecars (and the
trailing `sourceMappingURL` directives they add to the emitted `.ts`) are gated on
`sourceTexts`, not on the recorder: with a recorder and no `sourceTexts`, the only
addition to the emission is `sourcemap.json` itself.

With `--sourcemap` the generated tree also gains per-file sidecars: `<file>.map` (Source Map v3) next to emitted `.ts`/`.tsx` files, `<file>.smap` (JSR-45) next to emitted `.java` files, and `.vscode/launch.json` at the output root.  See [`debugging.md`](debugging.md).

## What these artifacts are NOT

- **Not deployed.**  No generated project reads `docs/`, `contracts/` or
  `debug/` at runtime; they are build-time output.
- **Not inputs.**  Every file is fully rewritten on each `generate` run
  and the generator never reads one back.  Don't hand-edit; pin via
  `.loomignore` if you absolutely must keep a custom version.
- **Not part of the wire contract.**  The wire contract is what
  `wire-spec.json` *describes*, not the file itself.  Backends emit
  the actual schemas (Zod, EF DTOs, Ecto schemas) directly into
  their own project trees.

## Cross-references

- [`generators.md` § Migrations](generators.md) — what the
  migration chain's entries become at backend emission time
  (per-platform output table and `MigrationsIR` plumbing).
- [`provenance.md`](provenance.md) — the `ddd snapshot` capture
  step and the runtime trace SDK.
- [`traceability.md`](traceability.md) — the requirement / solution
  / testCase surface that produces the traceability files.
- [`technical.md`](technical.md) — phases ⑨ (composes
  `<outdir>/`) and ⑩ (writes everything via the `.loomignore`
  filter).
