// ---------------------------------------------------------------------------
// Runtime package choices that leak into emitted React source (as opposed
// to the dep pins in `stacks/<id>/stack-package-deps.hbs`).
//
// Every React stack Loom ships runs React Router 7, whose npm package is
// `react-router` (library mode keeps the v6 API surface).  The import
// specifier is emitted both by pack shell templates (`main.hbs` /
// `app-shell.hbs`, via the `{{routerPackage}}` Handlebars variable wired
// in `render.ts`) and by the page body-walker (`page-shell.ts`).  Both
// read this one constant so the two emission paths cannot drift.  A
// custom pack with no `stack` field gets the same behaviour.
// ---------------------------------------------------------------------------

/** The npm package React Router APIs are imported from. */
export const ROUTER_PACKAGE = "react-router";
