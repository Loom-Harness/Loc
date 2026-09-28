// Canonical ISO-8601 UTC instant JSON converters (RS-4 temporal round-trip).
//
// System.Text.Json's built-in DateTime writer emits the round-trip ("o") form
// with a fixed 7-digit fractional-second field, so an instant with no
// sub-second component serializes as `2024-01-01T00:00:00.0000000Z`.  The
// canonical wire form every backend ships (RS-4 + RS-38) is milliseconds:
// `2024-01-01T00:00:00Z` on a whole second, exactly three digits otherwise
// (`2024-01-01T00:00:00.120Z`).  These converters bring raw-`DateTime` /
// `DateTimeOffset` serialization onto that canonical shape.  (Business response/request DTOs carry `datetime` as a
// pre-formatted wire string — see `projectToResponse` in dto-mapping.ts, which
// applies the same trim — so these converters cover the minimal-API probes and
// any raw datetime a controller serializes directly.)

export function renderCanonicalInstantConverter(ns: string): string {
  return `// Auto-generated.
using System;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ${ns}.Serialization;

/// <summary>Serializes a <see cref="DateTime"/> as canonical ISO-8601 UTC in
/// milliseconds (RS-38): three fractional digits when a fraction is present,
/// none on a whole second — the form every backend ships.  Reads keep
/// accepting the standard ISO-8601 inputs the default reader accepts.</summary>
public sealed class CanonicalInstantJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.GetDateTime();

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
        => writer.WriteStringValue(CanonicalInstant.Format(value));
}

/// <summary>The <see cref="DateTimeOffset"/> sibling of
/// <see cref="CanonicalInstantJsonConverter"/> — normalizes to UTC before
/// applying the same canonical trim.</summary>
public sealed class CanonicalInstantOffsetJsonConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.GetDateTimeOffset();

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
        => writer.WriteStringValue(CanonicalInstant.Format(value.UtcDateTime));
}

internal static class CanonicalInstant
{
    /// <summary>Canonical ISO-8601 UTC string for <paramref name="value"/>
    /// (RS-4 + RS-38): milliseconds — exactly three fractional digits when the
    /// instant has a sub-second part, none on a whole second.  The custom
    /// <c>fff</c> specifier truncates (never rounds), so ".9996" cannot carry
    /// into the next second.  "12:00:00" -> "...00Z"; ".1234567" -> "....123Z";
    /// ".1200000" -> "....120Z".</summary>
    public static string Format(DateTime value)
    {
        string s = value.ToUniversalTime().ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fff'Z'", CultureInfo.InvariantCulture);
        return s.EndsWith(".000Z", StringComparison.Ordinal)
            ? string.Concat(s.AsSpan(0, s.Length - 5), "Z")
            : s;
    }
}
`;
}
