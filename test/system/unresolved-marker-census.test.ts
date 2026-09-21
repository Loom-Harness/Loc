import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// NO EMITTED FILE MAY CONTAIN THE LITERAL `unresolved:`.
//
// One line, and it would have caught the whole defect class on its own.
//
// The shared body walker used to end its ref arm with
//
//     return `/* unresolved: ${expr.name} */ undefined`;
//
// — one site, reached by every unresolved identifier in any page body, on all
// six shared-walker frontends AND the HEEx parallel walker.  It shipped
// `undefined` into the page and `ddd generate system` reported `0 error(s), 0
// warning(s)`.  Downstream that is `TS18050: The value 'undefined' cannot be
// used here` on a typed client, a `TypeError` at runtime, or — worst — a
// dashboard tile that renders blank forever with nothing anywhere reporting a
// problem.
//
// Every existing scan was blind to it, and each for its own reason:
//
//   * the give-up sentinel scans (`render-degradation.test.ts`) match
//     `GIVE_UP_RE`, and this string carries no sentinel and no `loom.*` code;
//   * the per-frontend BUILD gates compile `examples/*.ddd` and
//     `web/src/examples/*.ddd`, and every one of those declares an `api X: Y`
//     param — which is precisely the condition under which the dashboard
//     scaffold's `QueryView { of: <Projection> }` resolves.  Measured on the
//     tree before the fix: 0 markers across the whole shipped corpus, 6 in a
//     26-line model using the DOCUMENTED `scaffoldDashboard` / hand-written
//     `<Agg>Totals` path.
//
// So the corpus could not see it, and the sentinel scan could not read it.
// A grep for the literal needs neither: it reads the OUTPUT, it needs no list
// of wordings to keep in sync, and it fires on any future fail-open fallback
// that reaches for the same spelling.
//
// SHAPE OF THE FIXTURES.  Each is a model whose page body drives the walker's
// ref arm through a binding that USED to fall through — the api-param-less
// dashboard read in both its spellings, on every frontend that consumes the
// shared walker plus the HEEx one that does not.  The frontends are the axis
// that matters: the fallback lived in `_walker/walker-core.ts`, which six of
// the seven share, and `experience_gathered.md` records the inverse failure
// (a seam implemented on Feliz alone while the other four kept their own
// `undefined`).  Asserting on one frontend would have proved nothing about the
// other six.
// ---------------------------------------------------------------------------

/** The marker, spelled once.  `String.raw` is not needed — it is a plain
 *  substring — but naming it keeps the assertion message and the search in
 *  agreement. */
const MARKER = "unresolved:";

/** A dashboard-bearing system with NO `api X: Y` binding on the ui — the
 *  condition that used to leave every projection read unbound.  `variant`
 *  picks which documented route to the dashboard row is exercised:
 *
 *    "scaffolded"  — `context C with scaffoldDashboard`, the macro's own
 *                    `<Agg>Totals` projection;
 *    "handwritten" — the author's own `JobTotals`, which `docs/scaffold-
 *                    macros.md` says WINS over the macro's.
 *
 *  Both produced six markers before the fix; the doc's own override was the
 *  one an adopter hit first. */
function dashboardSystem(
  frontend: string,
  variant: "scaffolded" | "handwritten",
  design: string | null,
): string {
  const withClause = variant === "scaffolded" ? " with scaffoldDashboard" : "";
  const projection =
    variant === "handwritten"
      ? `
      projection JobTotals {
        rowCount: int
        costSum: money
        from Job as j
        select rowCount = count(), costSum = sum(j.cost)
      }`
      : "";
  return `
system DashGap {
  subdomain S {
    context C${withClause} {
      aggregate Job {
        cost: money
        derived display: string = \`job {cost}\`
      }
      repository Jobs for Job { }${projection}
    }
  }
  ui Web with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
  deployable web {
    platform: ${frontend} targets: api ui: Web port: 3001${design ? ` design: ${design}` : ""}
  }
}`;
}

/** The Phoenix leg: LiveView is served by the BACKEND deployable (`ui:` on the
 *  elixir api), and it runs the parallel HEEx walker — which reaches the same
 *  `tryDetectApiHook` seam, so it is in scope for exactly the same reason. */
function phoenixDashboardSystem(variant: "scaffolded" | "handwritten"): string {
  return dashboardSystem("node", variant, null)
    .replace("platform: node contexts:", "platform: elixir ui: Web contexts:")
    .replace(/\n {2}deployable web \{[\s\S]*?\n {2}\}/, "");
}

/** Every emitted file carrying the marker, with a snippet of the offending
 *  line so a failure names the construct instead of only the file. */
function markerHits(files: Map<string, string>): string[] {
  const hits: string[] = [];
  for (const [path, content] of files) {
    if (!content.includes(MARKER)) continue;
    const line =
      content
        .split("\n")
        .find((l) => l.includes(MARKER))
        ?.trim() ?? "";
    hits.push(`${path}: ${line.slice(0, 160)}`);
  }
  return hits.sort();
}

const FRONTENDS: ReadonlyArray<readonly [string, string | null]> = [
  ["react", "mantine"],
  ["vue", "shadcnVue"],
  ["svelte", "shadcnSvelte"],
  ["angular", "angularMaterial"],
  ["feliz", null],
  ["flutter", null],
];

describe("no emitted file carries the `unresolved:` marker", () => {
  it.each(FRONTENDS)(
    "%s: the api-param-less scaffolded dashboard",
    async (frontend, design) => {
      const files = await generateSystemFiles(dashboardSystem(frontend, "scaffolded", design));
      expect(
        markerHits(files),
        `${frontend}: the emitter wrote \`${MARKER}\` into generated output and reported ` +
          `success — a fail-open fallback shipped an unbound name into the page`,
      ).toEqual([]);
    },
    180_000,
  );

  it.each(FRONTENDS)(
    "%s: a hand-written <Agg>Totals wins, and still binds",
    async (frontend, design) => {
      const files = await generateSystemFiles(dashboardSystem(frontend, "handwritten", design));
      expect(markerHits(files), `${frontend}: hand-written projection override`).toEqual([]);
      // Not just marker-free: the read has to actually BIND.  A frontend that
      // silently dropped the tile would pass the grep above while showing the
      // user nothing, which is the same failure wearing a quieter coat.
      const bound = [...files.values()].some((c) => /jobTotals|job_totals|JobTotals/.test(c));
      expect(bound, `${frontend}: no emitted file references the JobTotals read at all`).toBe(true);
    },
    180_000,
  );

  it.each(["scaffolded", "handwritten"] as const)("phoenix/heex: %s dashboard", async (variant) => {
    const files = await generateSystemFiles(phoenixDashboardSystem(variant));
    expect(markerHits(files), `phoenix: ${variant} dashboard`).toEqual([]);
  }, 180_000);
});
