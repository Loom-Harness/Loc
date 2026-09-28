// Auto-generated.
using System;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Api.Serialization;

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
