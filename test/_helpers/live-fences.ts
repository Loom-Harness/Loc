// The open issues and PRs a census waiver or a register row may lean on.
//
// A waiver that says "blocked by #NNNN" or a register row that says
// "mission: #NNNN" is a claim that #NNNN is still open work.  A test cannot ask
// GitHub (the merge-queue verdict must not depend on the network), so the
// claim is checked against this committed list instead: a reference to a
// number not listed here fails the census that holds it.
//
// One fence is one file, `test/_helpers/live-fences/<NNNN>.txt`, holding the
// issue's title on one line, so two changes registering different fences add
// different files.
//
// DELETE a fence's file the day its issue closes or its PR merges.  Every waiver and
// row still citing it then fails, which is the point: the work it deferred is
// due.  A fence nothing cites fails `test/system/live-fences.test.ts`, and that
// file's nightly leg (`LOOM_CENSUS_ONLINE=1`, test.yml `census-online`) asks
// GitHub that every fence is still open, so a fence closed without its file
// being deleted is reported the next night.
//
// Readers: src/diagnostics/unsupported-register.ts `mission` (via
// unsupported-register.test.ts), the `unobserved` of a conformance rule
// (test/conformance/semantics-rules.ts, via semantics-observers.test.ts), the
// pending rows of
// test/support/fakes/coverage.ts, the `none, tracked by #N` line of a decision
// record (docs/decisions, via decision-gates.test.ts), a `<!-- tracked: #N`
// marker in a reference doc (via doc-claims.test.ts), and the `blockedBy` of
// the waivers in symbol-plan-census, openapi-native-census,
// e2e-fixed-port-census, channel-plan-census, ir-walk-census and
// workflow-plan-census.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LIVE_FENCES: Readonly<Record<string, string>> = loadFences();

/** Why a fence file is malformed (empty when it is not). */
export function fenceFileProblem(name: string, text: string): string {
  if (!/^\d+\.txt$/.test(name)) return `${name}: a fence file is named <issue or PR number>.txt`;
  if (!/^[^\n]+\n$/.test(text)) return `${name}: a fence file holds its title on one line`;
  return "";
}

/** Every fence file, as `#NNNN` → title, in issue order. */
function loadFences(): Record<string, string> {
  const dir = fileURLToPath(new URL("./live-fences/", import.meta.url));
  const fences: Record<string, string> = {};
  for (const name of readdirSync(dir).sort(
    (x, y) => Number.parseInt(x, 10) - Number.parseInt(y, 10),
  )) {
    const text = readFileSync(`${dir}/${name}`, "utf8");
    const problem = fenceFileProblem(name, text);
    if (problem) throw new Error(`live fences: ${problem}`);
    fences[`#${name.slice(0, -".txt".length)}`] = text.trim();
  }
  return fences;
}

/** `""` when `ref` is a live fence, else the reason it is not. */
export function fenceProblem(ref: string): string {
  if (!/^#\d+$/.test(ref)) return `"${ref}" is not an issue or PR reference (#NNNN)`;
  if (!Object.hasOwn(LIVE_FENCES, ref))
    return (
      `${ref} is not a live fence (test/_helpers/live-fences/${ref.slice(1)}.txt): it closed, ` +
      "so the work it fenced is due — or it is open and was never registered (add its file)"
    );
  return "";
}
