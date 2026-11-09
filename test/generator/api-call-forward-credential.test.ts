// A typed in-system call to an `auth: required` callee forwards the caller's
// own credential: every backend captures the inbound bearer token (or the
// `session` cookie, or the dev-stub claims header) in its request-scoped
// carrier and copies it onto the call.  A callee without `auth: required` gets
// no credential, and the caller emits none of the carrier.  A call with no
// request principal to forward is refused in phase ⑦.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const PLATFORMS = ["node", "python", "dotnet", "java", "elixir"] as const;
type Platform = (typeof PLATFORMS)[number];

const model = (opts: {
  caller: Platform;
  callerAuth: boolean;
  calleeAuth: boolean;
  reactor?: boolean;
}): string => `
system S {
  user { id: string }
  subdomain Net { context Orgs { aggregate Org with crudish { name: string }  repository Orgs for Org { } } }
  subdomain Shop { context Sales {
    aggregate Sale with crudish { label: string }
    repository Sales for Sale { }
    event Poked { org: Org id, at: datetime }
    workflow record { create(org: Org id, label: string) {
      let o = orgs.getOrgById(org)
      let s = Sale.create(label: o.name + ":" + label) } }
    ${opts.reactor ? "workflow onPoke { org: Org id  create(p: Poked) by p.org { let o = orgs.getOrgById(p.org) } }" : ""}
  } }
  api NetApi from Net
  api ShopApi from Shop
  storage pg { type: postgres }
  resource orgState { for: Orgs, kind: state, use: pg }
  resource saleState { for: Sales, kind: state, use: pg }
  resource orgs { for: Sales, kind: api, use: NetApi }
  deployable netSvc { platform: node contexts: [Orgs] dataSources: [orgState] serves: NetApi port: 3000${opts.calleeAuth ? " auth: required" : ""} }
  deployable shopSvc { platform: ${opts.caller} contexts: [Sales] dataSources: [saleState, orgs] serves: ShopApi port: 3001${opts.callerAuth ? " auth: required" : ""} }
}`;

/** The caller deployable's emitted files, joined. */
async function callerFiles(caller: Platform, calleeAuth: boolean): Promise<string> {
  const files = await generateSystemFiles(model({ caller, callerAuth: true, calleeAuth }));
  return [...files.entries()]
    .filter(([path]) => path.startsWith("shop_svc/"))
    .map(([, content]) => content)
    .join("\n\n");
}

/** One marker per backend that is present exactly when the caller forwards. */
const FORWARD_MARKERS: Record<Platform, readonly RegExp[]> = {
  node: [
    /export const forwardCallerCredential = createMiddleware\(/,
    /app\.use\("\*", forwardCallerCredential\)/,
    /headers: \{ \.\.\.callerCredentialHeaders\(\), "content-type": "application\/json" \}/,
  ],
  python: [
    /class ForwardCallerCredential:/,
    /app\.add_middleware\(ForwardCallerCredential\)/,
    /headers=caller_credential_headers\(\),/,
  ],
  dotnet: [
    /private static void ForwardCallerCredential\(HttpRequestMessage req\)/,
    /ForwardCallerCredential\(req\);/,
    /\.Resources\.ApiClients\.CallerContext = app\.Services\.GetRequiredService<Microsoft\.AspNetCore\.Http\.IHttpContextAccessor>\(\);/,
  ],
  java: [
    /private static HttpRequest\.Builder withCallerCredential\(HttpRequest\.Builder req\)/,
    /RequestContextHolder\.getRequestAttributes\(\)/,
    /var req = withCallerCredential\(HttpRequest\.newBuilder\(/,
  ],
  elixir: [
    /def caller_credential\(conn\) do/,
    /Process\.put\(:loom_caller_credential, caller_credential\(conn\)\)/,
    /headers: Process\.get\(:loom_caller_credential, \[\]\),/,
  ],
};

describe("typed api call — the caller's credential is forwarded to an auth-required callee", () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: captures the inbound credential and copies it onto the call`, async () => {
      const files = await callerFiles(platform, true);
      for (const marker of FORWARD_MARKERS[platform]) expect(files).toMatch(marker);
    });

    it(`${platform}: an open callee gets no credential, and no carrier is emitted`, async () => {
      const files = await callerFiles(platform, false);
      for (const marker of FORWARD_MARKERS[platform]) expect(files).not.toMatch(marker);
    });
  }

  it("all backends read the same headers: Authorization, else the session cookie, plus dev claims", async () => {
    for (const platform of PLATFORMS) {
      const files = await callerFiles(platform, true);
      expect(files, platform).toMatch(/"session"/);
      expect(files, platform).toMatch(/x-loom-dev-claims/);
      expect(files, platform).toMatch(/Bearer /);
    }
  });
});

async function principalDiags(source: string): Promise<string[]> {
  const { model: ast } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(ast)))
    .filter((d) => d.code === "loom.api-call-principal-unsupported")
    .map((d) => d.message);
}

describe("typed api call — a caller with no principal to forward is refused", () => {
  it("refuses a call to an auth-required callee from an event reactor", async () => {
    const diags = await principalDiags(
      model({ caller: "node", callerAuth: true, calleeAuth: true, reactor: true }),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatch(/onPoke/);
    expect(diags[0]).toMatch(/#4804/);
  });

  it("refuses binding an auth-required callee from a deployable that authenticates no one", async () => {
    const diags = await principalDiags(
      model({ caller: "node", callerAuth: false, calleeAuth: true }),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatch(/authenticates no one/);
  });

  it("accepts a reactor's call to an open callee, and a command workflow's call to a guarded one", async () => {
    expect(
      await principalDiags(
        model({ caller: "node", callerAuth: true, calleeAuth: false, reactor: true }),
      ),
    ).toEqual([]);
    expect(
      await principalDiags(model({ caller: "node", callerAuth: true, calleeAuth: true })),
    ).toEqual([]);
  });
});
