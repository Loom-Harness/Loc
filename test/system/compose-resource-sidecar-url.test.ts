// H-27 (helpdesk eval): a sidecar-backed resource dials its STORAGE's compose
// service.  `resource mail { kind: mailer, use: mailServer }` used to default
// to `smtp://mail:1025` (node — the RESOURCE name) or `smtp://localhost:1025`
// (the rest) while compose named the Mailpit service `mail_server` and set no
// `MAIL_URL`, so every `mail.send` in the dev stack failed `ENOTFOUND`.  The
// same drift hit the rabbitmq queue client (`amqp://…@salesJobs:5672`), and
// python read the queue/api URL from `<RESOURCE>` instead of `<RESOURCE>_URL`.
//
// The pin, per backend: compose (a) runs a service named after the storage,
// (b) injects `<RESOURCE>_URL` pointing at it, and (c) every connection
// literal the backend bakes as its fallback is that same URL — and the backend
// reads that same variable name.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system RC {
  subdomain D {
    context Sales {
      aggregate Order with crudish { name: string }
      repository Orders for Order { }
      workflow archive {
        create(name: string) {
          salesJobs.enqueue(name)
          mail.send(name, "Order archived", "Archived.")
        }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  storage jobQueue { type: rabbitmq }
  storage mailServer { type: smtp, config: { from: "no-reply@rc.test" } }
  resource salesState { for: Sales, kind: state, use: pg }
  resource salesJobs { for: Sales, kind: queue, use: jobQueue }
  resource mail { for: Sales, kind: mailer, use: mailServer }
  deployable d {
    platform: ${platform}
    contexts: [Sales]
    dataSources: [salesState, salesJobs, mail]
    serves: A
    port: 4000
  }
}
`;

/** The `environment:` map of compose service `svc`. */
function serviceEnv(compose: string, svc: string): Map<string, string> {
  const block = compose.split(/\n(?=\S)|\n {2}(?=\S)/).find((b) => b.startsWith(`${svc}:`));
  const env = new Map<string, string>();
  for (const m of (block ?? "").matchAll(/^ {6}([A-Z0-9_]+): "?([^"\n]*)"?$/gm)) {
    env.set(m[1]!, m[2]!);
  }
  return env;
}

const CASES = [
  {
    kind: "mailer",
    envVar: "MAIL_URL",
    svc: "mail_server",
    url: "smtp://mail_server:1025",
    scheme: "smtp",
  },
  {
    kind: "queue",
    envVar: "SALES_JOBS_URL",
    svc: "job_queue",
    url: "amqp://guest:guest@job_queue:5672",
    scheme: "amqp",
  },
] as const;

describe.each([
  "node",
  "dotnet",
  "java",
  "python",
  "elixir",
])("sidecar resource address — %s", (platform) => {
  it.each(CASES)("$kind: compose service == injected URL host == client fallback", async (c) => {
    const files = await generateSystemFiles(src(platform));
    const compose = files.get("docker-compose.yml")!;
    // (a) the sidecar is named after the storage
    expect(compose).toMatch(new RegExp(`^  ${c.svc}:$`, "m"));
    // (b) the backend's service gets <RESOURCE>_URL at that sidecar, and waits for it
    const env = serviceEnv(compose, "d");
    expect(env.get(c.envVar)).toBe(c.url);
    const dBlock = compose.slice(compose.indexOf("\n  d:\n"));
    expect(dBlock.slice(0, dBlock.indexOf("environment:"))).toContain(`    ${c.svc}:`);
    // (c) every baked fallback for this scheme in the backend's tree is that URL,
    //     and the backend reads the variable compose writes
    const backend = [...files].filter(([k]) => k.startsWith("d/") && !k.includes("/test"));
    const literals = backend.flatMap(([, v]) =>
      [...v.matchAll(new RegExp(`${c.scheme}://[^"'\\s)]+`, "g"))].map((m) => m[0]),
    );
    expect(literals.length).toBeGreaterThan(0);
    expect(new Set(literals)).toEqual(new Set([c.url]));
    const reader = backend.find(([, v]) => v.includes(c.url))![1];
    expect(reader).toMatch(new RegExp(`["._]${c.envVar}\\b|"${c.envVar}"`));
  });
});

// The same seam for an external `api` resource: compose injects nothing (the
// address is the authored `baseUrl`), but an operator's override must land on
// the `<RESOURCE>_URL` every other backend reads — python read bare `CRM`.
describe.each([
  "node",
  "dotnet",
  "java",
  "python",
  "elixir",
])("external api resource env var — %s", (platform) => {
  it("reads <RESOURCE>_URL", async () => {
    const ddd = src(platform)
      .replace(
        "storage pg { type: postgres }",
        `storage pg { type: postgres }\n  storage crmApi { type: restApi, config: { baseUrl: "http://crm.example:9000" } }\n  resource crm { for: Sales, kind: api, use: crmApi }`,
      )
      .replace("dataSources: [salesState, salesJobs, mail]", "dataSources: [salesState, crm]")
      .replace(
        /salesJobs\.enqueue\(name\)\n\s*mail\.send\([^\n]*\)/,
        `let info = crm.get("/customers")`,
      );
    const files = await generateSystemFiles(ddd);
    const reader = [...files].find(
      ([k, v]) => k.startsWith("d/") && v.includes('"http://crm.example:9000"'),
    );
    expect(reader?.[1]).toMatch(/["._]CRM_URL\b/);
  });
});
