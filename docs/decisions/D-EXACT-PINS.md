# D-EXACT-PINS — generated project manifests pin every dependency to one exact version

**Status:** DECIDED (owner ruling 2026-10-21, M-T7.11); implemented by #3886.

**Problem.** A range in a generated manifest (`^4.12.0`, `>=0.115,<1`, `~> 1.8`,
postgrex `>= 0.0.0`) resolves at install time. No lockfile is emitted, so a
project that built yesterday could fail today when a dependency released inside
its range — `@hono/zod-openapi` 1.5.2 broke every cross-field invariant's types
that way, and npm packuments cached before a newer matching version existed
died with `ETARGET`.

**Decision.** Every dependency in every generated manifest — `package.json`
(all four JS stacks, every design pack, the Hono backend and its optional
adapters, the Feliz and e2e projects), `pyproject.toml` (including the
`[build-system]` requirement), `mix.exs`, `pubspec.yaml`, and the already-exact
`*.csproj`/`*.fsproj`/`build.gradle.kts` — names one exact version. No lockfile
is generated; transitive dependencies still float. Environment constraints
(`engines`, `requires-python`, the Dart/Flutter `sdk` range, the .NET
`TargetFramework`) are not dependencies and stay ranges.

- **A bump edits the literal**, then re-resolves the whole set. The pins in one
  manifest are checked together, not one by one: `@opentelemetry/api` had to
  sit at 1.9.1 because `sdk-trace-base` 2.12 peers `<1.10`, and `ex_aws` at
  2.6.1 because 2.7 needs `hackney ~> 4` while the adapter pins hackney 1.x.
  Resolve with `npm install --package-lock-only`, `pip install --dry-run`, and
  `mix deps.get` before landing (see the `dependency-upgrade` skill).
- **Waived: Flutter `intl` and `web`.** The SDK pins them (`flutter_localizations`,
  `flutter_web_plugins`) and the generated image tracks `flutter:stable`, so an
  exact value is only knowable once the SDK is pinned.
- **Gate:** `test/system/generated-manifest-pins.test.ts` generates the whole
  tracked `.ddd` corpus on all five backends plus every built-in design pack and
  fails on any range specifier; its waivers ratchet.

**Consequences.** Security fixes inside a range no longer arrive on their own;
they ride the currency sweeps (#3685). The pinned set is the one the
`generated-*-build` and `test:tsc` gates exercise.
