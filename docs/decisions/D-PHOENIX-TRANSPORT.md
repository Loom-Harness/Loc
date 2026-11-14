# D-PHOENIX-TRANSPORT — Phoenix is the `transport:` value on `platform: elixir`; `phoenixRouter` is a back-compat alias

**Status:** PINNED. (Depends on **D-ELIXIR-PLATFORM** and **D-REALIZATION-AXES**;
spec in `proposals/elixir-platform-rename.md`.)

**Amendment (alias retired).** The `phoenixRouter` → `phoenix` back-compat
transport alias described below has since been **removed** — `phoenix` is the
only `transport:` value now. The `canonicalTransport` desugar helper (which was
already dead code — nothing called it) is gone, and `transport: phoenixRouter`
no longer resolves to any adapter (it fails the realization-axes menu check
like any unknown transport). Mirrors the retired platform aliases
(`hono`/`phoenix`/`fastapi`) and the `liveview` framework alias.

**Problem.** The transport value `phoenixRouter` carried a redundant `Router`
suffix that named no real distinction (Phoenix has one router; there's no
"Phoenix-but-not-the-router" alternative). Under `foundation: ash` the
transport axis is owned (`FOUNDATION_OWNED_AXES.ash = ["application",
"transport"]`), so users never even wrote it. It existed only as a default
value in the IR — repeating the framework name with no information added.

**Decision.**

- **`phoenix` is the canonical `transport:` value** on `platform: elixir`
  (D-ELIXIR-PLATFORM). Names the Phoenix web framework, parallel to how
  `transport: hono` names the Hono web framework on `platform: node`.
- **`phoenixRouter` is a back-compat alias** that desugars to `phoenix` at
  the lowering boundary (`canonicalTransport` in
  `src/ir/lower/lower-platform.ts`). Every existing source with explicit
  `transport: phoenixRouter` keeps working unchanged.
- **Future Elixir web frameworks** (a Plug-only minimal API, hypothetical
  alternatives) slot into `transport:` as siblings; the menu grows from
  size-1 to size-N without a platform-level change.

**Affects.** `src/ir/lower/lower-platform.ts` (new `canonicalTransport` +
`greenfieldMenu` returns `"phoenix"` for `elixir`); `src/language/validators/data/platform-rules.ts`
(transport menu update); test expectations across the lowering / axes test
files; `proposals/elixir-platform-rename.md`. **Depends on
D-ELIXIR-PLATFORM**.
