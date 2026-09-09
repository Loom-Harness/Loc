// ---------------------------------------------------------------------------
// Stack-id → runtime package choices that the *generator* (not just
// the dep manifest in `stacks/<id>/stack-package-deps.hbs`) must vary
// on.  Most of a stack's identity is data (dep pins, bundler hints);
// this module is the small set of choices that leak into emitted
// source.
//
// The first is React Router 7, which renamed its npm package from
// `react-router-dom` to `react-router` (library mode keeps the v6 API
// surface, so only the import specifier changes).  The router import
// string is emitted both by pack shell templates
// (`main.hbs` / `app-shell.hbs`, via the `{{routerPackage}}` Handlebars
// variable wired in `render.ts`) and by the page body-walker
// (`body-walker.ts`).  Both read this one map so the choice can't
// drift between the two emission paths.
//
// The second is `@hookform/resolvers`, whose v5 `zodResolver` models a
// schema's INPUT and OUTPUT types separately and v3's does not — which
// decides how many generics a money-bearing `useForm` may take.
//
// Mirrors the `builtin-formats.ts` pattern: a tiny pure lookup that
// is the single source of truth, defaulting to today's behaviour so
// every existing pack (stack v1 or a custom pack with no stack)
// emits byte-identical output.
// ---------------------------------------------------------------------------

/** Stack ids whose React Router is v7 — the npm package is
 *  `react-router` (renamed from `react-router-dom`).  Everything else
 *  — v1 or a custom pack with no `stack` field — stays on the
 *  v6 `react-router-dom` package name. */
const ROUTER_V7_STACKS: ReadonlySet<string> = new Set(["v3"]);

export type RouterPackage = "react-router" | "react-router-dom";

/** The npm package name to import React Router APIs from for the
 *  given stack id.  `undefined` (custom packs without a stack) and
 *  every pre-v3 stack resolve to `react-router-dom`. */
export function routerPackageForStack(stackId: string | undefined): RouterPackage {
  return stackId !== undefined && ROUTER_V7_STACKS.has(stackId)
    ? "react-router"
    : "react-router-dom";
}

/** Stack ids on `@hookform/resolvers` v5, whose `zodResolver` returns the
 *  THREE-generic `Resolver<TInput, TContext, TOutput>` and therefore models a
 *  schema's `z.input` and `z.output` separately.  Stack `v1` pins
 *  `@hookform/resolvers` ^3 (see `stacks/v1/stack-package-deps.hbs`), whose
 *  `zodResolver` returns the TWO-generic `Resolver<TFieldValues, TContext>`. */
const RESOLVER_TRANSFORM_STACKS: ReadonlySet<string> = new Set(["v3"]);

/** Whether this stack's `@hookform/resolvers` can express a transforming
 *  schema's input/output split — i.e. whether a money-bearing form may take
 *  the three-generic `useForm<FormState, unknown, Request>`.
 *
 *  On a stack that cannot (`v1`, or a custom pack with no `stack` field), the
 *  three-generic spelling asks for a `Resolver<FormState, unknown, Request>`
 *  and `zodResolver` supplies a two-generic `Resolver<FormState, unknown>` —
 *  TS2322 on every money form in the emitted project.  Those stacks keep the
 *  single generic, which is what they emitted before the transform split
 *  existed and which their looser `zodResolver` accepts. */
export function resolverModelsTransformForStack(stackId: string | undefined): boolean {
  return stackId !== undefined && RESOLVER_TRANSFORM_STACKS.has(stackId);
}
