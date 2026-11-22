export interface Shard {
  readonly index: number;
  readonly count: number;
}
export function parseShard(spec: string): Shard;
export function shardFromInvocation(argv: string[], env: Record<string, string | undefined>): Shard | null;
export function selectShard<T>(cases: readonly T[], shard: Shard | null): T[];
export function partitionProblems(cases: readonly { name: string }[], count: number): string[];
export function shardCorpus<T extends { name: string }>(cases: readonly T[], leg: string): T[];
