// Gate for D-CONSUMER-INBOX (docs/decisions).
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
// This census finds the hand-derived copies in the emitters and the platform
// packages.  It runs as a RATCHET: `LEDGER` records how many copies each file
// holds per rule, and every row carries a typed waiver — `standing` with the
// reason the copy is not a plan decision, or `deferred` with a reason, a
// `reviewUntil` date and the open issue (`blockedBy`) that drains it.  A new
// copy fails (ask the plan instead); a removed copy fails until its row is
// lowered or deleted in the same change; a deferred row past its date fails.
// When the ledger is empty the census becomes a plain ban.
//
// `src/system/migrations-builder.ts` is exempt: the migrations are scoped to
// a module across the whole system, not to one deployable, so they answer
// "does any durable channel exist" over the system and need no plan.
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
//   durable-gate      a "hosts a durable channel" test (`hasDurableEvents(`,
//                     `hostedDurable.size > 0`) → `plan.receivesDurable`
//                     (dedupe, `src/ir/plan/consumer-inbox.ts`) or
//                     `plan.outboxEvents` (capture)
//
// What it cannot see: a copy spelled in a shape none of these patterns match,
// such as a durable test inlined as `durableEventTypes(x).size > 0` (that one
// `durable-set` sees) or a boolean threaded in from a caller that computed it.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { fenceProblem } from "../_helpers/live-fences.js";

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
  "durable-gate": /\bhasDurableEvents\(|\bhostedDurable\.size\s*>\s*0/,
};

/** System-scoped composers, exempt from every rule (see the header). */
const SYSTEM_SCOPED = ["src/system/migrations-builder.ts"];

/** Readers of the raw bindings that are not a deployable's emitter: the
 *  compose/k8s topology, the broker ACLs and the operations env list every
 *  binding of every deployable, which is the binding fact itself, not a
 *  routing decision.  Exempt from the `bindings` rule only. */
const TOPOLOGY_READERS = [
  "src/generator/_channels/",
  "src/system/",
  "src/platform/operations-env.ts",
];

type Waiver =
  | { standing: string }
  | { deferred: string; reviewUntil: string; blockedBy: `#${number}` };

/** A ledger row: how many copies, and why they may stay. */
interface Row {
  count: number;
  waiver: Waiver;
}

/** A deferral is parked work with a date; one parked further out is a
 *  standing waiver in disguise. */
const MAX_DEFERRAL_DAYS = 120;

const OUTBOX_CAPTURE: Waiver = {
  deferred:
    "outbox capture keyed on the context's own durable channels; reads `plan.outboxEvents` once the capture sites take the plan",
  reviewUntil: "2027-01-31",
  blockedBy: "#5927",
};
const PER_CONTEXT_SUBS: Waiver = {
  deferred:
    "per-context dispatcher derivation without the plan's foreign stubs; reads `plan.subscriptions` once the dispatchers take the plan",
  reviewUntil: "2027-01-31",
  blockedBy: "#5927",
};
const LOCAL_TIER: Waiver = {
  deferred:
    "the local-relay flag is computed from `plan.outboxEvents` minus the broker-carried events; a plan field for the local tier retires the name",
  reviewUntil: "2027-01-31",
  blockedBy: "#5927",
};

/** Today's hand-derived copies: file → rule → row.  Only ever lowered. */
const LEDGER: Record<string, Record<string, Row>> = {
  "src/generator/dotnet/index.ts": { "durable-gate": { count: 2, waiver: OUTBOX_CAPTURE } },
  "src/generator/dotnet/projection-emit.ts": {
    subscriptions: { count: 1, waiver: PER_CONTEXT_SUBS },
  },
  "src/generator/elixir/dispatch-emit.ts": {
    subscriptions: { count: 1, waiver: PER_CONTEXT_SUBS },
  },
  "src/generator/elixir/vanilla/index.ts": {
    "outbox-tier": { count: 1, waiver: LOCAL_TIER },
    subscriptions: { count: 1, waiver: PER_CONTEXT_SUBS },
  },
  "src/generator/java/emit/dispatch.ts": { subscriptions: { count: 1, waiver: PER_CONTEXT_SUBS } },
  "src/generator/java/index.ts": { "outbox-tier": { count: 1, waiver: LOCAL_TIER } },
  "src/generator/python/dispatch-builder.ts": {
    "durable-set": { count: 1, waiver: OUTBOX_CAPTURE },
    subscriptions: { count: 1, waiver: PER_CONTEXT_SUBS },
  },
  "src/generator/python/emit/schema.ts": { "durable-gate": { count: 1, waiver: OUTBOX_CAPTURE } },
  "src/generator/typescript/emit/mikroorm-event-sourced.ts": {
    "durable-gate": { count: 1, waiver: OUTBOX_CAPTURE },
  },
  "src/generator/typescript/emit/routes.ts": {
    consumer: {
      count: 1,
      waiver: {
        deferred:
          "`wireDispatcher` re-derives the consumer answer; reads `plan.consumesFromBroker` / `plan.subscriptions` with the capture sites",
        reviewUntil: "2027-01-31",
        blockedBy: "#5927",
      },
    },
    "durable-gate": { count: 1, waiver: OUTBOX_CAPTURE },
  },
  "src/generator/typescript/emit/schema.ts": {
    "durable-gate": { count: 1, waiver: OUTBOX_CAPTURE },
  },
  "src/generator/typescript/repository-eventsourced-builder.ts": {
    "durable-gate": { count: 1, waiver: OUTBOX_CAPTURE },
  },
  "src/platform/hono/shared/emit.ts": { "durable-gate": { count: 2, waiver: OUTBOX_CAPTURE } },
  "src/platform/hono/shared/workflow-builder.ts": {
    "durable-gate": { count: 1, waiver: OUTBOX_CAPTURE },
    "durable-set": { count: 3, waiver: OUTBOX_CAPTURE },
  },
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
        if (SYSTEM_SCOPED.includes(file)) continue;
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
        const was = LEDGER[file]?.[rule]?.count ?? 0;
        if (now > was) grown.push(`${file} ${rule}: ${was} → ${now}`);
        if (now < was) stale.push(`${file} ${rule}: ${was} → ${now}`);
      }
    }
    expect(grown, "ask `channelPlan` (src/ir/plan/channel-plan.ts) instead").toEqual([]);
    expect(stale, "a copy is gone: lower its LEDGER entry in this change").toEqual([]);
  });

  it("every ledger row carries a live waiver", () => {
    const bad: string[] = [];
    const now = Date.now();
    for (const [file, rules] of Object.entries(LEDGER)) {
      for (const [rule, row] of Object.entries(rules)) {
        const id = `${file} ${rule}`;
        if (row.count < 1) bad.push(`${id}: a row with no copies — delete it`);
        const w = row.waiver;
        if ("standing" in w) {
          if (w.standing.trim().length < 20) bad.push(`${id}: a standing waiver needs its reason`);
          continue;
        }
        const fence = fenceProblem(w.blockedBy);
        if (fence !== "") bad.push(`${id}: ${fence}`);
        const due = /^\d{4}-\d{2}-\d{2}$/.test(w.reviewUntil)
          ? Date.parse(`${w.reviewUntil}T23:59:59Z`)
          : Number.NaN;
        if (Number.isNaN(due)) bad.push(`${id}: reviewUntil "${w.reviewUntil}" is not YYYY-MM-DD`);
        else if (due < now)
          bad.push(`${id}: deferral expired on ${w.reviewUntil} (${w.blockedBy})`);
        else if ((due - now) / 86_400_000 > MAX_DEFERRAL_DAYS)
          bad.push(`${id}: reviewUntil ${w.reviewUntil} is past the ${MAX_DEFERRAL_DAYS}-day cap`);
      }
    }
    expect(bad).toEqual([]);
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
      "durable-gate": "receivesDurable: boolean = hasDurableEvents(ctx),",
    };
    for (const [rule, re] of Object.entries(RULES)) expect(re.test(samples[rule]), rule).toBe(true);
    expect(RULES["durable-gate"].test("if (hostedDurable.size > 0) {")).toBe(true);
  });
});
