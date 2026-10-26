// Types for the pure helpers `test/system/compare-toolchains.test.ts` exercises.

export function diagnosticKeys(
  json: { model?: string; diagnostics?: readonly object[] } | undefined,
): Set<string>;
export function setDiff(a: Set<string>, b: Set<string>): { removed: string[]; added: string[] };
export function listFiles(dir: string): string[];
export function diffTrees(a: string, b: string): { files: number; differing: string[] };
