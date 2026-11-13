// The playground's cache: the twin of the redis sidecar a `kind: cache`
// resource dials (`<RES>_URL`).  The generated node cache module talks to it
// through the `ioredis` facade (`engine/npm/resource-facades.ts`), which
// forwards each command here; the infra panel's Cache tab lists, evicts and
// flushes keys through the same service.
//
// One `CacheModel` per server URL, so two cache resources on two redis
// servers stay apart, as in compose, and every deployable on one server sees
// one keyspace.  `CacheModel` is pure (an injectable clock, no globals).
//
// Ops:
//   command { server, name, args }   one redis command from a deployable:
//                                    GET / SET (EX|PX ms, NX|XX) / DEL / INCR /
//                                    EXISTS / PTTL / FLUSHDB
//   keys { server? }                 every live key with its remaining TTL and
//                                    a value preview, per server
//   evict { server, key }            delete one key
//   flush { server? }                empty one server, or every server

import type { ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

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
  set(key: string, value: string, opts: { px?: number; nx?: boolean; xx?: boolean } = {}): "OK" | null {
    const exists = this.live(key, false) !== undefined;
    if ((opts.nx && exists) || (opts.xx && !exists)) return null;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: opts.px === undefined ? null : this.now() + opts.px });
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
      if (opts.px !== undefined && !(opts.px > 0)) throw new Error("ERR invalid expire time in 'set' command");
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
      throw new Error(`ERR unknown command '${name}': the playground cache emulates ${CACHE_EMULATION_NOTES[1]}`);
  }
}

export interface CacheServiceOptions {
  now?: () => number;
}

export function createCacheService(opts: CacheServiceOptions = {}): InfraService<ResourceOp> {
  const servers = new Map<string, CacheModel>();
  const server = (url: string): CacheModel => {
    let m = servers.get(url);
    if (!m) {
      m = new CacheModel(opts.now);
      servers.set(url, m);
    }
    return m;
  };
  return {
    name: "cache",
    handle({ op, params }) {
      const p = (params ?? {}) as { server?: string; name?: string; args?: unknown[]; key?: string };
      switch (op) {
        case "command":
          return runCommand(server(p.server ?? ""), p.name ?? "", p.args ?? []);
        case "keys":
          return {
            servers: [...servers]
              .filter(([url]) => p.server === undefined || url === p.server)
              .map(([url, m]): CacheServerInfo => ({
                server: url,
                keys: m.keys(),
                hits: m.hits,
                misses: m.misses,
                evictions: m.evictions,
              })),
            emulated: CACHE_EMULATION_NOTES,
          };
        case "evict":
          return { removed: servers.get(p.server ?? "")?.del([p.key ?? ""]) ?? 0 };
        case "flush":
          for (const [url, m] of servers) if (p.server === undefined || url === p.server) m.flush();
          return { ok: true };
        default:
          throw new Error(`cache: unknown op "${op}"`);
      }
    },
    reset() {
      servers.clear();
    },
  };
}

export const cacheService = createCacheService();
