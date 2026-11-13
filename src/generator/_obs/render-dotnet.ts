// ---------------------------------------------------------------------------
// .NET / Microsoft.Extensions.Logging renderer for the neutral log-event
// catalog (see `./log-events.ts`).  Sister to `render-hono.ts` — produces
// the source line every per-model .NET emitter pastes at a log seam, so
// the same catalog event surfaces with the same level + fields on the
// .NET backend as on the Hono one.
//
// Idiom: ILogger.Log<Level>(template, params) with `{Event}` + per-field
// `{Pascal}` placeholders.  ASP.NET logging consumers (the default
// console sink, Serilog, Application Insights, etc.) extract those
// placeholders as STRUCTURED properties; the generated `LoomJsonFormatter`
// (below) writes them as top-level snake_case keys of the shared envelope,
// so a pipeline filtering on `event = "operation_invoked"` sees the same
// line shape as the pino-fed Hono backend.
//
// Assumes each emitting class has an `ILogger<TSelf> _log` field — the
// per-class injection idiom matching DomainExceptionFilter in
// api.tpl.ts.  Calls render against that field by name.
// ---------------------------------------------------------------------------

import { type LogEventKey, LogEvents } from "./log-events.js";

const METHOD: Record<string, string> = {
  trace: "LogTrace",
  debug: "LogDebug",
  info: "LogInformation",
  warn: "LogWarning",
  error: "LogError",
};

/** One field passed to a .NET log call — `name` is the snake_case
 *  catalog key (becomes a `{Pascal}` placeholder in the template), and
 *  `valueExpr` is the C# expression evaluated for the structured value.
 *  Caller passes a SUBSET of the catalog entry's `fields` — sites that
 *  don't have a particular field at hand (e.g. onError without an op
 *  name) just omit it.  Renderer doesn't enforce; the catalog declares
 *  what's POSSIBLE per event, not what's required at every site. */
export interface DotnetField {
  name: string;
  valueExpr: string;
}

/** Render `_log.<LogLevel>("{Event} key1={Pascal1} key2={Pascal2}",
 *  "event_name", v1, v2);` from a catalog entry + the fields the call
 *  site has on hand.  Assumes `_log` is the ILogger field; assumes the
 *  call site has the field name in scope as a C# identifier matching
 *  `valueExpr`. */
export function renderDotnetLogCall(eventKey: LogEventKey, fields: DotnetField[] = []): string {
  const e = LogEvents[eventKey];
  const method = METHOD[e.level];
  // Template: `{Event}` followed by snake-cased `key={Pascal}` pairs.
  // The placeholder names ARE the structured property names ASP.NET /
  // Serilog will surface — Pascal-case is the convention.
  const head = "{Event}";
  const tail = fields.map((f) => `${f.name}={${snakeToPascal(f.name)}}`);
  const template = [head, ...tail].join(" ");
  const args = [`"${e.event}"`, ...fields.map((f) => f.valueExpr)].join(", ");
  return `_log.${method}("${template}", ${args});`;
}

/** Same renderer but accepts an explicit exception expression as the
 *  first positional argument — the ILogger.Log<Level>(Exception, ...)
 *  overload.  Used at catch sites (extern_handler_threw, internal_error)
 *  so the stack trace rides the structured record. */
export function renderDotnetLogCallWithException(
  eventKey: LogEventKey,
  exceptionExpr: string,
  fields: DotnetField[] = [],
): string {
  const e = LogEvents[eventKey];
  const method = METHOD[e.level];
  const head = "{Event}";
  const tail = fields.map((f) => `${f.name}={${snakeToPascal(f.name)}}`);
  const template = [head, ...tail].join(" ");
  // ILogger.Log<Level>(Exception, string template, params object[] args)
  // — exception first, template next, structured args last.
  const args = [`"${e.event}"`, ...fields.map((f) => f.valueExpr)].join(", ");
  return `_log.${method}(${exceptionExpr}, "${template}", ${args});`;
}

/** snake_case → PascalCase: `request_id` → `RequestId`. */
function snakeToPascal(s: string): string {
  return s
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join("");
}

/** The `Observability/LoomJsonFormatter.cs` source — a `ConsoleFormatter` that
 *  writes the shared cross-backend log envelope: one JSON object per line with
 *  top-level `ts` / `level` / `event`, the request-frame ids from the log scope
 *  (`request_id` / `scope_id` / `actor_id` / `trace_id` / `span_id`), and the
 *  catalog fields as top-level snake_case keys. */
export function renderLoomJsonFormatter(ns: string): string {
  return `// Auto-generated.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging.Console;
using Microsoft.Extensions.Options;

namespace ${ns}.Observability;

/// One JSON object per log line in the shared envelope: \`ts\`, \`level\`,
/// \`event\`, the request-frame ids from the log scope, then the catalog fields
/// as top-level snake_case keys.
public sealed class LoomJsonFormatter : ConsoleFormatter
{
    public const string FormatterName = "loom";

    public LoomJsonFormatter() : base(FormatterName) { }

    public override void Write<TState>(
        in LogEntry<TState> logEntry,
        IExternalScopeProvider? scopeProvider,
        TextWriter textWriter)
    {
        var message = logEntry.Formatter?.Invoke(logEntry.State, logEntry.Exception);
        if (message is null && logEntry.Exception is null)
        {
            return;
        }

        var written = new HashSet<string>(StringComparer.Ordinal);
        string? eventName = null;
        var fields = new List<KeyValuePair<string, object?>>();
        if (logEntry.State is IEnumerable<KeyValuePair<string, object?>> state)
        {
            foreach (var kv in state)
            {
                if (kv.Key == "{OriginalFormat}") continue;
                if (kv.Key == "Event" && kv.Value is string ev)
                {
                    eventName = ev;
                    continue;
                }
                fields.Add(kv);
            }
        }

        var scopes = new List<KeyValuePair<string, object?>>();
        scopeProvider?.ForEachScope((scope, list) =>
        {
            if (scope is IEnumerable<KeyValuePair<string, object?>> pairs)
            {
                foreach (var kv in pairs) list.Add(kv);
            }
        }, scopes);

        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            w.WriteString("ts", DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
            w.WriteString("level", LevelName(logEntry.LogLevel));
            written.Add("ts");
            written.Add("level");

            foreach (var kv in scopes)
            {
                if (kv.Value is null || !FrameKeys.Contains(kv.Key)) continue;
                var key = ScopeKey(kv.Key);
                if (written.Add(key)) WriteValue(w, key, kv.Value);
            }

            var hasEvent = eventName is not null;
            eventName ??= logEntry.EventId.Name;
            w.WriteString("event", eventName ?? "log");
            written.Add("event");
            if (!hasEvent && message is not null)
            {
                w.WriteString("message", message);
                written.Add("message");
            }

            foreach (var kv in fields)
            {
                if (kv.Value is null) continue;
                var key = SnakeCase(kv.Key);
                if (written.Add(key)) WriteValue(w, key, kv.Value);
            }

            if (logEntry.Exception is not null)
            {
                w.WriteString("error", logEntry.Exception.Message);
                w.WriteString("stack", logEntry.Exception.ToString());
            }
            w.WriteEndObject();
        }
        textWriter.Write(Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length));
        textWriter.Write('\\n');
    }

    // The request-frame keys the generated middleware puts on the log scope.
    // Framework scopes (ConnectionId, RequestId, ...) are not part of the envelope.
    private static readonly HashSet<string> FrameKeys = new(StringComparer.Ordinal)
    {
        "correlationId", "scopeId", "parentId", "actorId", "traceId", "spanId",
    };

    private static string LevelName(LogLevel level) => level switch
    {
        LogLevel.Trace => "trace",
        LogLevel.Debug => "debug",
        LogLevel.Information => "info",
        LogLevel.Warning => "warn",
        _ => "error",
    };

    // The request frame's correlation id is the envelope's \`request_id\`.
    private static string ScopeKey(string key)
    {
        var snake = SnakeCase(key);
        return snake == "correlation_id" ? "request_id" : snake;
    }

    private static void WriteValue(Utf8JsonWriter w, string key, object value)
    {
        switch (value)
        {
            case bool b: w.WriteBoolean(key, b); break;
            case byte or sbyte or short or ushort or int or uint or long:
                w.WriteNumber(key, Convert.ToInt64(value, CultureInfo.InvariantCulture)); break;
            case ulong u: w.WriteNumber(key, u); break;
            case float or double or decimal:
                w.WriteNumber(key, Convert.ToDouble(value, CultureInfo.InvariantCulture)); break;
            default: w.WriteString(key, Convert.ToString(value, CultureInfo.InvariantCulture)); break;
        }
    }

    /// PascalCase / camelCase -> snake_case: \`DurationMs\` -> \`duration_ms\`.
    private static string SnakeCase(string s)
    {
        var sb = new StringBuilder(s.Length + 4);
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (char.IsLower(s[i - 1]) || char.IsDigit(s[i - 1])
                    || (i + 1 < s.Length && char.IsLower(s[i + 1]) && char.IsUpper(s[i - 1]))))
                {
                    sb.Append('_');
                }
                sb.Append(char.ToLowerInvariant(c));
            }
            else sb.Append(c);
        }
        return sb.ToString();
    }
}
`;
}
