// Census: the channel delivery policy is decided once.
//
// How many attempts a relayed outbox row or a consumed message gets, how often
// the relay polls and how far it backs off, how many rows a pass takes, and how
// a dropped broker connection is redialled are decisions every backend shares
// (`src/generator/_channels/delivery-policy.ts`).  An emitter that spells one
// of those numbers as a literal has made the decision again, and the next
// change to the policy silently skips it.  This scan over every emitter source
// fails on such a literal; the fix is to interpolate the policy constant.
//
// What it cannot see: a number spelled in a shape none of these patterns
// matches.  The patterns cover every spelling the five backends use today
// (constant, module attribute, keyword default, `??` default, Spring Data
// `findTopN`).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_CONSUMER,
  CHANNEL_RECONNECT,
  OUTBOX_RELAY,
  relayBackoffMs,
} from "../../src/generator/_channels/delivery-policy.js";
import { expectReach } from "../_helpers/census-reach.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["src/generator", "src/platform"];
const POLICY_FILE = "src/generator/_channels/delivery-policy.ts";

/** Literal spellings of a policy number inside an emitter's template text. */
const LITERALS: readonly RegExp[] = [
  /MAX_ATTEMPTS\s*=\s*\d/,
  /MaxAttempts\s*=\s*\d/,
  /@max_attempts\s+\d/,
  /max_attempts: int = \d/,
  /\b(maxAttempts|intervalMs|batchSize) \?\? \d/,
  /INTERVAL_MS\s*=\s*\d/,
  /@interval_ms\s+\d/,
  /@batch\s+\d/,
  /BatchSize\s*=\s*\d/,
  /findTop\d+By/,
  /@max_backoff_ms\s+\d/,
  /@reconnect_(base|max)_ms\s+\d/,
  /RECONNECT_(BASE|MAX)_MS\s*=\s*\d/,
  /let delay = \d/,
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (entry.name.endsWith(".ts") && rel !== POLICY_FILE) out.push(rel);
  }
  return out;
}

describe("channel delivery policy census", () => {
  it("no emitter spells a delivery-policy number as a literal", () => {
    const hits: string[] = [];
    const files = ROOTS.flatMap(sources);
    // Every backend's relay or broker client reads the policy.
    const readers = files.filter((f) =>
      fs.readFileSync(path.join(repoRoot, f), "utf8").includes("_channels/delivery-policy.js"),
    );
    expectReach("emitter sources", files.length, 500);
    expectReach("delivery-policy readers", readers.length, 9);
    for (const file of files) {
      const lines = fs.readFileSync(path.join(repoRoot, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const re of LITERALS) if (re.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits, "interpolate the constant from delivery-policy.ts instead").toEqual([]);
  });

  it("the policy is internally consistent", () => {
    expect(OUTBOX_RELAY.maxAttempts).toBeGreaterThan(1);
    expect(CHANNEL_CONSUMER.maxAttempts).toBeGreaterThan(1);
    expect(CHANNEL_RECONNECT.baseDelayMs).toBeLessThan(CHANNEL_RECONNECT.maxDelayMs);
    expect(relayBackoffMs(0)).toBe(OUTBOX_RELAY.intervalMs);
    expect(relayBackoffMs(1)).toBe(OUTBOX_RELAY.intervalMs * 2);
    expect(relayBackoffMs(1_000)).toBe(OUTBOX_RELAY.maxBackoffMs);
  });
});
