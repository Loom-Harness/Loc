// The one way a tab reads an emulated service: `useInfra(service, op, params,
// { poll })` answers from the infra worker and, while the tab is on screen,
// asks again every `poll` ms so the view follows what the deployables do.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { InfraCall, ResourceService } from "./types";

export interface InfraContextValue {
  /** Null before a boot: there is no infra worker to ask. */
  call: InfraCall | null;
  /** Bumped by the shell after any mutation, so every reader refreshes. */
  epoch: number;
  /** Ask every reader to refresh now (after a tab changed something). */
  touch: () => void;
}

export const InfraContext = createContext<InfraContextValue>({ call: null, epoch: 0, touch: () => {} });

export function useInfraCall(): InfraContextValue {
  return useContext(InfraContext);
}

export interface UseInfraOptions {
  /** Re-read every `poll` ms while `enabled`.  0: read once (and on `refresh`). */
  poll?: number;
  /** Default true.  A tab passes its `active` flag so a hidden tab does not poll. */
  enabled?: boolean;
}

export interface UseInfraResult<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export const DEFAULT_POLL_MS = 1500;

export function useInfra<T>(
  service: ResourceService,
  op: string,
  params: unknown = {},
  opts: UseInfraOptions = {},
): UseInfraResult<T> {
  const { call, epoch } = useInfraCall();
  const poll = opts.poll ?? DEFAULT_POLL_MS;
  const enabled = opts.enabled ?? true;
  const key = JSON.stringify(params ?? {});
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!call || !enabled) return;
    let cancelled = false;
    const read = (): void => {
      const mine = ++seq.current;
      setLoading(true);
      call<T>(service, op, JSON.parse(key))
        .then((v) => {
          if (cancelled || mine !== seq.current) return;
          setData(v);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled || mine !== seq.current) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled && mine === seq.current) setLoading(false);
        });
    };
    read();
    if (poll <= 0) return () => void (cancelled = true);
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") read();
    }, poll);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [call, service, op, key, poll, enabled, epoch, tick]);

  return { data, error, loading, refresh };
}

/** Run a mutating op, then refresh every reader. */
export function useInfraAction(): {
  run: <T = unknown>(service: ResourceService, op: string, params?: unknown) => Promise<T>;
} {
  const { call, touch } = useInfraCall();
  const run = useCallback(
    async <T,>(service: ResourceService, op: string, params?: unknown): Promise<T> => {
      if (!call) throw new Error("Boot the system first.");
      try {
        return await call<T>(service, op, params);
      } finally {
        touch();
      }
    },
    [call, touch],
  );
  return { run };
}
