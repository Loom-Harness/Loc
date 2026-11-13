// The bundle's async context, seen from host code in the runtime worker.
//
// The browser `node:async_hooks` polyfill (ASYNC_HOOKS_POLYFILL) carries a
// backend's AsyncLocalStorage context along every continuation the bundle
// schedules.  Host code is not part of that bundle: when it takes a callback
// from the bundle and calls it back after its own native awaits, the context
// is gone by then.  Binding the callback on entry, while the caller's context
// is current, runs it in that context, as on Node.

const KEY = Symbol.for("loom.asyncContext");

interface AsyncContextState {
  bindCurrent?: <F extends (...args: never[]) => unknown>(fn: F) => F;
}

/** `fn`, bound to the async context current at the call; `fn` itself when no
 *  bundle has installed the polyfill. */
export function bindToCallerContext<F extends (...args: never[]) => unknown>(fn: F): F {
  const state = (globalThis as unknown as Record<symbol, AsyncContextState | undefined>)[KEY];
  return state?.bindCurrent ? state.bindCurrent(fn) : fn;
}
