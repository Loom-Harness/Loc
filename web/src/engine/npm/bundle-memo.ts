// Reuse of a finished bundle across Boots in one bundler worker.
//
// The key is a SHA-256 over everything the output is a function of: the
// build options (entry / stdin / externals / aliases / sourcemap), every
// generated file's path and bytes, and the dependency ranges.  Any change to
// the generated tree or the pins is a different key, so it misses.
//
// The ranges (`^1.2.0`) resolve against a live registry, so a hit is only
// served within `BUNDLE_MEMO_TTL_MS` — the re-Boot after a no-op Generate,
// not a day-old tab that would otherwise keep a superseded release.

export const BUNDLE_MEMO_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 4;

export interface MemoInputs {
  /** Serialised build options (entry, stdin, flags, aliases, sourcemap). */
  signature: string;
  generatedFiles: Map<string, string | Uint8Array>;
  rootDeps: Record<string, string>;
}

const enc = new TextEncoder();

export async function bundleKey(inp: MemoInputs): Promise<string> {
  const parts: Uint8Array[] = [];
  const push = (tag: string, s: string | Uint8Array): void => {
    const b = typeof s === "string" ? enc.encode(s) : s;
    // Length-prefix every field so ("ab","c") and ("a","bc") differ.
    parts.push(enc.encode(`${tag}:${b.byteLength}:`), b);
  };
  push("sig", inp.signature);
  push("deps", JSON.stringify(Object.entries(inp.rootDeps).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
  for (const path of [...inp.generatedFiles.keys()].sort()) {
    push("path", path);
    push("body", inp.generatedFiles.get(path) as string | Uint8Array);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class BundleMemo<T> {
  private entries = new Map<string, { at: number; value: T }>();
  constructor(
    private readonly ttlMs = BUNDLE_MEMO_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
  }
}
