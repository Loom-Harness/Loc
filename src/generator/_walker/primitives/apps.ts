// Apps {} — the apps the gateway in front of this ui serves.
//
// The list belongs to the front door, not to any ui: the gateway answers it at
// `GATEWAY_APPS_PATH` from its hand-written `apps { … }` block, and a ui fetches
// it at run time.  So no ui names another, changing the list regenerates only
// the gateway, and outside a gateway or behind one with no list (the fetch
// fails) the primitive renders nothing.
//
// Every `walkBody` target binds it through the REQUIRED `renderApps` seam
// (`_walker/target.ts`) into its generated apps component: React imports
// `src/lib/apps.tsx`, Vue/Svelte render an `<Apps />` marker tag and Angular an
// `<app-apps />` selector that their page shells import, Feliz calls
// `Apps.view ()` and Flutter builds `const Apps()`.  LiveView, which no gateway
// gathers, renders nothing.

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import type { WalkContext } from "../walker-core.js";

export function emitApps(call: ExprIR & { kind: "call" }, ctx: WalkContext, depth: number): string {
  return ctx.target.renderApps(call, ctx, depth);
}
