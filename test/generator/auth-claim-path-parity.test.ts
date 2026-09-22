// One `user { … }` field, one IdP claim name — on every backend.
//
// The IdP mints ONE token.  So the claim path a backend reads for a declared
// field is a cross-backend contract exactly like the HTTP wire shape, and the
// five backends must agree on it or the same token cannot satisfy a system that
// runs more than one of them.
//
// They did not.  `claimPathFor` existed SIX times — once per backend auth
// emitter — and two copies had drifted: python and elixir applied `snake()` to
// the default, so
//
//     user { technicianId: string }
//
// made node/java/.NET read `technicianId` while python/elixir read
// `technician_id`.  Nothing warns.  The claim decodes to `null` on the
// snake_case side, and a null claim is silent by construction: the tenancy
// filter then matches no rows and every `permissions.contains(...)` gate 403s,
// which reads as "correctly denied" rather than "misconfigured".
//
// The field name wins because a claim path is an EXTERNAL WIRE NAME the IdP
// owns, not a language identifier — the same reason both offending backends
// already camelCase their HTTP wire (`problem_details.ex` says so in as many
// words).  A `claims: { field: "path" }` mapping is the supported way to say
// the IdP spells it differently, and is unaffected.
//
// The six copies are now one shared `claimPathFor` in
// `src/generator/_auth/claim-types.ts`.  This gate is the behavioural half:
// it reads the EMITTED code of all five backends and asserts they name the
// same claim, so a seventh copy (or a re-drift of the shared one) fails here
// rather than at someone's login screen.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** A claim field whose name is MULTI-WORD — single-word fields (`role`,
 *  `email`) are identical under every casing convention, which is exactly why
 *  the drift survived: no fixture named a claim that could tell them apart. */
const MULTI_WORD = "technicianId";

const src = (platform: string) => `
system FieldOps {
  user { id: string  email: string  role: string  ${MULTI_WORD}: string }
  auth { provider: keycloak  oidc { issuer: env("I")  clientId: env("C") } }
  subdomain Ops {
    context Work {
      aggregate Job with crudish { title: string  derived display: string = title }
      repository Jobs for Job { }
    }
  }
  storage p { type: postgres }
  resource r { for: Work, kind: state, use: p }
  api OpsApi from Ops
  deployable api { platform: ${platform}, contexts: [Work], dataSources: [r], serves: OpsApi, auth: required, port: 3000 }
}
`;

/** Every claim-path string literal the emitted auth code reads, across
 *  whatever file extension the backend uses. */
function claimLiterals(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, text] of files) {
    // `auth` can be a DIRECTORY (node `api/auth/oidc.ts`, .NET `Auth/`) or a
    // FILE (elixir `api_web/auth.ex`) — matching only the directory form
    // silently skipped elixir, which is the backend this gate exists for.
    if (!/(^|\/)[Aa]uth[^/]*(\/|\.[a-z]+$)/.test(path)) continue;
    // The per-backend accessor names differ; the ARGUMENT is what matters.
    for (const m of text.matchAll(
      /(?:_claim|get_claim|claim|ClaimString|claimStringOrEmpty|claimString)\s*\(\s*\w+\s*,\s*"([^"]+)"/g,
    )) {
      out.push(m[1]!);
    }
  }
  return out;
}

const BACKENDS = ["node", "python", "elixir", "dotnet", "java"] as const;

describe("every backend reads the same IdP claim name for a declared field", () => {
  it.each(BACKENDS)("%s", async (platform) => {
    const files = await generateSystemFiles(src(platform));
    const literals = claimLiterals(files);
    // Non-vacuity first: a matcher that found no claim reads at all would make
    // the assertion below pass for every backend while checking nothing.
    expect(literals, `${platform}: no claim reads found in the emitted auth code`).not.toEqual([]);
    expect(literals, `${platform}: reads 'sub' for the id field`).toContain("sub");
    // The point of the gate.
    expect(
      literals,
      `${platform} reads a different claim name than its siblings — the IdP mints one token`,
    ).toContain(MULTI_WORD);
    // …and must NOT read the snake_cased spelling, which is what the drifted
    // copies emitted.  Asserting only "contains technicianId" would pass on a
    // backend that reads BOTH.
    expect(literals).not.toContain("technician_id");
  }, 60_000);

  it("an explicit `claims:` mapping still wins on every backend", async () => {
    // The escape hatch must keep working — it is how an author says the IdP
    // really does spell the claim differently.
    for (const platform of BACKENDS) {
      const withMapping = src(platform).replace(
        'clientId: env("C") }',
        `clientId: env("C") }\n  claims: { ${MULTI_WORD}: "tech_id" }`,
      );
      const literals = claimLiterals(await generateSystemFiles(withMapping));
      expect(literals, `${platform}: explicit mapping ignored`).toContain("tech_id");
      expect(literals, `${platform}: default used despite a mapping`).not.toContain(MULTI_WORD);
    }
  }, 120_000);
});
