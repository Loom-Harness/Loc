# D-PHOENIX-SURFACE — the decomposed Phoenix platform surface

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the canonical platform
name renamed `phoenix` → `elixir`). The *decomposition* conclusions of this
decision (one platform for the language ecosystem; UI framework axis on `ui`;
default domain Ash; no `family@version`; no `apiOnly`) all stand; only the
spelling of the canonical platform name changes. (Reconciles two proposals
that, taken individually, collide. Subsumes the **D-PHOENIX-ECTO** ask from
`elixir-ecto-and-api-only-backends.md`.)

**Amendment (aliases retired).** Both the `phoenix` / `phoenixLiveView`
*platform* aliases (D-ELIXIR-PLATFORM amendment) and the `liveview` *framework*
alias introduced by this decision have since been **removed**. `framework:
phoenixLiveView` is the only framework spelling — the bare `liveview` keyword is
gone from the grammar `Framework` rule, and the `canonicalFramework` desugar
(both the lowering-side and validator-side copies) is deleted. `platform:
elixir` + `framework: phoenixLiveView` are the only spellings.

**Problem.** Two proposals each free a *different* axis off the single
`phoenixLiveView` keyword, and their individually-recommended fixes
**conflict**:

- `elixir-ecto-and-api-only-backends.md` frees the **domain** axis (Ash vs
  Ecto) and its **Option B** recommends carrying that axis *in the platform
  name* — `phoenixLiveView` = Ash, a new `phoenix` = Ecto.
- `embedded-frontend-composition.md` frees the **hosted-UI-framework** axis
  (LiveView vs embedded React) and recommends **retiring `phoenixLiveView`**
  entirely — one `phoenix` platform, with `liveview` demoted to a
  `framework:` value on `ui`.

Composed, they collide: Option B uses the *name* to encode the domain axis,
while the framework note frees a *different* axis off that same name and
deletes it. You cannot do both. `phoenixLiveView` froze **two** axes plus the
host into one token; the fix must free **both** axes the same way — neither
should be re-frozen into a platform name.

**Decision.** **One** backend platform, **`phoenix`**, with both frozen axes
expressed as orthogonal config — *not* as platform names:

| Concern | Where it lives | Values |
|---|---|---|
| **Host runtime / web framework** | `platform: phoenix` | the Phoenix/BEAM runtime (`needsDb: true`, `apiBasePath: "/api"`, serves `priv/static`) |
| **Domain / persistence framework** | the existing **D-ADAPTER-HOME `style:`/`persistence:` adapter** menu off the backend's `PlatformSurface` — **not** a new keyword | `ash` \| `ecto` |
| **Hosted UI framework** | `ui { framework: … }` + `deployable { hosts: }` | `liveview` (Phoenix-only) \| `react`/… (any static host) |

This makes `phoenix.hostableFrameworks = {liveview} ∪ {react, …}` — the
richest of any platform — a *derived* consequence of Phoenix being the only
platform that is both a render runtime **and** a static-asset host, not a
special case. It is **a refinement of D-PHOENIX-ECTO Option B**: keep Option
B's "no `family@version`, no `apiOnly` platform" conclusions, but reject its
"domain axis = platform name" mechanism (which the framework note shows
double-books the name).

**The domain axis is universal, not Phoenix-special.** *Every* backend freezes
a domain/persistence framework — `hono`→Drizzle, `dotnet`→EF+Mediator,
`phoenix`→Ash|Ecto (`docs/generators.md:27`). Ash-vs-Ecto is the *same axis* as
Drizzle-vs-Prisma or EF-vs-Dapper; Phoenix only *looks* special because it is the
first backend whose menu has **size > 1**, so it is the first where the modifier
is ever written. Therefore:

- **No `domain:` keyword, and nothing Phoenix-only.** The axis is the
  already-PINNED **D-ADAPTER-HOME** `style:`/`persistence:` adapter surface:
  each backend exposes its menu + default off its `PlatformSurface`; `phoenix`'s
  menu is `{ash, ecto}` (default `ash`), `hono`'s is `{drizzle}`, `dotnet`'s is
  `{ef}`. A size-1 menu means the author never writes the modifier — which is
  why `platform: hono` looks "domain-free" today. Adding Ecto is *populating
  Phoenix's menu*, not minting a platform mechanism.
- **No second `framework:` on the backend.** `framework` is now the **UI** axis
  (`ui { framework: react | liveview }`); reusing it backend-side would collide.
  A backend's web framework simply **is** its `platform:` (`hono`/`dotnet`/
  `phoenix`). So a backend has exactly two axes, both already named:
  `platform:` (runtime/web framework) and `style:`/`persistence:` (domain
  framework) — and the Ecto note's own Option A already spells Ash/Ecto in
  exactly that surface (`persistence: { ectoPostgres }`, `style: { ecto }`).

Option A (adapter swap) is therefore not a *later* factoring for this axis — it
**is** the axis. This decision pins the domain axis onto the D-ADAPTER-HOME
surface now (the menu/default fields); only the Ash-emit *extraction behind the
adapter contract* remains as the implementation tail the Ecto note phases.

**Consequences.**

- `phoenixLiveView` is retired as a platform token; a desugar shim maps it to
  `platform: phoenix` + the `ash` adapter (default) + the referenced `ui`
  gaining `framework: liveview` (mirrors the `platform: react` → vite-host shim).
- **API-only** stays resolved by **D-API-ONLY** (absence of a `ui`/`hosts:`
  mount) — unchanged; it is neither a name nor a flag.
- **Phoenix-embeds-React** (bundle → `priv/static`, same-origin `/api`)
  becomes expressible for free — the `wwwroot` twin of dotnet.
- The four Phoenix shapes {Ash,Ecto} × {LiveView, embedded-React} +
  {API-only} are spanned by two orthogonal axes (one of them a pre-existing
  adapter menu), not 5+ platform names.

**Open within this decision.**

1. ~~**Adapter-surface spelling** — `style:` vs `persistence:` vs both for the
   Ash/Ecto choice.~~ **RESOLVED by D-REALIZATION-AXES:** neither — the
   domain-framework axis gets a dedicated `foundation:` keyword (default
   `vanilla`), and `persistence:` narrows to the data-access library only.
2. **Default domain** when unspecified on `platform: phoenix` — **`ash`**
   (matches today's `phoenixLiveView` behaviour after desugar). PINNED — now
   expressed as `foundation: ash` (the default) per D-REALIZATION-AXES.

**Affects.** `embedded-frontend-composition.md` §6 (its "retire
`phoenixLiveView`" is this decision's framework half); `elixir-ecto-and-api-only-backends.md`
§4 + §6 (supersedes its D-PHOENIX-ECTO Option-B "sibling platform name" with
"one `phoenix` platform + the domain axis on the D-ADAPTER-HOME surface"); the
`Platform` grammar enum + `Framework` enum; `src/platform/registry.ts`;
`checkDeployable`; **depends on D-ADAPTER-HOME** (the domain axis *is* that
surface's menu/default).

**Amended by D-REALIZATION-AXES.** Its *mechanism* for the domain axis — "rides
the `style:`/`persistence:` surface, no new keyword" — is superseded: the axis
gets the dedicated keyword `foundation:` so the data layer stays pickable under a
framework (`foundation: ash` + `persistence: ashSqlite`). Every *other*
conclusion of this decision stands (one `phoenix` platform, no `family@version`,
no `apiOnly`, `framework:` is UI-only, default domain = Ash).
