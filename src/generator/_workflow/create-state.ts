// ---------------------------------------------------------------------------
// The command-side twin of the reactor's correlation routing (F58 / M-T6.62).
//
// A workflow with an id-shaped state field is a SAGA: every backend emits a
// persisted correlation row for it (a Drizzle/EF/JPA/SQLAlchemy/Ecto table
// keyed by that field) and every backend's EVENT-triggered handler already
// loads-or-allocates that row, binds the body's `this.<stateField>` to it
// (`thisName: "state"`) and saves it at exit.
//
// The COMMAND-triggered `create` skipped all three: it rendered the body with
// the default `this` receiver — which is unbound in a Hono arrow function, a
// .NET/Java handler class with no such member, a module-level python `async
// def`, and an Elixir `with`-chain — and never created the row, so a later `on`
// reactor for the same key logged `event_unrouted` forever.
//
// THE RULE ITSELF LIVES AT IR LEVEL (`ir/util/workflow-own-state.ts`), because
// phase ⑦ has to refuse exactly the shapes phase ⑧ cannot address — a shape the
// validator admits and the emitter cannot key is the original bug — and the
// validator cannot import down-pipeline from `generator/`.  This module is the
// generator-side door onto it: the five workflow emitters import from here.
// ---------------------------------------------------------------------------

export {
  commandCreateCorrelationParam,
  workflowBodyUsesOwnState,
  workflowBodyWritesOwnState,
} from "../../ir/util/workflow-own-state.js";
