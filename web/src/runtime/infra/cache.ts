// The playground's cache: the twin of the redis sidecar a `kind: cache`
// resource dials (`<RES>_URL`).  The generated node cache module talks to it
// through the `ioredis` facade (`engine/npm/resource-facades.ts`), which
// forwards each command here; the infra panel's Cache tab lists, evicts and
// flushes keys through the same service.  The semantics are the core's
// `CacheModel` (src/emulation/cache.ts); this file only keeps one model per
// server URL, so two cache resources on two redis servers stay apart, as in
// compose, and every deployable on one server sees one keyspace.
//
// Ops:
//   command { server, name, args }   one redis command from a deployable
//   keys { server? }                 every live key with its remaining TTL and
//                                    a value preview, per server
//   evict { server, key }            delete one key
//   flush { server? }                empty one server, or every server

import {
  CACHE_EMULATION_NOTES,
  type CacheModel,
  type CacheServerInfo,
  createCache,
  runCommand,
} from "../../../../src/emulation/cache.js";
import type { ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

export type { CacheKeyInfo, CacheServerInfo } from "../../../../src/emulation/cache.js";

export interface CacheServiceOptions {
  now?: () => number;
}

export function createCacheService(opts: CacheServiceOptions = {}): InfraService<ResourceOp> {
  const servers = new Map<string, CacheModel>();
  const server = (url: string): CacheModel => {
    let m = servers.get(url);
    if (!m) {
      m = createCache({ now: opts.now });
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
