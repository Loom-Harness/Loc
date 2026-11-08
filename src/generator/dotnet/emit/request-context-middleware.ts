import { wireStatus } from "../../../ir/enrich/wire-policy.js";
import { SpanAttr } from "../../_obs/tracing.js";
import { csCodeInit, csSentence, csTitle } from "../wire-policy-cs.js";

// Births the ambient RequestContext at the HTTP edge.  Mounted FIRST
// (before RequestLoggingMiddleware and UserMiddleware) so the root frame
// covers the entire pipeline — including bypassed (/health, /swagger) and
// unauthenticated paths.  The principal is attached one step later by
// UserMiddleware; the logger slice by ExecutionContextBehavior.  See
// docs/architecture/request-context.md (seam 1: boundary establishment).

/** Render `Middleware/RequestContextMiddleware.cs`. */
export function renderRequestContextMiddleware(
  ns: string,
  opts?: { hasVersioned?: boolean },
): string {
  const hasVersioned = !!opts?.hasVersioned;
  // Optimistic concurrency (`versioned`): parse the client's `If-Match`
  // precondition (a bare or quoted integer version) onto the ambient carrier,
  // so a versioned aggregate's repository save can guard the write on it.  Read
  // here beside the correlation id / locale — the one place the carrier reads
  // request headers.  Emitted only when some in-scope aggregate is `versioned`.
  // The header's grammar (RFC 9110 13.1.1): `*` (no precondition), a strong tag
  // `"3"`, a weak tag `W/"3"`, or a bare `3`.  Anything else on a mutating
  // request is a client error, answered 400 before any handler runs.
  const ifMatchLines = hasVersioned
    ? `
        if (ctx.Request.Headers.TryGetValue("If-Match", out var __ifMatch)
            && !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method)
            && !HttpMethods.IsOptions(ctx.Request.Method))
        {
            var __rawIfMatch = __ifMatch.ToString().Trim();
            if (__rawIfMatch != "*")
            {
                if (!TryParseIfMatch(__rawIfMatch, out var __expectedVersion))
                {
                    await WriteMalformedIfMatchAsync(ctx, __ifMatch.ToString());
                    return;
                }
                rootFrame.ExpectedVersion = __expectedVersion;
            }
        }`
    : "";
  const ifMatchMembers = hasVersioned
    ? `
    /// <summary>The version in an entity-tag: a strong tag <c>"3"</c>, a weak tag
    /// <c>W/"3"</c> or a bare <c>3</c>.  False for anything else.</summary>
    private static bool TryParseIfMatch(string raw, out int tagged)
    {
        tagged = 0;
        var tag = raw.StartsWith("W/", StringComparison.Ordinal) ? raw[2..] : raw;
        if (tag.Length >= 2 && tag[0] == '\\"' && tag[^1] == '\\"') tag = tag[1..^1];
        if (tag.Length == 0) return false;
        foreach (var c in tag) if (!char.IsAsciiDigit(c)) return false;
        return int.TryParse(tag, out tagged);
    }

    /// <summary>RFC 7807 400 for an <c>If-Match</c> that is not an entity-tag over a version.</summary>
    private static async Task WriteMalformedIfMatchAsync(HttpContext ctx, string header)
    {
        ctx.Response.StatusCode = ${wireStatus("malformed-if-match")};
        await ctx.Response.WriteAsJsonAsync(new Microsoft.AspNetCore.Mvc.ProblemDetails
        {
            Type = "about:blank",
            Title = ${csTitle("malformed-if-match")},
            Status = ${wireStatus("malformed-if-match")},
            Detail = ${csSentence("malformed-if-match", "{header}")},
            Instance = ctx.Request.Path,
            ${csCodeInit("malformed-if-match")},
        }, (System.Text.Json.JsonSerializerOptions?)null, "application/problem+json");
    }
`
    : "";
  return `// Auto-generated.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using ${ns}.Domain.Common;

namespace ${ns}.Middleware;

/// <summary>
/// Establishes the request-stable tier of <see cref="RequestContext"/> and
/// opens the root frame for the duration of the request: a correlation id
/// taken from an inbound <c>X-Correlation-Id</c> / <c>X-Request-Id</c>
/// header or freshly minted (never derived from a sampled trace id), the
/// request locale from <c>Accept-Language</c>, and the start timestamp.
///
/// The correlation id is echoed on the <c>X-Correlation-Id</c> response
/// header so callers (and intermediary proxies) can correlate, and a
/// logging scope carries it onto every log line emitted under the request
/// — including the request_start / request_end access log, which is
/// mounted inside this scope — without touching the cross-backend log
/// catalog (the id rides as a structured scope property).
/// </summary>
public sealed class RequestContextMiddleware
{
    private readonly RequestDelegate _next;

    public RequestContextMiddleware(RequestDelegate next)
    {
        _next = next;
    }
${ifMatchMembers}
    public async Task InvokeAsync(HttpContext ctx, ILogger<RequestContextMiddleware> log)
    {
        var correlationId =
            ctx.Request.Headers.TryGetValue("X-Correlation-Id", out var cid) && !string.IsNullOrEmpty(cid)
                ? cid.ToString()
                : ctx.Request.Headers.TryGetValue("X-Request-Id", out var rid) && !string.IsNullOrEmpty(rid)
                    ? rid.ToString()
                    : Guid.NewGuid().ToString();
        var locale =
            ctx.Request.Headers.TryGetValue("Accept-Language", out var al) && !string.IsNullOrEmpty(al)
                ? al.ToString()
                : "en";
        // Echo the correlation id back to the caller.  Set before _next so
        // it lands before the response headers are sent.
        ctx.Response.Headers["X-Correlation-Id"] = correlationId;
        var rootFrame = RequestContext.OpenRoot(correlationId, locale, DateTimeOffset.UtcNow);${ifMatchLines}
        // Project the frame onto the request's OTel SERVER span: the
        // AspNetCore instrumentation started Activity.Current before this
        // middleware, so stamp the loom.* ids onto it, and thread its
        // trace_id/span_id onto the log scope so every request-scoped line
        // joins to its trace (log<->trace correlation).
        var activity = Activity.Current;
        activity?.SetTag("${SpanAttr.correlationId}", correlationId);
        activity?.SetTag("${SpanAttr.scopeId}", rootFrame.ScopeId);
        using (RequestContext.Enter(rootFrame))
        using (log.BeginScope(new Dictionary<string, object?>
        {
            ["correlationId"] = correlationId,
            ["scopeId"] = rootFrame.ScopeId,
            ["traceId"] = activity?.TraceId.ToString(),
            ["spanId"] = activity?.SpanId.ToString(),
        }))
        {
            await _next(ctx);
        }
    }
}
`;
}
