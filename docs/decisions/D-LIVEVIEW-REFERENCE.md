# D-LIVEVIEW-REFERENCE — LiveView is the reference session-stateful frontend; every shared walker change keeps it green

**Status:** PINNED, owner ruling, 2026-11-08.

**Context.** A frontend sits on two independent axes
(`src/util/frontend-axes.ts`): `stateHome` (`client` — page state lives in the
browser — or `server-session` — it lives in a server process bound to the
connection) and `handlerTopology` (`inline` — a handler sits at the element
that raises its event — or `hoisted` — in one dispatcher the element only
names). `dataAccess` follows from `stateHome`: a client-state page reads the
server through the generated HTTP API client, a server-session page calls the
context in-process. The shipped targets cover three of the four combinations:

| | inline handlers | hoisted handlers |
|---|---|---|
| **client state** | React, Vue, Svelte, Angular, Flutter | Feliz (Elmish) |
| **server-session state** | (a Blazor Server target would sit here) | Phoenix LiveView |

Phoenix LiveView is the only `server-session` target. It is what stops the
shared page walker from assuming every frontend holds its state in the browser
and fetches over HTTP.

**Decision.**
- The LiveView frontend is kept as the reference session-stateful target.
  Removing it is off the table while the architecture claims to support
  server-session frontends.
- Every change to the shared walker (`src/generator/_walker/**`) keeps
  LiveView green: the HEEx byte-identical corpus diff, `mix compile
  --warnings-as-errors` on the HEEx fixtures, and the `phoenix-ui-e2e` and
  `behavioral-heex-ui` legs, whose `pull_request` paths include
  `src/generator/_walker/**` (pinned by `workflow-path-coverage.test.ts`).
- Per-target behaviour that depends on either axis reads the axis
  (`WalkerTarget.axes`, `FrameworkFacts.axes`), never a framework name, so a
  server-session target with inline handlers fits without a fork.
- The shared walker core reaches data only through the data-access seam
  (`_walker/data-access.ts`): it says "this body reads X / calls op Y", and the
  target binds that — as a hook over the HTTP API client, as an Elmish `Cmd` /
  `Msg` over a Model field, or as an in-process context call from the session's
  `handle_params` / `handle_event`.

**Guards.**
- `walker-core-framework-census.test.ts`: the shared core names no framework
  and carries no hook or HTTP-client vocabulary; the shared primitives' remaining
  vocabulary is pinned per file and only falls.
- `server-session-data-access.test.ts`: every `server-session` target's
  generated pages import no HTTP API client, run no hook runtime, validate no
  zod wire schema, and make every data read as an in-process context call.
