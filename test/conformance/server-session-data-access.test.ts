// A server-session frontend reaches the domain in-process.
//
// A frontend whose page state lives in a server process (`stateHome:
// "server-session"` in `src/util/frontend-axes.ts` — LiveView today) runs its
// page code beside the context modules.  Its pages therefore call the context
// directly: they import no generated HTTP API client, run no hook runtime and
// validate no zod wire schema, and every data read they make is a context
// call.  Those three are exactly what a client-state target needs, so a
// shared-walker change that quietly assumes a client-state target shows up
// here as client vocabulary in a server-session page.
//
// Every server-session framework must name a fixture below; the fixture is the
// richest one that framework renders (for LiveView, the HEEx showcase, which
// reaches every HEEx-rendered primitive).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { frameworksWithAxes, requireFrontendAxes } from "../../src/util/frontend-axes.js";
import { generateSystemFiles } from "../_helpers/index.js";

interface ServerSessionFixture {
  /** The `.ddd` whose ui renders on the framework. */
  readonly source: string;
  /** The generated files the page walker renders. */
  readonly isPage: (path: string) => boolean;
  /** The pages that read data, each of which must do so in-process. */
  readonly isReadingPage: (path: string) => boolean;
  /** One in-process context call. */
  readonly inProcessCall: RegExp;
}

const FIXTURES: Readonly<Record<string, ServerSessionFixture>> = {
  phoenixLiveView: {
    source: "test/fixtures/heex-showcase.ddd",
    isPage: (p) => /_web\/live\/[^/]+\.(ex|heex)$/.test(p),
    isReadingPage: (p) => /_web\/live\/[^/]+_(list|detail)_live\.ex$/.test(p),
    // `<App>.<Context>.<fn>(` — e.g. `ShopApp.Shop.list_orders(`.
    inProcessCall: /\b[A-Z]\w*\.[A-Z]\w*\.[a-z_]\w*[!?]?\(/,
  },
};

/** What a client-state target's pages carry and a server-session page never
 *  does.  Generated text is scanned whole, comments included: a commented-out
 *  client call is still a sign the page was rendered for the wrong target. */
const CLIENT_VOCABULARY: ReadonlyArray<{ readonly what: string; readonly pattern: RegExp }> = [
  {
    what: "HTTP API client",
    pattern:
      /api\/client|["'`]\/api\/|\bfetch\(|axios|HTTPoison|\bReq\.(get|post|put|patch|delete|request)\b|\bTesla\b|\bFinch\b|:httpc\b/,
  },
  {
    what: "hook runtime",
    pattern:
      /@tanstack|react-query|vue-query|svelte-query|\buse(Query|Mutation|State|Effect)\b|\buse[A-Z]\w*\(/,
  },
  { what: "zod wire schema", pattern: /\bzod\b|\bz\.(object|string|number|array|enum)\(/ },
];

const SERVER_SESSION = frameworksWithAxes().filter(
  (fw) => requireFrontendAxes(fw).stateHome === "server-session",
);

describe("server-session frontends reach the domain in-process", () => {
  it("every server-session framework names a fixture", () => {
    expect(SERVER_SESSION.length).toBeGreaterThan(0);
    expect(Object.keys(FIXTURES).sort()).toEqual([...SERVER_SESSION].sort());
    for (const fw of SERVER_SESSION) expect(requireFrontendAxes(fw).dataAccess).toBe("in-process");
  });

  for (const fw of SERVER_SESSION) {
    it(`${fw}: pages carry no client vocabulary, and every read is a context call`, async () => {
      const fixture = FIXTURES[fw]!;
      const files = await generateSystemFiles(readFileSync(fixture.source, "utf8"));
      const pages = [...files.keys()].filter(fixture.isPage).sort();
      const reading = pages.filter(fixture.isReadingPage);
      expect(pages.length, "the fixture renders no page").toBeGreaterThanOrEqual(8);
      expect(reading.length, "the fixture renders no reading page").toBeGreaterThanOrEqual(4);

      const leaks = pages.flatMap((p) =>
        CLIENT_VOCABULARY.flatMap(({ what, pattern }) => {
          const hit = files.get(p)!.match(pattern);
          return hit ? [`${p}: ${what} (${hit[0]})`] : [];
        }),
      );
      expect(leaks).toEqual([]);

      const clientReads = reading.filter((p) => !fixture.inProcessCall.test(files.get(p)!));
      expect(clientReads, "a reading page makes no in-process context call").toEqual([]);
    });
  }
});
