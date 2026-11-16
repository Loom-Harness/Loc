# D-WEB-PLATFORM — one `web` platform; the ui owns the framework

**Status:** PINNED (owner rulings 2026-11).

**Question.** A static-bundle frontend had five platform names (`react`,
`vue`, `svelte`, `angular`, and `static` for React again) while the `ui`
declaration also carried a `framework:`. Which one chooses the framework?

**Decision.**
- **One platform.** `platform: web` is the static-bundle SPA. It renders the
  framework of the `ui` it binds: `react`, `vue`, `svelte` or `angular`.
  `feliz` and `flutter` stay platforms of their own, because each builds with
  its own toolchain and hosts only its own framework.
- **The ui owns the framework.** `framework:` is a clause of the `ui`
  declaration and nowhere else; a deployable has no framework clause. A ui
  without one renders in its host's default framework (`react` on `web` and on
  the backends that embed an SPA). One ui renders in exactly one framework, so
  two frontends in different frameworks bind two uis.
- **`web` stays a usable name.** The keyword is also the natural name of a
  web frontend's ui, so a `ui` may be named `web` and bound as `ui: web`.
- **One registry entry.** The registry, the descriptor table, the capability
  table and the facts table each carry `web` once. Diagrams, traceability and
  every other artefact print `web`. Generated application code is unchanged:
  a `web` deployable emits byte-for-byte what the old per-framework platform
  emitted, and its default port follows the ui's framework (react 3001,
  svelte 3002, vue 3003, angular 3004).
- **No migration logic.** The old values are not platforms: `platform: vue`
  is a parse error like any unknown word. There is no retired-value
  diagnostic and no committed codemod; the change rewrote every model in the
  repository at once.

**Why.** Two clauses named the same choice and could disagree (a `vue` host
binding a `framework: react` ui), and every new static-bundle framework would
have needed a platform, a registry entry, a capability row and a facts row
that differed from React's only in name.

**Enforced by:** `test/platform/web-platform.test.ts`
