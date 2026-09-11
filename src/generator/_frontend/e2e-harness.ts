// Playwright e2e harness scaffolding — framework-neutral (the specs
// drive the browser through testid-keyed page objects); shared by the
// React and Svelte frontends.  Extracted from
// src/generator/react/emit-templates.ts.

export const E2E_FIXTURES_TS = `// Auto-generated.
import { test as base, expect } from "@playwright/test";

// biome-ignore lint/suspicious/noConfusingVoidType: Playwright fixtures use \`void\` to mean "no value".
export const test = base.extend<{ _consoleCapture: void }>({
  _consoleCapture: [
    async ({ page }, use, testInfo) => {
      const lines: string[] = [];
      const bodies: Promise<void>[] = [];
      page.on("console", (msg) => lines.push(\`[\${msg.type()}] \${msg.text()}\`));
      page.on("pageerror", (err) =>
        lines.push(\`[pageerror] \${err.stack ?? err.message}\`),
      );
      // The browser's own console line for a rejected call is
      // "Failed to load resource: … status of 422" — it names neither the
      // endpoint nor the reason, so a failed write reads as a mystery timeout
      // ten seconds later.  Record method + path + status + response BODY for
      // every non-OK call instead, so the server's rejection says which field
      // it refused.
      page.on("response", (res) => {
        if (res.status() < 400) return;
        bodies.push(
          res
            .text()
            .then((body) => {
              lines.push(
                \`[http \${res.status()}] \${res.request().method()} \` +
                  \`\${new URL(res.url()).pathname} → \${body.slice(0, 800)}\`,
              );
            })
            .catch(() => {}),
        );
      });
      page.on("requestfailed", (req) =>
        lines.push(
          \`[requestfailed] \${req.method()} \${req.url()} — \` +
            \`\${req.failure()?.errorText ?? "unknown"}\`,
        ),
      );
      await use();
      await Promise.all(bodies);
      if (testInfo.status !== testInfo.expectedStatus && lines.length > 0) {
        const detail = lines.slice(-40).join("\\n");
        await testInfo.attach("console-logs", {
          body: lines.join("\\n"),
          contentType: "text/plain",
        });
        // A diagnostic reported only on the happy path is not a diagnostic.
        // The attachment is invisible to everything that reads the JSON
        // report (every harness rollup, every CI summary), which sees only
        // the thrown error — so the collected cause rides on the error too.
        const first = testInfo.errors[0];
        if (first && !(first.message ?? "").includes("Browser diagnostics")) {
          first.message = \`\${first.message ?? ""}\\n\\nBrowser diagnostics:\\n\${detail}\`;
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
`;

export const PLAYWRIGHT_CONFIG_TS = `// Auto-generated.
import { defineConfig, devices } from "@playwright/test";

// Tests target a running web_app — typically the docker-compose
// service on port 3001.  Override via E2E_BASE_URL.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\\.spec\\.ts$/,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    // Keep the full trace (console + network + DOM snapshots) and a
    // screenshot on every failure so a red test is debuggable from the
    // report alone, alongside the console-logs attachment from fixtures.ts.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
`;

// The Playwright suite has its own package.json so the runtime image
// builds fast (no @playwright/test in the production install).  Run
// it from inside ./e2e with `npm install && npx playwright test`.
export const E2E_PACKAGE_JSON =
  JSON.stringify(
    {
      name: "loom-react-app-e2e",
      version: "0.0.0",
      type: "module",
      private: true,
      scripts: {
        test: "playwright test",
        "test:install": "playwright install --with-deps chromium",
      },
      devDependencies: {
        "@playwright/test": "^1.49.0",
        "@types/node": "^22.0.0",
        typescript: "^6.0.0",
      },
    },
    null,
    2,
  ) + "\n";

/** Same harness manifest under the SvelteKit project's name.  The
 *  react constant keeps its original name + bytes (the react output
 *  is byte-identity-gated); svelte projects get an honestly-named
 *  package. */
export const E2E_PACKAGE_JSON_SVELTE = E2E_PACKAGE_JSON.replace(
  '"loom-react-app-e2e"',
  '"loom-svelte-app-e2e"',
);

/** Same harness manifest under the Angular project's name.  The Angular
 *  smoke spec + page objects drive the browser through the same
 *  testid-keyed, framework-neutral runtime as React/Svelte/Vue, so the
 *  only divergence from the base manifest is an honestly-named package
 *  (the React constant keeps its bytes — React output is byte-identity
 *  gated). */
export const E2E_PACKAGE_JSON_ANGULAR = E2E_PACKAGE_JSON.replace(
  '"loom-react-app-e2e"',
  '"loom-angular-app-e2e"',
);

/** Phoenix/LiveView harness manifest — honestly-named package (same
 *  framework-neutral, testid-keyed Playwright runtime as the SPAs; the
 *  React constant keeps its bytes for the byte-identity gate). */
export const E2E_PACKAGE_JSON_PHOENIX = E2E_PACKAGE_JSON.replace(
  '"loom-react-app-e2e"',
  '"loom-phoenix-app-e2e"',
);

/** Phoenix/LiveView Playwright config — identical to the SPA harness
 *  except the default baseURL targets the Phoenix server (port 4000, the
 *  `elixir` platform's `defaultPort`) rather than the vite preview port.
 *  Still overridable via E2E_BASE_URL (the compose/CI port). */
export const PLAYWRIGHT_CONFIG_TS_PHOENIX = PLAYWRIGHT_CONFIG_TS.replace(
  "// Tests target a running web_app — typically the docker-compose\n// service on port 3001.  Override via E2E_BASE_URL.",
  "// Tests target a running Phoenix/LiveView server — typically the\n// docker-compose service on port 4000.  Override via E2E_BASE_URL.",
).replace('"http://localhost:3001"', '"http://localhost:4000"');

export const E2E_TSCONFIG_JSON =
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: ["node"],
      },
      include: ["**/*.ts", "../src/api/**/*.ts"],
    },
    null,
    2,
  ) + "\n";
