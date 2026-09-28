// Types for the plain-JS `mix-retry.mjs` (M-T9.50).
//
// The `.mjs` half is the shell-harness twin of `src`'s `mixDepsGet` /
// `mixLocalInstall`; `test/e2e/support/mix-retry.test.ts` imports it to assert
// the two emit byte-identical snippets, and was getting `any` for both.

/** Attempts a `mix deps.get` gets before the harness gives up. */
export const MIX_DEPS_GET_ATTEMPTS: number;

/** Backoff, in seconds, between `mix deps.get` attempts. */
export const MIX_DEPS_GET_BACKOFF_S: readonly number[];

/** The retrying `mix deps.get` shell snippet. */
export function mixDepsGetShell(): string;

/** The retrying `mix local.hex` + `mix local.rebar` shell snippet. */
export function mixLocalInstallShell(): string;
