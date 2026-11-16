// Types for the plain-JS `topology.mjs`.

export interface Member {
  readonly key: string;
  readonly clause: string;
  readonly port: number;
}
export const MEMBERS: readonly Member[];
export const MEMBER_KEYS: readonly string[];
export const CHECKS: readonly ("shared-database" | "cache")[];
export function serviceOf(key: string): string;
export function expandFixture(source: string, order: readonly string[]): string;
export function dropE2eBlocks(source: string): string;
export function rotations(order: readonly string[]): string[][];
export function orderedPairs(keys: readonly string[]): [string, string][];
