// Auto-generated.
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

namespace Api.Observability;

/// One JSON object per log line in the shared envelope: `ts`, `level`,
/// `event`, the request-frame ids from the log scope, then the catalog fields
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
        textWriter.Write('\n');
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

    // The request frame's correlation id is the envelope's `request_id`.
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

    /// PascalCase / camelCase -> snake_case: `DurationMs` -> `duration_ms`.
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
