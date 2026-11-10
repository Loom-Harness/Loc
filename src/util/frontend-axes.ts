// ---------------------------------------------------------------------------
// The two axes a frontend is placed on, and what follows from them.
//
// "Session-stateful" is two independent properties, not one:
//
//   - `stateHome` — where a page's state lives.  `client`: in the browser
//     (an SPA's component state / store).  `server-session`: in a server
//     process bound to the connection (a LiveView socket, a Blazor Server
//     circuit).
//   - `handlerTopology` — where an event handler's code sits.  `inline`: at
//     the element that raises the event (a JSX `onClick`, an Angular
//     `(click)` binding).  `hoisted`: in one dispatcher the element only
//     names (an Elmish `update` over `Msg`, a LiveView `handle_event/3`).
//
// The targets span three of the four combinations (React/Vue/Svelte/Angular/
// Flutter: client + inline; Feliz: client + hoisted; LiveView: server-session +
// hoisted), and a server-session target with inline handlers (Blazor Server)
// is the fourth.  Per-target behaviour that depends on either property reads
// the axis, never the framework name, so that fourth target fits without a
// fork.
//
// `dataAccess` follows from `stateHome`: client state reads the server through
// the generated HTTP API client, server-session state calls the context
// in-process.  It is derived, not stored.
//
// The table lives in `src/util/` because both the platform descriptor
// (`src/platform/target-facts.ts`) and the walker targets
// (`src/generator/**`) read it, and the generator may not import `platform/`.
// ---------------------------------------------------------------------------

/** Where a page's state lives. */
export type StateHome = "client" | "server-session";

/** Where an event handler's code sits relative to the element raising it. */
export type HandlerTopology = "inline" | "hoisted";

/** How a page body reaches the domain: through the generated HTTP API client,
 *  or by calling the context module in the same process. */
export type DataAccess = "http-client" | "in-process";

/** One frontend's position on both axes, plus what follows from them. */
export interface FrontendAxes {
  readonly stateHome: StateHome;
  readonly handlerTopology: HandlerTopology;
  readonly dataAccess: DataAccess;
}

/** The data access a state home implies. */
export function dataAccessOf(stateHome: StateHome): DataAccess {
  return stateHome === "server-session" ? "in-process" : "http-client";
}

const axes = (stateHome: StateHome, handlerTopology: HandlerTopology): FrontendAxes => ({
  stateHome,
  handlerTopology,
  dataAccess: dataAccessOf(stateHome),
});

const CLIENT_INLINE = axes("client", "inline");

/** Every ui framework's axes, keyed by its `uiFramework` name. */
const FRONTEND_AXES: Readonly<Record<string, FrontendAxes>> = {
  react: CLIENT_INLINE,
  vue: CLIENT_INLINE,
  svelte: CLIENT_INLINE,
  angular: CLIENT_INLINE,
  flutter: CLIENT_INLINE,
  feliz: axes("client", "hoisted"),
  phoenixLiveView: axes("server-session", "hoisted"),
};

/** The axes of a ui framework, or `undefined` for an unknown name. */
export function frontendAxesOf(framework: string | undefined): FrontendAxes | undefined {
  if (framework === undefined || !Object.hasOwn(FRONTEND_AXES, framework)) return undefined;
  return FRONTEND_AXES[framework];
}

/** The axes of a ui framework the caller knows is registered.  Throws on an
 *  unknown name, so a new frontend that forgets its row fails at load. */
export function requireFrontendAxes(framework: string): FrontendAxes {
  const found = frontendAxesOf(framework);
  if (!found) throw new Error(`frontend-axes: no axes declared for ui framework '${framework}'`);
  return found;
}

/** Every framework with declared axes, for the completeness tests. */
export function frameworksWithAxes(): readonly string[] {
  return Object.keys(FRONTEND_AXES);
}
