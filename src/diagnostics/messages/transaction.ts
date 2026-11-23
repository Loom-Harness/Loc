// The `transaction` family of the diagnostic-message catalog: transaction scopes, isolation levels and outside effects.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["effect", "transactional", "isolation"] as const;

export const messages = {
  "loom.effect-in-query": (p: { name: unknown; call: unknown }) =>
    `queryHandler '${p.name}': '${p.call}' causes an outside effect, and a query is a read — every caller that reads it repeats the effect.  That is your choice to make; if the effect belongs to a change, make the call in a commandHandler.`,
  "loom.effect-in-transaction#command": (p: { where: unknown; call: unknown }) =>
    `'${p.call}' in ${p.where} causes an outside effect inside a database transaction — it is not undone if the transaction rolls back.  That is your choice to make; if the effect must happen only once the change commits, emit an event and make the call in a reactor, which runs after the change commits.`,
  "loom.effect-in-transaction#reaction": (p: { where: unknown; call: unknown }) =>
    `'${p.call}' in ${p.where} causes an outside effect inside the reaction's database transaction — it is not undone if the reaction fails and rolls back, and a redelivered event repeats it.  That is your choice to make; make the effect safe to repeat if it must not happen twice.`,
  "loom.effect-in-lambda#effect": (p: { where: unknown; arrow: unknown; token: unknown }) =>
    `inline handler \`${p.arrow}\` performs an effect (\`${p.token}\`) in the page body. ` +
    `Only a named \`action\` may carry effects — declare one and reference it by name ` +
    `(e.g. \`action doIt(…) { … }\` then \`onClick: doIt\`). Render-tree lambdas must be pure.`,
  "loom.effect-in-lambda#remote-mutation": (p: {
    where: unknown;
    arrow: unknown;
    aggName: unknown;
    op: unknown;
  }) =>
    `inline handler \`${p.arrow}\` performs a remote mutation ` +
    `(\`${p.aggName}.${p.op}(…)\`) in the page body. Only a named \`action\` may carry ` +
    `effects — declare one and await the command so its Result is handled (e.g. ` +
    `\`action doIt(…) { match await ${p.aggName}.${p.op}(…) { … } }\` then \`onClick: doIt\`). ` +
    `Render-tree lambdas must be pure.`,
  "loom.transactional-no-effect": (p: { name: unknown }) =>
    `workflow '${p.name}': declared 'transactional' but does not mutate any aggregate or emit any event — the keyword has no effect.`,
  "loom.isolation-requires-transactional": (p: { name: unknown; isolation: unknown }) =>
    `workflow '${p.name}': isolation level '${p.isolation}' requires the 'transactional' keyword.`,
} satisfies Record<string, MessageEntry>;
