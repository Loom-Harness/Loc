// The TypeScript spelling of the `wirePolicy` fact's sentences
// (`src/ir/enrich/wire-policy.ts`).  The fact owns the words; this module owns
// only how a node/Hono emitter interpolates a runtime subject into them, so
// every node site renders the same sentence the same way.

import { type WireRejectionClass, wireSentence } from "../../ir/enrich/wire-policy.js";

/** A TypeScript template literal for a sentence detail, the subject given as
 *  template-literal CONTENT (`Order \${id}`):
 *  `tsSentence("not-found", "Order \${id}")` → `` `Order ${id} not found` ``. */
export function tsSentence(cls: WireRejectionClass, subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  const tail = suffix === "" ? "" : ` ${suffix}`;
  return `\`${prefix}${subject}${tail}\``;
}

/** `throw new AggregateNotFoundError(`<Agg> ${id} not found`);` — the by-id
 *  read's absence (RS-27).  `idExpr` is the TS expression holding the id. */
export function tsNotFoundThrow(aggName: string, idExpr: string): string {
  return `throw new AggregateNotFoundError(${tsSentence("not-found", `${aggName} \${${idExpr}}`)});`;
}
