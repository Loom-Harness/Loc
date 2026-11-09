// The dev-stub verifier is a development login, on every backend.
//
// (1) Without an `auth { oidc }` block, an `auth: required` deployable gets the
//     dev stub — but it answers only when LOOM_DEV_AUTH=1.  Off, every request
//     is refused (401, a forged `x-loom-dev-claims` header included) and the
//     app logs one `auth_dev_stub_disabled` line at boot.  The generated dev
//     docker-compose.yml switches it on, so a local stack still works.
// (2) With an `auth { oidc }` block, exactly one verifier exists and it is the
//     fail-closed OIDC one: .NET and Java emit neither the stub class nor its
//     registration (a DI reorder or a dropped `@Primary` must not be able to put
//     a header-trusting verifier in front of a production deployable).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];

const fixture = (name: string, platform: string): string =>
  readFileSync(join(__dirname, "../fixtures/corpus", `${name}.ddd`), "utf8").replaceAll(
    "__PLATFORM__",
    platform,
  );

const all = (files: Map<string, string>, under = ""): string =>
  [...files.entries()]
    .filter(([p]) => p.startsWith(under) && !p.includes(".loom/"))
    .map(([p, src]) => `// ==== ${p}\n${src}`)
    .join("\n");

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ends with ${suffix}`);
  return hit[1];
};

/** Per backend: the text that gates the stub on LOOM_DEV_AUTH, and the boot
 *  line that says it is off. */
const GATE: Record<Backend, { gate: string[]; offLog: string }> = {
  node: {
    gate: [
      'const devAuth = opts.verifier === "dev-stub" || process.env.LOOM_DEV_AUTH === "1";',
      "registerDevStubVerifier(devAuth);",
      "if (!enabled) return null;",
    ],
    offLog: 'baseLogger.error({ event: "auth_dev_stub_disabled"',
  },
  dotnet: {
    gate: [
      'Environment.GetEnvironmentVariable("LOOM_DEV_AUTH") == "1";',
      "if (!Enabled)\n        {\n            return Task.FromResult<User?>(null);",
    ],
    offLog: '"auth_dev_stub_disabled"',
  },
  java: {
    gate: [
      'static final boolean ENABLED = "1".equals(System.getenv("LOOM_DEV_AUTH"));',
      "if (!ENABLED) return null;",
    ],
    offLog: 'CatalogLog.event("auth_dev_stub_disabled", "error"',
  },
  python: {
    gate: [
      '_DEV_AUTH = os.environ.get("LOOM_DEV_AUTH") == "1"',
      "if not _DEV_AUTH:\n        return None",
    ],
    offLog: 'log("error", "auth_dev_stub_disabled"',
  },
  elixir: {
    gate: [
      'def dev_auth?, do: System.get_env("LOOM_DEV_AUTH") == "1"',
      "if dev_auth?(), do: {:ok, dev_claims()}, else: {:error, :dev_auth_off}",
    ],
    offLog: 'Logger.error("auth_dev_stub_disabled"',
  },
};

describe("dev stub — on only under LOOM_DEV_AUTH=1 (no auth { oidc } block)", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: the stub is gated, the off state is logged, dev compose switches it on`, async () => {
      const files = await generateSystemFiles(fixture("auth-simple", platform));
      const src = all(files, "d/");
      for (const g of GATE[platform].gate) expect(src, `${platform} lacks: ${g}`).toContain(g);
      expect(src).toContain(GATE[platform].offLog);
      expect(file(files, "docker-compose.yml")).toContain('LOOM_DEV_AUTH: "1"');
    });
  }

  // The node stub, EXECUTED: off, it refuses a request with no header AND one
  // forging an admin principal through the header; on, it accepts the forgery.
  describe("node: the emitted stub, executed", () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    async function load(): Promise<{
      stub: { registerDevStubVerifier(enabled: boolean): void };
      verify: (header?: string) => Promise<unknown>;
    }> {
      const files = await generateSystemFiles(fixture("auth-simple", "node"));
      dir = mkdtempSync(join(tmpdir(), "loom-dev-auth-"));
      for (const name of ["dev-stub", "verifier"]) {
        const out = ts.transpileModule(file(files, `auth/${name}.ts`), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        writeFileSync(join(dir, `${name}.js`), out);
      }
      writeFileSync(join(dir, "user-types.js"), "");
      const req = createRequire(join(dir, "index.js"));
      const verifier = req("./verifier.js");
      const verify = (header?: string) =>
        verifier.verifyUserOrThrow(
          new Request(
            "http://x/",
            header === undefined ? {} : { headers: { "x-loom-dev-claims": header } },
          ),
        );
      return { stub: req("./dev-stub.js"), verify };
    }
    const forged = Buffer.from(JSON.stringify({ role: "finance-admin" }), "utf8").toString(
      "base64",
    );

    it("off: no token and a forged header are both refused", async () => {
      const { stub, verify } = await load();
      stub.registerDevStubVerifier(false);
      await expect(verify()).rejects.toThrow("unauthorized");
      await expect(verify(forged)).rejects.toThrow("unauthorized");
    });

    it("on: the built-in identity, with the header merged over it", async () => {
      const { stub, verify } = await load();
      stub.registerDevStubVerifier(true);
      await expect(verify()).resolves.toMatchObject({ role: "admin" });
      await expect(verify(forged)).resolves.toMatchObject({ role: "finance-admin" });
    });
  });
});

describe("auth { oidc } — exactly one, fail-closed verifier", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: no dev-stub verifier is registered; compose does not switch it on`, async () => {
      const files = await generateSystemFiles(fixture("auth-id-claim-foreign", platform));
      expect(file(files, "docker-compose.yml")).not.toContain("LOOM_DEV_AUTH");
      for (const dep of ["agents/", "payments/"]) {
        const src = all(files, dep);
        if (platform === "node") {
          // The playground preview's dev stub: only boot.ts imports it, behind
          // the host-only `verifier: "dev-stub"` option the server never sets.
          expect(file(files, `${dep}boot.ts`)).toContain('if (opts.verifier === "dev-stub") {');
          continue;
        }
        expect(src, `${platform}/${dep}`).not.toContain("LOOM_DEV_AUTH");
        // The stub class, its malformed-header exception, its registration.
        expect(src, `${platform}/${dep}`).not.toMatch(
          /DevStub|_dev_stub_verifier|MalformedDevClaimsException|dev_user/,
        );
      }
    });
  }

  it("dotnet: Program.cs registers the OIDC verifier and nothing else", async () => {
    const files = await generateSystemFiles(fixture("auth-id-claim-foreign", "dotnet"));
    const program = file(files, "agents/Program.cs");
    expect(program.match(/^builder\.Services\.AddScoped<IUserVerifier, \w+>\(\);$/gm)).toEqual([
      "builder.Services.AddScoped<IUserVerifier, OidcUserVerifier>();",
    ]);
  });

  it("java: OidcUserVerifier is the only UserVerifier bean", async () => {
    const files = await generateSystemFiles(fixture("auth-id-claim-foreign", "java"));
    const beans = [...files.entries()]
      .filter(([p, src]) => p.startsWith("agents/") && /implements UserVerifier\b/.test(src))
      .map(([p]) => p.split("/").pop());
    expect(beans).toEqual(["OidcUserVerifier.java"]);
  });
});
