// OpenTelemetry tracing (M-T7.1): the .NET backend registers AspNetCore
// instrumentation (a SERVER span per request) with a conditional OTLP/HTTP
// exporter, stamps the loom.* execution-context ids onto Activity.Current,
// and threads the span's trace_id/span_id onto the log scope so every
// request-scoped line joins to its trace.  The runtime contract is gated by
// observability-events-dotnet.test.ts (LOOM_OBS_E2E_DOTNET=1); this pins the
// emitter shape.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateBackendFiles } from "../../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

/** The `.NET` project for a bare-context example, hosted on one deployable. */
function generateExample(file: string): Promise<Map<string, string>> {
  return generateBackendFiles(readFileSync(path.join(repoRoot, file), "utf8"), "dotnet");
}

describe(".NET OpenTelemetry tracing", () => {
  it("registers AspNetCore instrumentation + conditional OTLP export", async () => {
    const files = await generateExample("examples/sales.ddd");
    const program = files.get("Program.cs")!;
    expect(program).toContain("builder.Services.AddOpenTelemetry()");
    expect(program).toContain(".WithTracing(");
    expect(program).toContain("t.AddAspNetCoreInstrumentation();");
    // Export is env-gated: the OTLP exporter is wired only when the endpoint
    // env is set (a span is still created every request so trace_id rides logs).
    expect(program).toContain('GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT")');
    expect(program).toContain("if (!string.IsNullOrWhiteSpace(otlpEndpoint))");
    expect(program).toContain("t.AddOtlpExporter(");
    expect(program).toContain("OtlpExportProtocol.HttpProtobuf");
    // service.name honours OTEL_SERVICE_NAME (compose sets the slug).
    expect(program).toContain('GetEnvironmentVariable("OTEL_SERVICE_NAME")');
  });

  it("stamps the loom ids onto the span + threads trace_id/span_id onto the log scope", async () => {
    const files = await generateExample("examples/sales.ddd");
    const mw = files.get("Middleware/RequestContextMiddleware.cs")!;
    expect(mw).toContain("var activity = Activity.Current;");
    expect(mw).toContain('activity?.SetTag("loom.correlation_id", correlationId);');
    expect(mw).toContain('activity?.SetTag("loom.scope_id", rootFrame.ScopeId);');
    // trace_id / span_id ride the BeginScope dict (the .NET carrier's Scopes
    // array — the same channel scopeId rides).
    expect(mw).toContain('["traceId"] = activity?.TraceId.ToString(),');
    expect(mw).toContain('["spanId"] = activity?.SpanId.ToString(),');
  });

  it("pins the OTel package references on the csproj", async () => {
    const files = await generateExample("examples/sales.ddd");
    // System mode names the project after the deployable (`app`), not the context.
    const csproj = files.get("App.csproj")!;
    expect(csproj).toContain('Include="OpenTelemetry.Extensions.Hosting"');
    expect(csproj).toContain('Include="OpenTelemetry.Instrumentation.AspNetCore"');
    expect(csproj).toContain('Include="OpenTelemetry.Exporter.OpenTelemetryProtocol"');
  });
});
