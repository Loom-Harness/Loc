// Census: the channel plan's facts are decided once.
//
// `channelPlan` (`src/ir/plan/channel-plan.ts`) answers, for one deployable,
// which broker bindings it wires, which wired channels it does not host, which
// events are durable, which ride the broker, whether it consumes from a broker
// and whether it owns an outbox tier.  Every backend answered those questions
// itself before the plan existed, and the copies disagree (a consumer of a
// foreign durable channel never dedupes; a broker-wired java or elixir
// deployable drops the outbox of an unbound durable channel).
//
// This census finds the hand-derived copies in the emitters, the platform
// packages and the system composer.  It runs as a RATCHET: `LEDGER` records
// how many copies each file holds per rule today.  A new copy fails (ask the
// plan instead); a removed copy fails too until its ledger entry is lowered or
// deleted in the same change, so the ledger only shrinks.  When the ledger is
// empty the census becomes a plain ban.
//
// THE RULES (one line each, comment lines skipped):
//
//   bindings          a `brokerChannelBindings(` call → `plan.bindings`
//   unique-bindings   a local `uniqueBindings` helper → `plan.uniqueBindings`
//   foreign-stubs     a `!hostedChannelNames.has(` filter → `plan.foreignChannels`
//   durable-broker    a `retention === "work" || … "log"` test on a binding
//                     → `plan.durableBrokerEvents`
//   durable-set       a `durableEventTypes(` call → `plan.hostedDurable` /
//                     `plan.foreignDurable`
//   outbox-tier       a hand-named outbox-tier flag (`standaloneOutbox`,
//                     `hasOutboxTier`, `forceOutbox`) → `plan.hasOutbox` /
//                     `plan.producerOnly`
//   consumer          a `!s.projection` / `!sub.projection` subscription
//                     filter → `plan.consumesFromBroker`
//   subscriptions     a `deriveEventSubscriptions(` call → `plan.subscriptions`
//
// What it cannot see: a copy spelled in a shape none of these patterns match.
// The patterns cover every spelling the five backends use today.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["src/generator", "src/platform", "src/system"];

const RULES: Record<string, RegExp> = {
  bindings: /\bbrokerChannelBindings\(/,
  "unique-bindings": /\bfunction uniqueBindings\b/,
  "foreign-stubs": /!hostedChannelNames\.has\(/,
  "durable-broker": /retention === "(work|log)" \|\| \w+\.retention === "(work|log)"/,
  "durable-set": /\bdurableEventTypes\(/,
  "outbox-tier": /\b(standaloneOutbox|hasOutboxTier)\s*=(?!\s*chPlan\.)|\bforceOutbox:/,
  consumer: /\(\s*(s|sub)\s*\)\s*=>\s*!\s*(s|sub)\.projection\b/,
  subscriptions: /\bderiveEventSubscriptions\(/,
};

/** Readers of the raw bindings that are not a deployable's emitter: the
 *  compose/k8s topology, the broker ACLs and the operations env list every
 *  binding of every deployable, which is the binding fact itself, not a
 *  routing decision.  Exempt from the `bindings` rule only. */
const TOPOLOGY_READERS = [
  "src/generator/_channels/",
  "src/system/",
  "src/platform/operations-env.ts",
];

/** Today's hand-derived copies: file → rule → count.  Only ever lowered. */
const LEDGER: Record<string, Record<string, number>> = {
  "src/generator/dotnet/index.ts": { "durable-broker": 1, "durable-set": 2 },
  "src/generator/dotnet/projection-emit.ts": { subscriptions: 1 },
  "src/generator/elixir/dispatch-emit.ts": { subscriptions: 1 },
  "src/generator/elixir/vanilla/index.ts": {
    "durable-broker": 1,
    "durable-set": 1,
    "outbox-tier": 1,
    subscriptions: 1,
  },
  "src/generator/java/emit/dispatch.ts": { subscriptions: 1 },
  "src/generator/java/index.ts": { "durable-broker": 1, "durable-set": 1, "outbox-tier": 1 },
  "src/generator/python/dispatch-builder.ts": { "durable-set": 1, subscriptions: 1 },
  "src/generator/python/index.ts": { "durable-broker": 1, "durable-set": 1 },
  "src/generator/typescript/emit/routes.ts": { consumer: 1 },
  "src/platform/hono/shared/workflow-builder.ts": { "durable-set": 3 },
  "src/system/migrations-builder.ts": { "durable-set": 1 },
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

function census(): { files: number; hits: Record<string, Record<string, number>> } {
  const files = ROOTS.flatMap(sources);
  const hits: Record<string, Record<string, number>> = {};
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(repoRoot, file), "utf8").split("\n")) {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      for (const [rule, re] of Object.entries(RULES)) {
        if (!re.test(line)) continue;
        if (rule === "bindings" && TOPOLOGY_READERS.some((r) => file.startsWith(r))) continue;
        hits[file] ??= {};
        hits[file][rule] = (hits[file][rule] ?? 0) + 1;
      }
    }
  }
  return { files: files.length, hits };
}

describe("channel plan census", () => {
  it("the hand-derived channel facts only shrink", () => {
    const { files, hits } = census();
    expectReach("emitter, platform and system sources", files, 750);
    const sites = Object.values(hits).flatMap((r) => Object.values(r));
    expectReach(
      "hand-derived channel facts",
      sites.reduce((a, b) => a + b, 0),
      1,
    );
    const grown: string[] = [];
    const stale: string[] = [];
    for (const file of new Set([...Object.keys(hits), ...Object.keys(LEDGER)])) {
      for (const rule of Object.keys(RULES)) {
        const now = hits[file]?.[rule] ?? 0;
        const was = LEDGER[file]?.[rule] ?? 0;
        if (now > was) grown.push(`${file} ${rule}: ${was} → ${now}`);
        if (now < was) stale.push(`${file} ${rule}: ${was} → ${now}`);
      }
    }
    expect(grown, "ask `channelPlan` (src/ir/plan/channel-plan.ts) instead").toEqual([]);
    expect(stale, "a copy is gone: lower its LEDGER entry in this change").toEqual([]);
  });

  it("every rule matches the spelling it names", () => {
    const samples: Record<string, string> = {
      bindings: "const b = brokerChannelBindings(dep, sys);",
      "unique-bindings": "function uniqueBindings(bindings: BrokerBinding[]) {",
      "foreign-stubs": ".filter((b) => !hostedChannelNames.has(b.channelName))",
      "durable-broker": '.filter((b) => b.retention === "work" || b.retention === "log")',
      "durable-set": "const d = durableEventTypes(ctx);",
      "outbox-tier": "const standaloneOutbox = !hasChannels;",
      consumer: "subs.some((sub) => !sub.projection)",
      subscriptions: "deriveEventSubscriptions(channels, workflows)",
    };
    for (const [rule, re] of Object.entries(RULES)) expect(re.test(samples[rule]), rule).toBe(true);
  });
});
