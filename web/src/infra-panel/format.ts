// Display helpers shared by the infra panel's tabs.

/** A remaining duration as the tabs show it: `42s`, `3m 05s`, `1h 02m`. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
