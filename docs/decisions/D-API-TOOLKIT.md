# D-API-TOOLKIT — one transport-neutral toolkit core, thin adapters per surface

**Status:** PINNED.

**Problem.** Loom's structured operations (`validate`, `generate`, `patch`,
plus `outline` and the diagnostics/fixHint serializers) were being grown inside
`src/cli/` (`json-report.ts`, `runParseJson`), which is Node-bound. But the
**same operations** are needed by at least four surfaces — the CLI, an MCP
server (agents), the LSP (Monaco/VS Code), and the in-browser playground — and
re-implementing them per surface is exactly the drift the structured contract
exists to prevent. The patch/diagnostic format is also ours
([`ai-diagnostics-contract.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/ai-diagnostics-contract.md)), not an
editor/agent standard, so it needs *one* authoritative implementation plus thin
adapters at the boundaries.

**Decision.** A single **transport-neutral toolkit at `src/api/`** is the
shared core; every surface is a thin adapter over it.

| Layer | Home | Role |
|---|---|---|
| **Toolkit core** | `src/api/` | `validate(source)→ValidateReport`, `generate(source)→GenerateReport`, `applyPatches(source,patches)→PatchResult`; pure, in-memory, **browser-safe** (parses on `EmptyFileSystem`, no `langium/node`). `src/api/report.ts` holds the diagnostic/outline serializers. |
| **CLI** | `src/cli/` | argv + stdout/exit only; calls the toolkit. |
| **MCP server** | (future) | tool handlers calling the toolkit — the recognized way agents call tools. |
| **LSP adapters** | `src/language/lsp/` | `ModelPatch → WorkspaceEdit/TextEdit`, `fixHint → CodeAction`, `JsonDiagnostic → Diagnostic`. |
| **Web playground** | `web/` | imports the toolkit directly (`../src/api`). |

**Consequences.**
- The CLI shrank to thin wrappers (`runParseJson`/`runGenerateJson` are a few
  lines each); the fat report-building moved out of `src/cli/`.
- `applyPatches` switched `NodeFileSystem` → `EmptyFileSystem`, restoring the
  "`src/language/` is browser-safe" invariant (CLAUDE.md).
- The **node-addressed `ModelPatch` stays the loop-native format** (it survives
  re-printing and joins to diagnostics/outline); LSP/MCP are adapters at the
  edge, so the system is "recognizable by everything" without compromising the
  core.
- A new operation (e.g. `rename`, `verify`) is added **once** in the toolkit and
  every surface inherits it.
- `src/api/` sits above `language`/`ir`/`generator`/`system` (an
  orchestration/entrypoint layer, like `cli`); it is not scanned by the
  pipeline-layering invariant and creates no back-edge.

**Affects.** `ai-diagnostics-contract.md` (`--json` scope note now points at the
toolkit, not the CLI); `ai-authoring-loop.md` §3 (the tool surface is the
toolkit + an MCP transport); future MCP-server and LSP-adapter slices build on
this seam.
