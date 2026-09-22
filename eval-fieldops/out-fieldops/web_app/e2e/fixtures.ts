// Auto-generated.
import { test as base, expect } from "@playwright/test";

// biome-ignore lint/suspicious/noConfusingVoidType: Playwright fixtures use `void` to mean "no value".
export const test = base.extend<{ _consoleCapture: void }>({
  _consoleCapture: [
    async ({ page }, use, testInfo) => {
      const lines: string[] = [];
      const bodies: Promise<void>[] = [];
      page.on("console", (msg) => lines.push(`[${msg.type()}] ${msg.text()}`));
      page.on("pageerror", (err) =>
        lines.push(`[pageerror] ${err.stack ?? err.message}`),
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
                `[http ${res.status()}] ${res.request().method()} ` +
                  `${new URL(res.url()).pathname} → ${body.slice(0, 800)}`,
              );
            })
            .catch(() => {}),
        );
      });
      page.on("requestfailed", (req) =>
        lines.push(
          `[requestfailed] ${req.method()} ${req.url()} — ` +
            `${req.failure()?.errorText ?? "unknown"}`,
        ),
      );
      await use();
      await Promise.all(bodies);
      if (testInfo.status !== testInfo.expectedStatus && lines.length > 0) {
        const detail = lines.slice(-40).join("\n");
        await testInfo.attach("console-logs", {
          body: lines.join("\n"),
          contentType: "text/plain",
        });
        // A diagnostic reported only on the happy path is not a diagnostic.
        // The attachment is invisible to everything that reads the JSON
        // report (every harness rollup, every CI summary), which sees only
        // the thrown error — so the collected cause rides on the error too.
        const first = testInfo.errors[0];
        if (first && !(first.message ?? "").includes("Browser diagnostics")) {
          first.message = `${first.message ?? ""}\n\nBrowser diagnostics:\n${detail}`;
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
