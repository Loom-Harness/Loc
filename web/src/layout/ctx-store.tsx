import { memo, useLayoutEffect, useReducer, useRef, type ComponentType } from "react";

// The shell's `LayoutCtx` as a subscribable store, so a state change re-renders
// only the panels that READ the field that changed.
//
// App owns ~100 `ctx` fields and builds one memoised object out of them.  As a
// plain prop, a change to any field (a keystroke's tick, a cursor line, an
// HTTP-console input, a log flush) would re-render the whole shell — every
// panel, the header, the footer — about 40 ms of React work each time.
//
// Here App publishes the object into a store and passes down a stable PROXY in
// its place.  A component wrapped with `trackedCtx(...)` (or calling
// `useTrackedCtx` itself and wrapped in `memo`) gets its own proxy that records
// every field it reads; when App publishes a new object the component
// re-renders only if one of THOSE fields changed (`Object.is`).  Nothing else
// about the ctx changes: the type is the same, destructuring works, and the
// functions in it are the same stable wrappers.
//
// Why the proxy reads the LATEST published value rather than a per-render
// snapshot: a component also renders because its parent did, or because of its
// own local state, and on that render it may read a field it never read before.
// Reading the newest value means such a read is never stale.  The playground
// renders synchronously (no transitions, no suspending reads under App — see
// `util/useStableFns.ts`), so "latest" and "this render's" are the same value.
//
// Reads are tracked for the component's whole lifetime and never forgotten:
// over-subscribing costs a re-render, forgetting a field would freeze a panel
// on a stale value.  A child that is NOT wrapped reads through its parent's
// proxy, so its fields count as the parent's and it re-renders with it.

const STORE = Symbol("loom.ctx-store");

interface CtxStore<T extends object> {
  value: T;
  readonly listeners: Set<() => void>;
}

function makeProxy<T extends object>(store: CtxStore<T>, used: Set<PropertyKey> | null): T {
  const track = (key: PropertyKey): void => {
    used?.add(key);
  };
  return new Proxy({} as T, {
    get(_t, key) {
      if (key === STORE) return store;
      track(key);
      return (store.value as Record<PropertyKey, unknown>)[key];
    },
    has(_t, key) {
      track(key);
      return key in store.value;
    },
    ownKeys() {
      const keys = Reflect.ownKeys(store.value);
      for (const k of keys) track(k);
      return keys;
    },
    getOwnPropertyDescriptor(_t, key) {
      track(key);
      if (!(key in store.value)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        writable: false,
        value: (store.value as Record<PropertyKey, unknown>)[key],
      };
    },
  });
}

/** App side: publish `value` and return a STABLE stand-in for it to pass down.
 *  `value` must be memoised — a new identity is what notifies the subscribers. */
export function useCtxStore<T extends object>(value: T): T {
  const ref = useRef<{ store: CtxStore<T>; root: T } | null>(null);
  if (ref.current === null) {
    const store: CtxStore<T> = { value, listeners: new Set() };
    ref.current = { store, root: makeProxy(store, null) };
  }
  const { store } = ref.current;
  // Written during render so a child rendering in this same pass reads it.
  store.value = value;
  // Notified after the subscribers' own layout effects (children's run first),
  // so a panel mounted in this pass is already listening; a re-render forced
  // from a layout effect is flushed synchronously, before paint.
  useLayoutEffect(() => {
    for (const listener of [...store.listeners]) listener();
  }, [store, value]);
  return ref.current.root;
}

/** Consumer side: a proxy over the ctx that re-renders this component when a
 *  field it has read changes.  Pair with `memo` (or use `trackedCtx`) — without
 *  `memo` the component still re-renders with its parent.  A ctx that did not
 *  come from `useCtxStore` (a test fixture) is returned unchanged. */
export function useTrackedCtx<T extends object>(input: T): T {
  const store = (input as { [STORE]?: CtxStore<T> })[STORE];
  const [, force] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<{ proxy: T; used: Set<PropertyKey>; seen: T } | null>(null);
  if (store && ref.current === null) {
    const used = new Set<PropertyKey>();
    ref.current = { proxy: makeProxy(store, used), used, seen: store.value };
  }
  if (store && ref.current) ref.current.seen = store.value;
  useLayoutEffect(() => {
    const st = ref.current;
    if (!store || !st) return;
    const check = (): void => {
      const next = store.value as Record<PropertyKey, unknown>;
      const seen = st.seen as Record<PropertyKey, unknown>;
      if (next === seen) return;
      for (const key of st.used) {
        if (!Object.is(next[key], seen[key])) {
          force();
          return;
        }
      }
    };
    store.listeners.add(check);
    // A publish that landed between this render and the subscription.
    check();
    return () => {
      store.listeners.delete(check);
    };
  }, [store]);
  return store && ref.current ? ref.current.proxy : input;
}

/** `memo` + `useTrackedCtx` for a component whose ctx arrives as the `ctx` prop.
 *  Its other props should be identity-stable, or `memo` has nothing to skip. */
export function trackedCtx<P extends { ctx: object }>(
  name: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  function Tracked(props: P): JSX.Element {
    const ctx = useTrackedCtx(props.ctx);
    countRender(name);
    return <Component {...props} ctx={ctx} />;
  }
  Tracked.displayName = `Tracked(${name})`;
  return memo(Tracked) as unknown as ComponentType<P>;
}

/** Render-count probe for the e2e guard: off (one property read) unless a test
 *  installs `window.__loomRenderCounts = {}` before the shell renders. */
export function countRender(name: string): void {
  const counts = (globalThis as { __loomRenderCounts?: Record<string, number> }).__loomRenderCounts;
  if (counts) counts[name] = (counts[name] ?? 0) + 1;
}
