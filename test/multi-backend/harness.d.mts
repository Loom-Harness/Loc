// Types for the plain-JS `harness.mjs` — only what the booted leg calls.

export interface Failure {
  readonly name: string;
  readonly error: string;
}
export interface MatrixResult {
  readonly failures: Failure[];
  readonly cells: number;
}
export interface Stack {
  compose(args: string): string;
  build(): Record<string, number>;
  up(): void;
  down(): void;
  diagnostics(): string;
  sql(statement: string): string;
}
export function makeStack(opts: { project: string; out: string; members: readonly string[] }): Stack;
export function waitUp(stack: Stack, members: readonly string[], timeoutMs: number): Promise<void>;
export function sharedDatabaseMatrix(
  stack: Stack,
  members: readonly string[],
  owner: string,
): Promise<MatrixResult>;
export function cacheMatrix(stack: Stack, members: readonly string[]): Promise<MatrixResult>;
export function jsonDiff(a: unknown, b: unknown, path?: string): string[];
