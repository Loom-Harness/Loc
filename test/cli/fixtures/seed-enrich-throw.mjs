// `node --import` hook for parse-ir-throw.test.ts: swaps the built
// `ir/enrich/enrichments.js` for a shim whose `enrichLoomModel` throws, so the
// CLI meets a lowering-phase failure on a model the AST validator accepts.
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.endsWith("/out/ir/enrich/enrichments.js")) {
    const shim = 'export * from ' + JSON.stringify(r.url + '?orig') + ';' +
      'export function enrichLoomModel() { throw new Error("seeded enrichment failure"); }';
    return { url: 'data:text/javascript,' + encodeURIComponent(shim), shortCircuit: true };
  }
  return r;
}`)}`,
);
