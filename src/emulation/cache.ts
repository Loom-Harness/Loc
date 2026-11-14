// The emulated cache: the twin of the redis server a `kind: cache` resource
// dials.  It serves the commands Loom's generated cache modules send (GET,
// SET with EX / PX / NX / XX, DEL, INCR, EXISTS, PTTL, FLUSHDB) with exact
// TTLs on an injectable clock, least-recently-used eviction past `maxKeys`,
// and an inspect view (each live key with its remaining TTL and a value
// preview, plus hit / miss / eviction counts).  A host keeps one instance per
// redis server URL.

/** Keys a server holds before the least recently used one is evicted. */
export const CACHE_MAX_KEYS = 10_000;
/** Characters of a value the inspector shows. */
const PREVIEW = 200;

/** Where the emulation knowingly differs from the real redis. */
export const CACHE_EMULATION_NOTES: readonly string[] = [
  `eviction drops the least recently used key past ${CACHE_MAX_KEYS} keys (no maxmemory accounting)`,
  "only the commands the generated cache module sends are served (GET, SET, DEL, INCR, EXISTS, PTTL, FLUSHDB)",
  "the keyspace lives in memory: a Reset or a reload empties it",
];

interface Entry {
  value: string;
  /** Epoch ms; null = no expiry. */
  expiresAt: number | null;
}

export interface CacheKeyInfo {
  key: string;
  /** The first characters of the value. */
  preview: string;
  /** Characters in the value. */
  size: number;
  /** Remaining time to live in ms; null = persistent. */
  ttlMs: number | null;
}

export interface CacheServerInfo {
  server: string;
  keys: CacheKeyInfo[];
  hits: number;
  misses: number;
  evictions: number;
}

export class CacheModel {
  /** Insertion order = recency order (a touched key is re-inserted last). */
  private readonly entries = new Map<string, Entry>();
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = CACHE_MAX_KEYS,
  ) {}

  /** The live entry of `key`, touched for recency; an expired one is removed. */
  private live(key: string, touch = true): Entry | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    if (touch) {
      this.entries.delete(key);
      this.entries.set(key, e);
    }
    return e;
  }

  get(key: string): string | null {
    const e = this.live(key);
    if (e) this.hits++;
    else this.misses++;
    return e?.value ?? null;
  }

  /** `SET key value [PX ms] [NX|XX]`: null when NX/XX refused the write. */
  set(
    key: string,
    value: string,
    opts: { px?: number; nx?: boolean; xx?: boolean } = {},
  ): "OK" | null {
    const exists = this.live(key, false) !== undefined;
    if ((opts.nx && exists) || (opts.xx && !exists)) return null;
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: opts.px === undefined ? null : this.now() + opts.px,
    });
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
      this.evictions++;
    }
    return "OK";
  }

  del(keys: readonly string[]): number {
    let n = 0;
    for (const k of keys) if (this.live(k, false) && this.entries.delete(k)) n++;
    return n;
  }

  /** Redis INCR: a missing key counts from 0; the TTL is kept. */
  incr(key: string): number {
    const e = this.live(key);
    const current = e ? Number(e.value) : 0;
    if (!Number.isSafeInteger(current) || (e && !/^-?\d+$/.test(e.value))) {
      throw new Error("ERR value is not an integer or out of range");
    }
    const next = current + 1;
    this.entries.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
    return next;
  }

  exists(keys: readonly string[]): number {
    return keys.filter((k) => this.live(k, false)).length;
  }

  /** Redis PTTL: -2 missing, -1 persistent, else the ms left. */
  pttl(key: string): number {
    const e = this.live(key, false);
    if (!e) return -2;
    return e.expiresAt === null ? -1 : e.expiresAt - this.now();
  }

  flush(): void {
    this.entries.clear();
  }

  /** Every live key, most recently used last. */
  keys(): CacheKeyInfo[] {
    const now = this.now();
    const out: CacheKeyInfo[] = [];
    for (const [key, e] of [...this.entries]) {
      if (e.expiresAt !== null && e.expiresAt <= now) {
        this.entries.delete(key);
        continue;
      }
      out.push({
        key,
        preview: e.value.length > PREVIEW ? `${e.value.slice(0, PREVIEW)}…` : e.value,
        size: e.value.length,
        ttlMs: e.expiresAt === null ? null : e.expiresAt - now,
      });
    }
    return out;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v));

/** Run one redis command (as ioredis names it, args as sent) on `model`. */
export function runCommand(model: CacheModel, name: string, args: readonly unknown[]): unknown {
  const cmd = name.toLowerCase();
  switch (cmd) {
    case "get":
      return model.get(str(args[0]));
    case "set": {
      const opts: { px?: number; nx?: boolean; xx?: boolean } = {};
      for (let i = 2; i < args.length; i++) {
        const flag = str(args[i]).toUpperCase();
        if (flag === "PX") opts.px = Number(args[++i]);
        else if (flag === "EX") opts.px = Number(args[++i]) * 1000;
        else if (flag === "NX") opts.nx = true;
        else if (flag === "XX") opts.xx = true;
        else throw new Error(`ERR syntax error: SET option ${flag} is not emulated`);
      }
      if (opts.px !== undefined && !(opts.px > 0))
        throw new Error("ERR invalid expire time in 'set' command");
      return model.set(str(args[0]), str(args[1]), opts);
    }
    case "del":
      return model.del(args.flat().map(str));
    case "incr":
      return model.incr(str(args[0]));
    case "exists":
      return model.exists(args.flat().map(str));
    case "pttl":
      return model.pttl(str(args[0]));
    case "flushdb":
      model.flush();
      return "OK";
    default:
      throw new Error(
        `ERR unknown command '${name}': the playground cache emulates ${CACHE_EMULATION_NOTES[1]}`,
      );
  }
}

export interface CacheOptions {
  /** Epoch ms; default `Date.now`. */
  now?: () => number;
  /** Keys held before the least recently used one is evicted. */
  maxKeys?: number;
}

export function createCache(opts: CacheOptions = {}): CacheModel {
  return new CacheModel(opts.now, opts.maxKeys);
}
