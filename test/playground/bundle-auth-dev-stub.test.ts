import { describe, expect, it } from "vitest";
import { devStubEntryFor, makeEntryStdin, schemaPathFor } from "../../web/src/bundle/plugin.js";
import { generateSystemFiles } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// The playground's synthesised bundle entry registers the emitted DEV-STUB
// verifier (#2571).
//
// The preview boots a generated backend through `createApp` (http/index.ts),
// NOT through the generated `index.ts` — that is what keeps one drizzle
// instance in play. But `createApp` calls `assertUserVerifierRegistered()` on
// an `auth: required` deployable, and only `index.ts` registers one. So every
// `auth: required` system died at boot with
//
//   createApp failed: No user verifier is registered.
//
// while the Auth panel advertised the opposite by sending `x-loom-dev-claims`
// on every request. Nothing caught it because the one playground example with
// `auth: required` targets `platform: dotnet` — files-only, never booted.
//
// The registration rides the entry (module-evaluation order puts it before the
// worker's `createApp` call), keyed off the emitted `auth/dev-stub.ts` that
// #2561 split out for exactly this reason.
// ---------------------------------------------------------------------------

const HONO_ENTRY = "d/http/index.ts";

/** The emitted file map as the engine builds it: keys are ABSOLUTE
 *  (`"/" + path`), which is the half that makes the lookup subtle. */
function vfs(paths: string[]): Map<string, string> {
  return new Map(paths.map((p) => [`/${p}`, ""]));
}

const AUTH_FILES = [
  "d/http/index.ts",
  "d/db/schema.ts",
  "d/auth/verifier.ts",
  "d/auth/middleware.ts",
  "d/auth/dev-stub.ts",
];

describe("devStubEntryFor", () => {
  it("finds the dev stub beside the deployable's http entry", () => {
    expect(devStubEntryFor(vfs(AUTH_FILES), HONO_ENTRY)).toBe("d/auth/dev-stub.ts");
  });

  // The bug this helper exists to prevent: the virtual fs is keyed by absolute
  // path while the entry path is relative, so a lookup that forgets the `/`
  // answers "absent" for a file that is present — and the registration silently
  // never happens, which looks exactly like the fix working.
  it("resolves against the ABSOLUTE vfs keys, not the relative entry path", () => {
    const relativeKeyed = new Map(AUTH_FILES.map((p) => [p, ""]));
    expect(devStubEntryFor(vfs(AUTH_FILES), HONO_ENTRY)).toBeDefined();
    expect(devStubEntryFor(relativeKeyed, HONO_ENTRY)).toBeUndefined();
  });

  it("is undefined for an auth-less deployable", () => {
    expect(devStubEntryFor(vfs(["d/http/index.ts", "d/db/schema.ts"]), HONO_ENTRY)).toBeUndefined();
  });

  // An `auth { oidc }` deployable emits the dev stub beside `auth/oidc.ts`: its
  // verifier validates against the IdP's JWKS, and no IdP is reachable from the
  // preview worker, so the preview registers the stub instead.
  it("finds the dev stub of an OIDC deployable too", () => {
    const oidc = vfs([
      "d/http/index.ts",
      "d/db/schema.ts",
      "d/auth/verifier.ts",
      "d/auth/oidc.ts",
      "d/auth/dev-stub.ts",
    ]);
    expect(devStubEntryFor(oidc, HONO_ENTRY)).toBe("d/auth/dev-stub.ts");
  });
});

describe("makeEntryStdin", () => {
  it("registers the dev stub BEFORE createApp can be reached", () => {
    const entry = makeEntryStdin(HONO_ENTRY, schemaPathFor(HONO_ENTRY), "d/auth/dev-stub.ts");
    expect(entry).toContain('import { registerDevStubVerifier } from "./d/auth/dev-stub.ts";');
    expect(entry).toContain("registerDevStubVerifier();");
    // Order is the whole point: the call is top-level, so it runs at module
    // evaluation — before the worker calls the exported `createApp`.
    expect(entry.indexOf("registerDevStubVerifier();")).toBeLessThan(
      entry.indexOf("export { createApp }"),
    );
  });

  it("is byte-identical to the pre-auth entry when there is no dev stub", () => {
    expect(makeEntryStdin(HONO_ENTRY, schemaPathFor(HONO_ENTRY), undefined)).toBe(
      [
        'export { createApp } from "./d/http/index.ts";',
        'export * as schema from "./d/db/schema.ts";',
        'export { drizzle } from "drizzle-orm/pglite";',
        'export { PGlite } from "@electric-sql/pglite";',
        'export { is, Table } from "drizzle-orm";',
        'export { getTableConfig } from "drizzle-orm/pg-core";',
        "",
      ].join("\n"),
    );
  });
});

// The chain end to end on a real generated tree: an `auth { oidc }` system's
// Hono deployable carries a dev stub the preview entry finds and registers.
// Without it the preview cannot boot such a system at all (`createApp` asserts
// a verifier is registered), and the user is told to stand up a real IdP.
describe("an auth { oidc } system in the preview", () => {
  const OIDC_SYSTEM = `
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: opt  provider: auth0  oidc { issuer: "https://helpdesk.eu.auth0.com/"  clientId: env("OIDC_CLIENT_ID") } }
  subdomain Support {
    context Tickets {
      aggregate Ticket with crudish { subject: string }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SApi from Support
  deployable d { platform: node contexts: [Tickets] serves: SApi dataSources: [st] port: 4000 auth: required }
}`;

  it("registers the emitted dev stub at the preview entry", async () => {
    const files = await generateSystemFiles(OIDC_SYSTEM);
    expect(files.has("d/auth/oidc.ts"), "the generated app still verifies OIDC").toBe(true);
    const vfsFiles = new Map([...files].map(([p, c]) => [`/${p}`, c]));
    const stub = devStubEntryFor(vfsFiles, HONO_ENTRY);
    expect(stub).toBe("d/auth/dev-stub.ts");
    expect(makeEntryStdin(HONO_ENTRY, schemaPathFor(HONO_ENTRY), stub)).toContain(
      "registerDevStubVerifier();",
    );
  });
});
