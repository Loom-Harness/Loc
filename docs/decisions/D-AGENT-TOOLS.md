# D-AGENT-TOOLS — one tool catalog over the toolkit; MCP and in-browser are transports

**Status:** PINNED.

**Problem.** Loom's operations need to be **agent-callable tools**. Two surfaces
want them: external agent hosts (Claude Desktop, IDE agents, CI) via **MCP**, and
the in-browser **playground** agentic chat. An MCP stdio server runs as a Node
subprocess and cannot run in a browser; hand-coding the tool schemas separately
for each surface would let them drift — the same mistake
[D-API-TOOLKIT](D-API-TOOLKIT.md)
fixed one layer down.

**Decision.** A single **transport-neutral tool catalog at `src/tools/`** over
the `src/api/` toolkit is the source of truth; every transport is a thin adapter.

| Layer | Home | Role |
|---|---|---|
| **Tool catalog** | `src/tools/` | `{ name, description, inputSchema (JSON Schema), handler(args)→toolkit }` per tool. Browser-safe (imports only `src/api/` + contract types; **no MCP dependency**). |
| **MCP stdio server** | `packages/ddd-mcp/` | Node entrypoint registering the catalog; for external hosts (`npx ddd-mcp`). |
| **Playground chat** | `web/` | imports the same catalog; dispatches the LLM's `tool_use` calls **directly** to `handler(args)` in-browser. (Optional in-memory MCP for byte-identical parity.) |

**Tools are pure and stateless.** Each tool is a function of its inputs (model
`source` in → report/new-source out); **no server-side model state, no
filesystem side effect.** The host owns the working model and threads it through.
This makes the server safe by default (read-only/functional — no consent
prompts), keeps the browser transport trivial, and inherits the toolkit's
determinism + browser-safety. File emission stays in the CLI, never in a tool.

**Two verb families, one catalog.** (a) **Generative** (the v1 authoring loop,
pure functions of `source`): `loom_validate` `{source}→ValidateReport`,
`loom_apply_patch` `{source,patches}→PatchResult`, `loom_generate`
`{source}→GenerateReport`, `loom_outline` `{source}→Outline`. (b)
**Navigational** (query/refactor over the LSP providers, by-name dotted-symbol
addressing): `loom_find_symbol` / `loom_references` / `loom_hover` /
`loom_rename` / `loom_quickfix` / `loom_unfold_macro` — **edits returned as an
LSP `WorkspaceEdit`, never applied to disk** (consistent with pure tools).
(c) **Evolution** (pure functions surfacing the derived-artifact deltas the
playground's Migrations dock shows a human): `loom_snapshot` `{source}→SnapshotReport`
(the `ddd snapshot` provenance capture, returned as data — **no file emission**)
and `loom_diff` `{source,baseline?}→DiffReport` (the schema-migration + wire-
contract delta a change implies, with the destructive/breaking gate surfaced),
plus `loom_migration_status` `{source,migrations?}` and `loom_migration_record`
`{source,migrations?,name,allowDestructive?}` — `ddd migrate status` / `add` as
data, the record RETURNING the new chain files.  Applying a migration to a
database has a side effect, so it is a host tool, never a catalog one: the
playground's chat adds `loom_migration_apply` over its runtime database.
Folded from the superseded `language-services-and-agent-tools` proposal; the
navigational verbs gate on fixing the LSP providers' real bugs (operation
rename) first. `loom_read_model` / `loom_list_primitives` / `loom_snapshot` /
`loom_diff` have shipped; `loom_verify` follows once the playground can run the
emitted suites in-browser (M-T8.3 / M-T8.6). New diagnostic→fix mappings are
`src/language/fix-hints.ts` providers (one `ModelPatch` → both the LSP
code-action and `loom_quickfix`), not duplicated bespoke verbs.

**Consequences / answers the question that prompted this.**
- The **stdio MCP server is not runnable in the playground browser** — and isn't
  needed there; the playground dispatches tool calls to the in-process catalog.
- Adding playground agentic chat becomes a **UI + LLM-wiring** task reusing the
  catalog — no second tool implementation. The only browser-new concern is LLM
  key/endpoint handling.
- A future **Streamable-HTTP** transport (hosted Loom MCP endpoint) is another
  thin adapter over the same catalog.

**Rejected.** A stateful "session holds the model" MCP server (adds mutable
server state, complicates the browser path, buys nothing a host string can't);
write-capable tools in v1 (kept side-effect-free; `generate-to-disk`, if ever
wanted, is a separate consent-gated tool).

**Affects.** `ai-authoring-loop.md` §3 (the tool surface is the catalog + MCP /
in-browser transports) and §7 item 6; the new `agent-tools-and-mcp.md` is the
detailed spec; the future playground-chat slice builds on this seam.
