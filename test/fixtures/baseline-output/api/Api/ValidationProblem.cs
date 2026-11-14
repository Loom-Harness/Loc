// Auto-generated.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Api.Api;

/// <summary>The catalog <c>code</c> of a refusal the FRAMEWORK answered by status
/// — a path no route serves, a verb it does not, a media type it cannot read,
/// an unreadable body.  Domain refusals name their own.</summary>
public static class ProblemCodes
{
    public static string ForStatus(int status) => status switch
    {
        404 => "problem.no-route",
        405 => "problem.method-not-allowed",
        415 => "problem.unsupported-media-type",
        401 => "problem.unauthenticated",
        403 => "problem.forbidden",
        422 => "problem.field-invalid",
        400 => "problem.malformed-body",
        _ => "problem.internal",
    };
}

public static class ValidationProblem
{
    /// <summary>
    /// The message every backend sends for a REQUIRED request field the body
    /// leaves out (RS-39) — whether System.Text.Json noticed the absence (a
    /// value-typed member) or DataAnnotations' [Required] did (a reference one).
    /// </summary>
    private const string MissingSuffix = " is required";

    /// <summary>"&lt;field&gt; is required" — the field is the LAST key of the pointer.</summary>
    private static string MissingFieldMessage(string pointer) =>
        pointer[(pointer.LastIndexOf('/') + 1)..] + MissingSuffix;

    /// <summary>True when the JSON path <paramref name="key"/> (<c>$.category</c>,
    /// <c>$.lines[0].product</c>) addresses a Guid-typed member of the body.  System.Text.Json
    /// reports a bad value for a record's constructor parameter against the
    /// REQUEST type, naming no Guid, so the member's type is read off the model.</summary>
    private static bool IsGuidAtPath(ActionContext context, string key)
    {
        var body = context.ActionDescriptor.Parameters.FirstOrDefault(p =>
            p.BindingInfo?.BindingSource == Microsoft.AspNetCore.Mvc.ModelBinding.BindingSource.Body);
        if (body is null) return false;
        var type = body.ParameterType;
        foreach (var segment in key.TrimStart('$').TrimStart('.').Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            var bracket = segment.IndexOf('[');
            var name = bracket >= 0 ? segment[..bracket] : segment;
            var property = type.GetProperty(name,
                System.Reflection.BindingFlags.IgnoreCase | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            if (property is null) return false;
            type = property.PropertyType;
            if (bracket >= 0 || (type != typeof(string) && typeof(System.Collections.IEnumerable).IsAssignableFrom(type)))
            {
                type = type.IsArray ? type.GetElementType()! : type.IsGenericType ? type.GetGenericArguments()[0] : type;
            }
        }
        return (Nullable.GetUnderlyingType(type) ?? type) == typeof(Guid);
    }

    /// <summary>True when <paramref name="key"/> names an action parameter bound as
    /// a Guid (a route or query id).</summary>
    private static bool IsGuidParameter(ActionContext context, string key) =>
        context.ActionDescriptor.Parameters.Any(p =>
            string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)
            && (p.ParameterType == typeof(Guid) || p.ParameterType == typeof(Guid?)));

    private static string? QueryMismatchMessage(ActionContext context, string key, string binderMessage)
    {
        if (!binderMessage.StartsWith("The value '", StringComparison.Ordinal)) return null;
        var type = context.ActionDescriptor.Parameters
            .FirstOrDefault(p => string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase))
            ?.ParameterType;
        if (type is null) return null;
        return type switch
        {
            _ when type == typeof(int) || type == typeof(int?) => "Expected an integer.",
            _ when type == typeof(long) || type == typeof(long?) => "Expected an integer.",
            _ when type == typeof(decimal) || type == typeof(decimal?) => "Expected a number.",
            _ when type == typeof(double) || type == typeof(double?) => "Expected a number.",
            _ when type == typeof(bool) || type == typeof(bool?) => "Expected true or false.",
            _ when type == typeof(DateTime) || type == typeof(DateTime?) => "Expected an ISO 8601 date-time.",
            _ when type == typeof(DateTimeOffset) || type == typeof(DateTimeOffset?) => "Expected an ISO 8601 date-time.",
            _ when type == typeof(DateOnly) || type == typeof(DateOnly?) => "Expected an ISO 8601 date.",
            _ => null,
        };
    }

    private static bool IsInt32Parameter(ActionContext context, string key) =>
        context.ActionDescriptor.Parameters.Any(p =>
            string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)
            && (p.ParameterType == typeof(int) || p.ParameterType == typeof(int?)));

    /// <summary>[Required]'s own sentence — "The X field is required." —
    /// recognised so it carries the shared wording instead.</summary>
    private static bool IsRequiredMessage(string message) =>
        message.StartsWith("The ", StringComparison.Ordinal)
        && message.EndsWith(" field is required.", StringComparison.Ordinal);

    /// <summary>
    /// RFC 7807 answer for a request MVC rejected during model binding or
    /// DataAnnotations validation.  Wired in Program.cs via
    /// ApiBehaviorOptions.InvalidModelStateResponseFactory.
    /// </summary>
    public static IActionResult FromModelState(ActionContext context)
    {
        // An unreadable body is a MALFORMED request, not an invalid one: no
        // field-level pointer describes it, and the sibling backends answer
        // 400.  MVC records it two ways depending on where the read failed —
        // as a JsonException hung on the model-state entry, or (when the
        // formatter already consumed it) as a plain message under the "$"
        // key the System.Text.Json input formatter uses for the body root.
        // Match both: keying on only one of them silently reclassifies half
        // the malformed bodies as field validation failures.
        // ...EXCEPT a MISSING REQUIRED MEMBER.  System.Text.Json reports that
        // under the same "$" root key, and it is NOT a malformed body: the JSON
        // parsed fine, a member the contract requires simply was not there.
        // That is the wire-validation tier's 422 — the same answer this
        // endpoint already gives when an omitted REFERENCE-typed member trips
        // [Required].  Without this arm the two halves of one contract disagree
        // purely on the CLR kind of the field (schemathesis F30).
        //
        // MEASURED on .NET 10, omitting a required int from a create body; the
        // model-state entry is
        //
        //     $ => Exception: none
        //          ErrorMessage: JSON deserialization for type '<ns>.CreateWidgetRequest'
        //                        was missing required properties including: 'qty'.
        //
        // Note it carries NO exception — the message is the whole signal — which
        // is why this reads ErrorMessage and not error.Exception.
        //
        // Matched on the message because STJ raises no distinct exception type
        // and hangs no exception here at all.  If a future runtime rewords it,
        // the check stops matching and the answer falls back to the 400 this
        // arm gave before: the behaviour of today, never a crash and never a
        // laxer contract.
        const string MissingRequiredMarker = "missing required properties";
        static bool IsMissingRequired(ModelError error) =>
            error.ErrorMessage.Contains(MissingRequiredMarker, StringComparison.Ordinal)
            || (error.Exception?.Message.Contains(MissingRequiredMarker, StringComparison.Ordinal) ?? false);

        // The member names STJ lists are quoted and already in WIRE casing, so
        // they need no PointerOf conversion.  The type name it also quotes is
        // fully qualified, so a dot tells the two apart; an unrecognised shape
        // yields nothing and the caller falls back to the whole-document
        // pointer rather than inventing a field.
        static IEnumerable<string> MissingMemberNames(string message)
        {
            foreach (System.Text.RegularExpressions.Match m in
                System.Text.RegularExpressions.Regex.Matches(message, "'([^']+)'"))
            {
                var name = m.Groups[1].Value;
                if (!name.Contains('.')) yield return name;
            }
        }

        var missingRequired = context.ModelState
            .SelectMany(entry => entry.Value is null
                ? Array.Empty<ModelError>()
                : entry.Value.Errors.Where(IsMissingRequired))
            .ToArray();
        if (missingRequired.Length > 0)
        {
            var missingProblem = new ProblemDetails
            {
                Type = "about:blank",
                Title = "Validation failed",
                Status = 422,
                Detail = "One or more fields are invalid.",
                Instance = context.HttpContext.Request.Path,
                Extensions = { ["code"] = "problem.field-invalid" },
            };
            // Built ONLY from the missing-member errors: the same rejection also
            // records a companion "The request field is required." entry keyed by
            // the ACTION PARAMETER, which would otherwise ship a bogus
            // "/request" pointer the wire shape has no field for.
            missingProblem.Extensions["errors"] = missingRequired
                .SelectMany(error =>
                {
                    var names = MissingMemberNames(error.ErrorMessage).ToArray();
                    return names.Length > 0
                        ? names.Select(name => new Dictionary<string, object>
                        {
                            ["pointer"] = "/" + name,
                            ["message"] = MissingFieldMessage(name),
                            ["code"] = "field.missing",
                        })
                        : new[] { new Dictionary<string, object>
                        {
                            ["pointer"] = "",
                            ["message"] = error.ErrorMessage,
                            ["code"] = "field.missing",
                        } };
                })
                .ToArray();
            return new ObjectResult(missingProblem)
            {
                StatusCode = 422,
                ContentTypes = { "application/problem+json" },
            };
        }
        // An int literal past Int32 is a FIELD refusal, not a malformed body
        // (RS-42): Serialization.Int32RangeJsonConverter throws it with the
        // range sentence as its message, and the input formatter files that
        // message under the field's JSON path ("$.n", "$.best.qty").  Answered
        // like a missing member: only the range errors, never the companion
        // "The request field is required." the same rejection records against
        // the action parameter.
        static bool IsIntegerRange(ModelError error) =>
            error.ErrorMessage == global::Api.Serialization.Int32RangeJsonConverter.Message
            || error.Exception?.Message == global::Api.Serialization.Int32RangeJsonConverter.Message;
        var outOfRange = context.ModelState
            .Where(entry => entry.Value is not null && entry.Value.Errors.Any(IsIntegerRange))
            .Select(entry => entry.Key)
            .ToArray();
        if (outOfRange.Length > 0)
        {
            var rangeProblem = new ProblemDetails
            {
                Type = "about:blank",
                Title = "Validation failed",
                Status = 422,
                Detail = "One or more fields are invalid.",
                Instance = context.HttpContext.Request.Path,
                Extensions = { ["code"] = "problem.field-invalid" },
            };
            rangeProblem.Extensions["errors"] = outOfRange
                .Select(key => new Dictionary<string, object>
                {
                    ["pointer"] = PointerOf(key.TrimStart('$').TrimStart('.')),
                    ["message"] = global::Api.Serialization.Int32RangeJsonConverter.Message,
                    ["code"] = "field.integer-range",
                    ["params"] = new Dictionary<string, object> { ["min"] = -2147483648, ["max"] = 2147483647 },
                })
                .ToArray();
            return new ObjectResult(rangeProblem)
            {
                StatusCode = 422,
                ContentTypes = { "application/problem+json" },
            };
        }
        // A value of the WRONG JSON TYPE for its field — "5" for an int, 12.5 for
        // a money, 5.5 for an int — is a FIELD refusal at the field's pointer,
        // not a malformed body (D-NUMERIC-INGRESS-STRICT: no coercion, and the
        // refusal is the schema tier's).  System.Text.Json raises it as a
        // JsonException whose text starts "The JSON value could not be
        // converted to <type>." and keys the entry by the field's JSON path; a
        // SYNTAX fault is a different exception and keeps the 400 below.  The
        // framework's sentence names the CLR request type (an internal name), so
        // the message is the neutral one below instead.
        static string MismatchText(ModelError error) =>
            error.Exception?.Message ?? error.ErrorMessage;
        static bool IsTypeMismatch(ModelError error) =>
            MismatchText(error).StartsWith("The JSON value could not be converted", StringComparison.Ordinal);
        // An id (a Guid on the wire) that is not a uuid is the same field
        // refusal with the fact's malformed-id sentence: System.Text.Json
        // names the target type in its text.
        static bool IsMalformedId(ModelError error) =>
            MismatchText(error).Contains("System.Guid", StringComparison.Ordinal);
        var mismatched = context.ModelState
            .Where(entry => entry.Value is not null && entry.Value.Errors.Any(IsTypeMismatch))
            .ToArray();
        if (mismatched.Length > 0)
        {
            var mismatchProblem = new ProblemDetails
            {
                Type = "about:blank",
                Title = "Validation failed",
                Status = 422,
                Detail = "One or more fields are invalid.",
                Instance = context.HttpContext.Request.Path,
                Extensions = { ["code"] = "problem.field-invalid" },
            };
            mismatchProblem.Extensions["errors"] = mismatched
                .Select(entry =>
                {
                    // A uuid field fed something that is not a uuid is a
                    // malformed id, not a wrong JSON type.
                    var malformedId = entry.Value!.Errors.Any(IsMalformedId) || IsGuidAtPath(context, entry.Key);
                    return new Dictionary<string, object>
                    {
                        ["pointer"] = PointerOf(entry.Key.TrimStart('$').TrimStart('.')),
                        ["message"] = malformedId ? "Expected UUID." : "Invalid value",
                        ["code"] = malformedId ? "field.malformed-id" : "field.type-mismatch",
                    };
                })
                .ToArray();
            return new ObjectResult(mismatchProblem)
            {
                StatusCode = 422,
                ContentTypes = { "application/problem+json" },
            };
        }
        var malformed = context.ModelState.Any(entry =>
            entry.Key.StartsWith('$')
            || entry.Value?.Errors.Any(error => error.Exception is JsonException) == true);
        if (malformed)
        {
            return new ObjectResult(new ProblemDetails
            {
                Type = "about:blank",
                Title = "Bad Request",
                Status = 400,
                Detail = "Malformed JSON in request body",
                Instance = context.HttpContext.Request.Path,
                Extensions = { ["code"] = "problem.malformed-body" },
            })
            {
                StatusCode = 400,
                ContentTypes = { "application/problem+json" },
            };
        }
        var problem = new ProblemDetails
        {
            Type = "about:blank",
            Title = "Validation failed",
            Status = 422,
            Detail = "One or more fields are invalid.",
            Instance = context.HttpContext.Request.Path,
            Extensions = { ["code"] = "problem.field-invalid" },
        };
        problem.Extensions["errors"] = context.ModelState
            .SelectMany(entry => entry.Value is null
                ? Array.Empty<Dictionary<string, object>>()
                : entry.Value.Errors.Select(error =>
                {
                    // The Guid binder's own sentence for a route / query uuid it
                    // cannot parse becomes the shared malformed-id answer; any
                    // other DataAnnotations bound is an unnamed rule.
                    var required = IsRequiredMessage(error.ErrorMessage);
                    var malformedId = !required && IsGuidParameter(context, entry.Key)
                        && error.ErrorMessage.StartsWith("The value '", StringComparison.Ordinal);
                    // An int query / route value that IS an integer but does
                    // not fit int32 is the shared integer-range refusal, with
                    // its bounds — the Int32 binder only says "is not valid".
                    if (!required && IsInt32Parameter(context, entry.Key)
                        && long.TryParse(entry.Value?.AttemptedValue, System.Globalization.NumberStyles.AllowLeadingSign, System.Globalization.CultureInfo.InvariantCulture, out _))
                    {
                        return new Dictionary<string, object>
                        {
                            ["pointer"] = PointerOf(entry.Key),
                            ["message"] = "Integer out of range",
                            ["code"] = "field.integer-range",
                            ["params"] = new Dictionary<string, object> { ["min"] = -2147483648, ["max"] = 2147483647 },
                        };
                    }
                    // A query / route value that does not parse as its declared
                    // type reads its kind's ruled sentence; the binder only says
                    // "is not valid".
                    var mismatch = required || malformedId ? null
                        : QueryMismatchMessage(context, entry.Key, error.ErrorMessage);
                    if (mismatch is not null)
                    {
                        return new Dictionary<string, object>
                        {
                            ["pointer"] = PointerOf(entry.Key),
                            ["message"] = mismatch,
                            ["code"] = "field.type-mismatch",
                        };
                    }
                    return new Dictionary<string, object>
                    {
                        ["pointer"] = PointerOf(entry.Key),
                        ["message"] = required ? MissingFieldMessage(PointerOf(entry.Key))
                            : malformedId ? "Expected UUID." : error.ErrorMessage,
                        ["code"] = required ? "field.missing"
                            : malformedId ? "field.malformed-id" : "field.rule",
                    };
                }))
            .ToArray();
        return new ObjectResult(problem)
        {
            StatusCode = 422,
            ContentTypes = { "application/problem+json" },
        };
    }

    /// <summary>
    /// Convert a FluentValidation / ModelState property path to an RFC 6901
    /// JSON pointer matching the wire shape the frontend ACL expects.  The
    /// app's JSON output uses JsonNamingPolicy.CamelCase, so each PascalCase
    /// segment is camel-cased; array indexer notation (<c>Items[0].Qty</c>)
    /// becomes a numeric segment (<c>/items/0/qty</c>).  RFC 6901 escapes
    /// apply inside each segment (<c>~</c> → <c>~0</c>, <c>/</c> → <c>~1</c>).
    /// Empty input → empty pointer (the whole document).
    /// </summary>
    public static string PointerOf(string propertyName)
    {
        if (string.IsNullOrEmpty(propertyName)) return "";
        var segments = new List<string>();
        foreach (var dotPart in propertyName.Split('.'))
        {
            var idx = 0;
            while (idx < dotPart.Length)
            {
                var bracket = dotPart.IndexOf('[', idx);
                if (bracket < 0)
                {
                    segments.Add(JsonNamingPolicy.CamelCase.ConvertName(dotPart.Substring(idx)));
                    break;
                }
                if (bracket > idx)
                {
                    segments.Add(JsonNamingPolicy.CamelCase.ConvertName(dotPart.Substring(idx, bracket - idx)));
                }
                var close = dotPart.IndexOf(']', bracket);
                if (close < 0) break;
                segments.Add(dotPart.Substring(bracket + 1, close - bracket - 1));
                idx = close + 1;
            }
        }
        return "/" + string.Join("/", segments.ConvertAll(s => s.Replace("~", "~0").Replace("/", "~1")));
    }
}
