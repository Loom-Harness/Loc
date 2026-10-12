// Dev-auth-stub `x-loom-dev-claims` parity across all five backends.
//
// When a deployable sets `auth: required` but the system declares no OIDC
// block, each backend emits a permissive DEV STUB verifier so the stack boots
// out of the box.  Historically only the Hono stub honoured an injected
// `x-loom-dev-claims` header (base64-JSON merged over the built-in identity) —
// the .NET/Java/Python/Elixir stubs returned a hard-coded admin and ignored
// the request.  That gap made a cross-tenant isolation e2e node-only (you
// cannot drive a distinct tenant per request without it).  This pins the
// parity: every backend's dev stub must read the header.
//
// Scope: string-typed claims only (the tenant-claim case) — a JSON string maps
// cleanly onto the principal's field; non-string fields keep their stub value.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MALFORMED_DEV_CLAIMS_DETAIL } from "../../src/generator/_auth/dev-claims.js";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string) => `
  system Shop {
    user { id: guid  tenantId: string }
    tenancy by user.tenantId of Organization
    subdomain Sales {
      context Ordering {
        aggregate Invoice with tenantOwned { number: string }
        aggregate Organization { name: string }
      }
    }
    api SalesApi from Sales
    storage primarySql { type: postgres }
    resource ordState { for: Ordering, kind: state, use: primarySql }
    deployable api {
      platform: ${platform}
      contexts: [Ordering]
      dataSources: [ordState]
      serves: SalesApi
      port: 3001
      auth: required
    }
  }
`;

const allFiles = async (platform: string): Promise<string> => {
  const files = await generateSystemFiles(system(platform));
  return [...files.values()].join("\n\n");
};

describe("dev-auth-stub x-loom-dev-claims injection parity", () => {
  for (const platform of ["node", "dotnet", "python", "java", "elixir"]) {
    it(`${platform}: dev stub reads the x-loom-dev-claims header`, async () => {
      expect(await allFiles(platform)).toContain("x-loom-dev-claims");
    });
  }
});

// The BUILT-IN identity the header above merges over (#2548).
//
// `/api/auth/me` is a contract over the DECLARED `user { … }` shape — it is what
// the generated frontends' `auth: ui` guard reads — so the dev stub must fill
// every field the block declares, and a non-optional field must never answer
// null.  Elixir used to return a fixed `%{"id", "role", "permissions"}` claim
// map that `build_user/1` then read by declared field name: a field NAMED
// `role` got "admin" by coincidence and every other declared field (the
// `tenantId` of every tenancy system among them) came back nil, while the other
// four backends filled it.  Neither half of that is derivable from the shape,
// which is why this pins the whole identity rather than the presence of a key.
//
// The value table is shared by all five: string → "admin", guid → the zero
// uuid, int/long → 0, decimal/money → zero, bool → false, datetime → the epoch,
// array → EMPTY (a permission-guarded surface denies by default), optional →
// null.  A backend's own rendering of it is per-language, so each arm pins the
// construction site verbatim (whitespace-normalised).
const identitySystem = (platform: string) => `
  system Shop {
    user { id: guid  role: string  tenantId: string }
    subdomain Sales {
      context Ordering {
        aggregate Invoice { number: string }
        repository Invoices for Invoice { }
      }
    }
    api SalesApi from Sales
    storage primarySql { type: postgres }
    resource ordState { for: Ordering, kind: state, use: primarySql }
    deployable api {
      platform: ${platform}
      contexts: [Ordering]
      dataSources: [ordState]
      serves: SalesApi
      port: 3001
      auth: required
    }
  }
`;

/** Collapse runs of whitespace so an arm pins the VALUES, not the emitter's
 *  line wrapping. */
const squash = (s: string) => s.replace(/\s+/g, " ");

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** The built-in stub identity for `user { id: guid  role: string  tenantId: string }`,
 *  as each backend spells it. */
const STUB_IDENTITY: Record<string, string> = {
  node: `id: "${ZERO_UUID}", role: "admin", tenantId: "admin",`,
  dotnet: `Id: System.Guid.Empty, Role: "admin", TenantId: "admin")`,
  python: `User(id="${ZERO_UUID}", role="admin", tenant_id="admin")`,
  java: `return new User(new UUID(0L, 0L), "admin", "admin");`,
  elixir: `"id" => "${ZERO_UUID}", "role" => "admin", "tenant_id" => "admin"`,
};

describe("dev-auth-stub built-in identity fills the declared user shape", () => {
  for (const [platform, identity] of Object.entries(STUB_IDENTITY)) {
    it(`${platform}: every declared user field carries a stub value`, async () => {
      const files = await generateSystemFiles(identitySystem(platform));
      expect(squash([...files.values()].join("\n\n"))).toContain(squash(identity));
    });
  }
});

// A PRESENT-BUT-UNDECODABLE header answers 400 (ruling D6, eval-closure #23).
//
// Every stub used to swallow a decode failure and run the request as the
// built-in identity — so a permission test that meant to run as a narrow
// principal and sent a typo'd header silently ran as the broad one and could
// false-green.  Pinned on both stub shapes: one that carries claims, and one
// with NO carryable claim (which used to not read the header at all, so it
// would ignore a malformed one by construction).
const noCarryableClaimSystem = (platform: string) => `
  system Shop {
    user { id: guid }
    subdomain Sales {
      context Ordering {
        aggregate Invoice { number: string }
        repository Invoices for Invoice { }
      }
    }
    api SalesApi from Sales
    storage primarySql { type: postgres }
    resource ordState { for: Ordering, kind: state, use: primarySql }
    deployable api {
      platform: ${platform}
      contexts: [Ordering]
      dataSources: [ordState]
      serves: SalesApi
      port: 3001
      auth: required
    }
  }
`;

/** Per backend: the stub's refusal (throw / predicate) and the 400 answer. */
const REFUSAL: Record<string, string[]> = {
  node: [
    "throw new MalformedDevClaimsError();",
    "if (err instanceof MalformedDevClaimsError) return malformedDevClaims(c, err.message);",
    "status: 400,",
  ],
  dotnet: [
    "DecodeDevClaims(injected)",
    "catch (MalformedDevClaimsException e)",
    "ctx.Response.StatusCode = 400;",
  ],
  java: [
    "decodeDevClaims(injected)",
    "} catch (MalformedDevClaimsException e) {",
    "response.setStatus(400);",
  ],
  python: [
    "_decode_dev_claims(injected)",
    "except MalformedDevClaimsError as err:",
    "status_code=400,",
  ],
  elixir: [
    "if dev_claims_malformed?(conn) and not bypass_path?(conn.request_path) do",
    "|> send_resp(400, body)",
  ],
};

/** The silent fallbacks this replaced — none may survive on any backend. */
const SILENT_FALLBACK = [
  "fall back to the built-in identity",
  "except Exception:\n        return user",
  "} catch {\n      return base;\n    }",
];

describe("dev-auth-stub refuses a malformed x-loom-dev-claims header with 400 (D6, #23)", () => {
  for (const [platform, markers] of Object.entries(REFUSAL)) {
    for (const [shape, src] of [
      ["claim-carrying stub", system(platform)],
      ["stub with no carryable claim", noCarryableClaimSystem(platform)],
    ] as const) {
      it(`${platform} (${shape}): answers 400 naming the header, never falls back`, async () => {
        const all = [...(await generateSystemFiles(src)).values()].join("\n\n");
        for (const m of markers) expect(all, `${platform} lacks: ${m}`).toContain(m);
        expect(all).toContain(MALFORMED_DEV_CLAIMS_DETAIL);
        for (const f of SILENT_FALLBACK) expect(all).not.toContain(f);
      });
    }
  }

  // The node stub, EXECUTED: transpile the emitted `auth/dev-stub.ts` +
  // `auth/verifier.ts` and drive the registered verifier with real headers, so
  // the pin is on behaviour (which header decodes, which throws), not only on
  // the emitted text.
  it("node: the emitted stub throws for undecodable / non-object headers and merges a valid one", async () => {
    const files = await generateSystemFiles(system("node"));
    const pick = (suffix: string) => [...files.entries()].find(([p]) => p.endsWith(suffix))![1];
    const dir = mkdtempSync(join(tmpdir(), "loom-dev-claims-"));
    try {
      for (const name of ["dev-stub", "verifier"]) {
        const out = ts.transpileModule(pick(`auth/${name}.ts`), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        writeFileSync(join(dir, `${name}.js`), out);
      }
      writeFileSync(join(dir, "user-types.js"), "");
      const req = createRequire(join(dir, "index.js"));
      const stub = req("./dev-stub.js");
      const verifier = req("./verifier.js");
      stub.registerDevStubVerifier();
      const call = (header?: string) =>
        verifier.verifyUserOrThrow(
          new Request(
            "http://x/",
            header === undefined ? {} : { headers: { "x-loom-dev-claims": header } },
          ),
        );
      const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

      // Absent header → the built-in identity (unchanged).
      expect((await call()).tenantId).toBe("admin");
      // A valid object → merged over the built-in identity (unchanged).
      expect((await call(b64('{"tenantId":"t-1"}'))).tenantId).toBe("t-1");
      // Present but undecodable, or decodes to a non-object → refused.
      for (const bad of [b64("{not json"), b64("[1,2]"), b64('"a string"'), b64("null"), "%%%"]) {
        await expect(call(bad), `header ${bad}`).rejects.toThrow(MALFORMED_DEV_CLAIMS_DETAIL);
        await expect(call(bad)).rejects.toBeInstanceOf(stub.MalformedDevClaimsError);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
