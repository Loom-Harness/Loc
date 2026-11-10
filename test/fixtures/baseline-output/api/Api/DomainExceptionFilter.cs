// Auto-generated.
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging;
using Api.Domain.Common;

namespace Api.Api;

/// <summary>
/// Maps domain-layer exceptions to structured HTTP responses.
/// Domain exceptions get a 400 / 404 with the original message;
/// any unhandled exception falls through to a generic 500 with a
/// safe message (the original is logged but not returned, so
/// internal details don't leak to API consumers).  Mirrors the
/// Hono `app.onError` shape so the cross-platform contract
/// stays in lockstep.
/// </summary>
public sealed class DomainExceptionFilter : IExceptionFilter
{
    private readonly ILogger<DomainExceptionFilter> _log;
    public DomainExceptionFilter(ILogger<DomainExceptionFilter> log) => _log = log;

    public void OnException(ExceptionContext context)
    {
        // Correlation id — ASP.NET Core sets Activity.Current
        // automatically on every request via the
        // HostingApplicationDiagnostics.  Surfacing the trace id on
        // the response lets an operator join the response back to
        // the structured log line without scraping headers.  Empty
        // string when no Activity is active (e.g. middleware errors
        // before the pipeline starts).
        var trace_id = Activity.Current?.TraceId.ToString() ?? "";
        // FluentValidation arm — runs FIRST because validation
        // failures are the most common 4xx cause.  Emits an RFC 7807
        // ProblemDetails with the §3.2 `errors[]` extension carried
        // on `Extensions["errors"]`, status 422 (Unprocessable
        // Entity, the standard for input-shape errors).  Shape matches
        // Hono's defaultHook output byte-for-byte so the frontend
        // ACL's `applyServerErrors` works against either backend.
        if (context.Exception is FluentValidation.ValidationException fv)
        {
            var problem = new ProblemDetails
            {
                Type = "about:blank",
                Title = "Validation failed",
                Status = 422,
                Detail = "One or more fields are invalid.",
                Instance = context.HttpContext.Request.Path,
                Extensions = { ["code"] = "problem.field-invalid" },
            };
            problem.Extensions["errors"] = fv.Errors
                .Select(e =>
                {
                    var err = new Dictionary<string, object>
                    {
                        ["pointer"] = ValidationProblem.PointerOf(e.PropertyName),
                        ["message"] = e.ErrorMessage,
                    };
                    // Every rule names its catalog code with WithErrorCode (a
                    // named rule's identity key, else the generic key of an
                    // unnamed one); a native FluentValidation validator carries
                    // its own type name, which is an unnamed rule.
                    err["code"] = e.ErrorCode != null
                        && (e.ErrorCode.StartsWith("field.", StringComparison.Ordinal)
                            || e.ErrorCode.StartsWith("problem.", StringComparison.Ordinal)
                            || e.ErrorCode.Contains(".rule.", StringComparison.Ordinal))
                        ? e.ErrorCode
                        : "field.rule";
                    // A named rule hands the values it read over as CustomState.
                    if (e.CustomState is IDictionary<string, object?> ruleParams && ruleParams.Count > 0)
                        err["params"] = ruleParams;
                    return err;
                })
                .ToArray();
            _log.LogWarning("{Event} message={Message} status={Status}", "domain_error", "Validation failed", 422);
            global::Api.Observability.HttpMetrics.RecordDomainFault("domain_error");
            context.HttpContext.Response.Headers["x-request-id"] = trace_id;
            context.Result = new ObjectResult(problem)
            {
                StatusCode = 422,
                ContentTypes = { "application/problem+json" },
            };
            context.ExceptionHandled = true;
            return;
        }
        // Malformed WIRE value (M-T6.48) — money / datetime arrive as strings
        // and the controller parses them before the command exists, so this is
        // neither a FluentValidation failure (the validator runs on the COMMAND,
        // downstream of the parse) nor a domain rule.  Same 422 + errors[]
        // envelope as both, so a price of "12,50" reads identically on .NET
        // and on Hono's zod moneySchema hook.
        if (context.Exception is WireFormatException wfe)
        {
            var wireProblem = new ProblemDetails
            {
                Type = "about:blank",
                Title = "Validation failed",
                Status = 422,
                Detail = "One or more fields are invalid.",
                Instance = context.HttpContext.Request.Path,
                Extensions = { ["code"] = "problem.field-invalid" },
            };
            // Anonymous type rather than Dictionary<,>: this arm is emitted
            // unconditionally, and System.Collections.Generic is only imported
            // when the project has validators.
            var wireEntry = new System.Collections.Generic.Dictionary<string, object?>
            {
                ["pointer"] = wfe.FieldPointer,
                ["message"] = wfe.Message,
                ["code"] = wfe.Code,
            };
            if (wfe.Params is { Count: > 0 }) wireEntry["params"] = wfe.Params;
            wireProblem.Extensions["errors"] = new[] { wireEntry };
            _log.LogWarning("{Event} message={Message} status={Status}", "domain_error", "Validation failed", 422);
            global::Api.Observability.HttpMetrics.RecordDomainFault("domain_error");
            context.HttpContext.Response.Headers["x-request-id"] = trace_id;
            context.Result = new ObjectResult(wireProblem)
            {
                StatusCode = 422,
                ContentTypes = { "application/problem+json" },
            };
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is ForbiddenException fe)
        {
            _log.LogWarning("{Event} message={Message} status={Status}", "forbidden", fe.Message, 403);
            global::Api.Observability.HttpMetrics.RecordDomainFault("forbidden");
            context.Result = Problem(context, 403, "Forbidden", "Forbidden", trace_id, "problem.forbidden");
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is DisallowedException dx)
        {
            _log.LogWarning("{Event} message={Message} status={Status}", "disallowed", dx.Message, 409);
            global::Api.Observability.HttpMetrics.RecordDomainFault("disallowed");
            context.Result = Problem(context, 409, "Disallowed", dx.Message, trace_id, "problem.state-gate", TypeParams(context));
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is Npgsql.PostgresException { SqlState: "23503" }
            || (context.Exception is Microsoft.EntityFrameworkCore.DbUpdateException dre
                && dre.InnerException is Npgsql.PostgresException { SqlState: "23503" }))
        {
            _log.LogWarning("{Event} message={Message} status={Status}", "domain_error", "The request references a record that does not exist.", 422);
            global::Api.Observability.HttpMetrics.RecordDomainFault("domain_error");
            context.Result = Problem(context, 422, "Unprocessable Entity", "The request references a record that does not exist.", trace_id, "problem.dangling-reference", TypeParams(context));
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
        {
            var __conflictDetail = context.Exception.Message;
            if (context.Exception is Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException { Entries.Count: > 0 } __dbx)
            {
                var __entry = __dbx.Entries[0];
                var __type = __entry.Metadata.ClrType;
                var __name = __type.Namespace?.EndsWith(".Infrastructure.Persistence.Documents") == true && __type.Name.EndsWith("Document") ? __type.Name[..^"Document".Length] : __type.Name;
                var __key = __entry.Metadata.FindPrimaryKey();
                var __idVal = __key is { Properties.Count: > 0 } ? __entry.Property(__key.Properties[0].Name).CurrentValue : null;
                __conflictDetail = $"{__name} {__idVal} was modified by another request";
            }
            _log.LogWarning("{Event} message={Message} status={Status}", "conflict", __conflictDetail, 409);
            global::Api.Observability.HttpMetrics.RecordDomainFault("conflict");
            context.Result = Problem(context, 409, "Conflict", __conflictDetail, trace_id, "problem.version-conflict", TypeParams(context));
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is ValueObjectInvariantException voe)
        {
            _log.LogWarning("{Event} message={Message} status={Status}", "domain_error", voe.Message, 422);
            global::Api.Observability.HttpMetrics.RecordDomainFault("domain_error");
            context.HttpContext.Response.Headers["x-request-id"] = trace_id;
            var voProblem = new ProblemDetails
            {
                Type = "about:blank",
                Title = "Unprocessable Entity",
                Status = 422,
                Detail = voe.Message,
                Instance = context.HttpContext.Request.Path,
            };
            // The rule's catalog code (its identity key, or the generic key of
            // an unnamed one) names both the body and its one errors[] entry;
            // the values the rule read ride as params.
            var voProblemCode = voe.RuleCode ?? "problem.domain-floor";
            voProblem.Extensions["code"] = voProblemCode;
            var voProblemEntry = new System.Collections.Generic.Dictionary<string, object?>
            {
                ["pointer"] = "",
                ["message"] = voe.Message,
                ["code"] = voProblemCode,
            };
            if (voe.RuleParams is { Count: > 0 })
            {
                voProblem.Extensions["params"] = voe.RuleParams;
                voProblemEntry["params"] = voe.RuleParams;
            }
            voProblem.Extensions["errors"] = new object[] { voProblemEntry };
            context.Result = new ObjectResult(voProblem)
            {
                StatusCode = 422,
                ContentTypes = { "application/problem+json" },
            };
            context.ExceptionHandled = true;
            return;
        }
        // A domain-floor rejection (precondition / invariant) is 422 —
        // the request is well-formed, the domain refuses it on semantic
        // grounds.  400 stays for a malformed request.
        if (context.Exception is DomainException de)
        {
            _log.LogWarning("{Event} message={Message} status={Status}", "domain_error", de.Message, 422);
            global::Api.Observability.HttpMetrics.RecordDomainFault("domain_error");
            context.Result = Problem(context, 422, "Unprocessable Entity", de.Message, trace_id, "problem.domain-floor");
            context.ExceptionHandled = true;
            return;
        }
        // RS-48: a `checked(...)` integer `+ - *` left its int32 / int64 range.
        if (context.Exception is System.OverflowException ofe)
        {
            _log.LogWarning("{Event} message={Message} status={Status}", "domain_error", ofe.Message, 422);
            global::Api.Observability.HttpMetrics.RecordDomainFault("domain_error");
            context.Result = Problem(context, 422, "Unprocessable Entity", "Value out of range", trace_id, "problem.arithmetic-overflow");
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is AggregateNotFoundException nf)
        {
            _log.LogWarning("{Event} status={Status}", "not_found", 404);
            global::Api.Observability.HttpMetrics.RecordDomainFault("not_found");
            context.Result = Problem(context, 404, "Not Found", nf.Message, trace_id, "problem.not-found", TypeParams(context));
            context.ExceptionHandled = true;
            return;
        }
        if (context.Exception is ExternHandlerException xh)
        {
            // 500 — the user handler threw, which is an internal
            // failure from the framework's POV, so the body is
            // sanitized to "internal" like every other 500 arm.
            //
            // Deliberately NOT xh.Message: it interpolates the INNER
            // exception the user handler threw — driver text, URLs,
            // connection strings — into a public, potentially
            // unauthenticated response.  Operators lose nothing: aggregate,
            // op and the full inner exception all reach the catalog's
            // extern_handler_threw event below.  Same shape the Hono
            // onError arm emits.
            _log.LogError(xh, "{Event} aggregate={Aggregate} op={Op} error={Error}", "extern_handler_threw", xh.AggName, xh.OpName, xh.Message);
            context.Result = Problem(context, 500, "Internal Server Error", "internal", trace_id, "problem.internal", new System.Collections.Generic.Dictionary<string, object?> { ["requestId"] = trace_id });
            context.ExceptionHandled = true;
            return;
        }
        // Generic 500.  Log the full exception server-side via the
        // catalog's internal_error event; return a sanitized payload
        // to the client.  Matching the Hono fallback envelope.
        _log.LogError(context.Exception, "{Event} error={Error} status={Status}", "internal_error", context.Exception.Message, 500);
        context.Result = Problem(context, 500, "Internal Server Error", "internal", trace_id, "problem.internal", new System.Collections.Generic.Dictionary<string, object?> { ["requestId"] = trace_id });
        context.ExceptionHandled = true;
    }

    // RFC 7807 problem responder — application/problem+json body +
    // x-request-id header (trace correlation moves off the body so it's
    // byte-identical to Hono / Phoenix).  Shared by every non-validation arm.
    private static ObjectResult Problem(ExceptionContext context, int status, string title, string detail, string traceId, string code, object? @params = null)
    {
        context.HttpContext.Response.Headers["x-request-id"] = traceId;
        var body = new ProblemDetails
        {
            Type = "about:blank",
            Title = title,
            Status = status,
            Detail = detail,
            Instance = context.HttpContext.Request.Path,
            Extensions = { ["code"] = code },
        };
        if (@params is not null) body.Extensions["params"] = @params;
        return new ObjectResult(body)
        {
            StatusCode = status,
            ContentTypes = { "application/problem+json" },
        };
    }

    // The aggregate each `/api/<segment>` route serves: a refusal answered for
    // one carries its identity key as `params.type`.
    private static readonly System.Collections.Generic.Dictionary<string, string> AggregateTypes = new()
    {
        ["customers"] = "Customers.Customer",
        ["orders"] = "Orders.Order",
        ["products"] = "Products.Product",
    };

    private static System.Collections.Generic.Dictionary<string, object?>? TypeParams(ExceptionContext context)
    {
        var segments = (context.HttpContext.Request.Path.Value ?? "").Split('/', System.StringSplitOptions.RemoveEmptyEntries);
        var at = segments.Length > 0 && segments[0] == "api" ? 1 : 0;
        return segments.Length > at && AggregateTypes.TryGetValue(segments[at], out var type)
            ? new System.Collections.Generic.Dictionary<string, object?> { ["type"] = type }
            : null;
    }

    // The same 404 envelope, for the routes MVC cannot reach.
    //
    // This class is an `IExceptionFilter`: it only ever sees exceptions raised
    // inside the MVC pipeline.  The root `/files/{key}` download is a MINIMAL
    // API (Program.cs `app.MapGet`), so a throw from it bypasses this filter
    // entirely and ASP.NET answers it bodiless — which `UseStatusCodePages`
    // then fills with the FRAMEWORK-miss sentence ("no route for GET /files/…"),
    // a lie: the route exists, the object does not.
    //
    // Rather than hand-build a second problem body in Program.cs, the minimal
    // API calls this — one construction site, the same resolved
    // `httpStatus NotFound -> <Code>` status and title as the
    // `AggregateNotFoundException` arm above, the same header, the same log
    // event and the same fault counter.
    //
    // `Results.Problem` is deliberately NOT used: it applies
    // `ProblemDetailsDefaults`, which stamps the rfc9110 `type` URI and leaves
    // `instance` null — the exact divergence `Problem(...)` above exists to
    // avoid.
    // (The logger parameter is spelled `_log` so the catalog log line below is
    // the SAME rendered call as the filter arms above — one catalog renderer,
    // one event shape, whether the 404 came through MVC or a minimal API.)
    public static Microsoft.AspNetCore.Http.IResult NotFoundProblem(Microsoft.AspNetCore.Http.HttpContext http, ILogger<DomainExceptionFilter> _log, string detail)
    {
        var trace_id = Activity.Current?.TraceId.ToString() ?? "";
        _log.LogWarning("{Event} status={Status}", "not_found", 404);
        global::Api.Observability.HttpMetrics.RecordDomainFault("not_found");
        http.Response.Headers["x-request-id"] = trace_id;
        return Microsoft.AspNetCore.Http.Results.Json(new ProblemDetails
        {
            Type = "about:blank",
            Title = "Not Found",
            Status = 404,
            Detail = detail,
            Instance = http.Request.Path,
            Extensions = { ["code"] = "problem.not-found" },
        }, statusCode: 404, contentType: "application/problem+json");
    }
}
