export type Effects = Record<string, unknown[]>;
export interface EffectDivergence {
  path: string;
  golden: unknown;
  actual: unknown;
}
export interface Sidecars {
  env: Record<string, string>;
  kinds: string[];
  effects(opts?: { intervalMs?: number; timeoutMs?: number }): Promise<Effects>;
  reset(): Promise<void>;
  /** The runner is about to boot the backend; call it right before the server starts. */
  backendStarting(): void;
  stop(): Promise<void>;
}
export function quiesce<T>(
  observe: () => T | Promise<T>,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<{ value: T; settled: boolean; polls: number }>;
export function startSidecars(srcPath: string, source?: string, opts?: { genDir?: string; caseName?: string }): Promise<Sidecars>;
export function mayNeedSidecars(source: string): boolean;
// biome-ignore lint/suspicious/noExplicitAny: the lowered model is read structurally.
export function plannedFakes(loom: any, storageFakes?: Record<string, unknown>, systemFakes?: Record<string, unknown>): any[];
export const STORAGE_FAKES: Record<string, (() => Promise<unknown>) | null>;
export const SYSTEM_FAKES: Record<string, unknown>;
export function diffEffects(golden: Effects | undefined, actual: Effects | undefined): EffectDivergence[];
export function isEmptyEffects(effects: Effects | undefined): boolean;
