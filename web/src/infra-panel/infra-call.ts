// What an infra-panel tab needs from its host: one way to call an infra
// service (`{ service, op, params }`, answered by the infra worker), and a
// poll that keeps the tab live.  The tabs hold no service state of their own:
// every value they show is the answer of an infra request.

import { useCallback, useEffect, useRef, useState } from "react";

export type InfraCall = <T = unknown>(service: string, op: string, params?: unknown) => Promise<T>;

export interface Polled<T> {
  data: T | null;
  error: string | null;
  /** Load again now (after an action). */
  refresh: () => void;
}

/** Load `load()` now and every `ms` while mounted.  A failed load keeps the
 *  last data and reports the error; a slow load is never overlapped. */
export function usePoll<T>(load: () => Promise<T>, ms = 1000): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const busy = useRef(false);
  const alive = useRef(true);

  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await loadRef.current();
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [tick, ms]);

  return { data, error, refresh: () => void tick() };
}

/** A remaining duration as the tabs show it: `42s`, `3m 05s`, `1h 02m`. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
