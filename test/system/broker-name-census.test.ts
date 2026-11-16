// Gate for D-NO-TOOL-NAME (docs/decisions).
//
// A generated stack's broker names — the dead-letter exchange and queues, the
// retry routing keys, the virtual host, the CloudEvents `source` and the
// envelope's extension attributes — are rooted at the system's namespace and
// spelled once, in `src/util/channels.ts` (`brokerTopology`, `ENVELOPE_ATTR`,
// `OUTBOX_ORIGIN_KEY`, `EVENT_ID_KEY`).  A producer in one backend and a
// consumer in another must agree on every one of them, so a copy spelled
// anywhere else in `src/` or the playground is refused, as is the tool-named
// spelling they replaced.  A TypeScript comment line is prose and is skipped.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const SHARED_SOURCE = "src/util/channels.ts";

/** Places that spell a topology name with a reason. */
const NOT_SHARED: readonly { file: string; why: string }[] = [
  {
    file: "src/emulation/broker-model.ts",
    why: "the emulation imports nothing outside src/emulation/; broker-topology-parity.test.ts holds its names equal to brokerTopology",
  },
];

const SPELLED = new RegExp(
  [
    // a dead-letter / retry name spelled by hand (`<ns>.dlx`, `<x>.dlq.<a>`, `<x>.retry.<q>`)
    "\\.dlx\\b",
    "\\.dlq\\.",
    "\\.retry\\.",
    // the tool-named spellings replaced
    "loom(?:channel|key|causedby)\\b",
    "__loom(?:EventId|Origin)\\b",
    "loom_outbox_event_id",
    "loom-kafka-",
    "`/loom/",
    '"loom\\.\\$\\{',
  ].join("|"),
  "g",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "generated") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function spelledOutSites(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const abs of files) {
    const file = relative(REPO_ROOT, abs).replaceAll("\\", "/");
    if (file === SHARED_SOURCE || NOT_SHARED.some((w) => w.file === file)) continue;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const m of line.matchAll(SPELLED))
          out.push(`${file}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 120)}`);
      });
  }
  return out;
}

describe("broker names are spelled once", () => {
  const files = [
    ...sourceFiles(join(REPO_ROOT, "src")),
    ...sourceFiles(join(REPO_ROOT, "web/src")),
  ];

  it("no broker name is spelled out outside src/util/channels.ts", () => {
    expect(
      spelledOutSites(files),
      `read the name from ${SHARED_SOURCE} (brokerTopology / ENVELOPE_ATTR / OUTBOX_ORIGIN_KEY / EVENT_ID_KEY)`,
    ).toEqual([]);
  });

  it("each NOT_SHARED file still spells a topology name (a stale row fails)", () => {
    for (const w of NOT_SHARED)
      expect(/\.dlx|\.dlq\./.test(readFileSync(join(REPO_ROOT, w.file), "utf8")), w.file).toBe(
        true,
      );
  });

  it("the scan reaches src/ and the playground (denominator)", () => {
    expectReach("src/ and web/src/ TypeScript files scanned", files.length, 700);
  });
});
