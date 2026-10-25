// Auto-generated.
using System;
using System.Buffers;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Api.Serialization;

/// <summary>Reads a request <see cref="int"/> like the default converter,
/// except that an integer literal outside the Int32 range is refused with the
/// cross-backend range sentence (RS-41) instead of the reader's generic
/// FormatException — the one signal <c>ValidationProblem</c> needs to answer
/// it as a 422 at the field rather than a 400 for the whole body.</summary>
public sealed class Int32RangeJsonConverter : JsonConverter<int>
{
    /// <summary>The refusal message every backend sends for an int32 overflow.</summary>
    public const string Message = "Integer out of range";

    public override int Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number && !reader.TryGetInt32(out _))
        {
            ReadOnlySpan<byte> raw = reader.HasValueSequence ? reader.ValueSequence.ToArray() : reader.ValueSpan;
            if (raw.IndexOfAny((byte)'.', (byte)'e', (byte)'E') < 0)
            {
                throw new JsonException(Message);
            }
        }
        return reader.GetInt32();
    }

    public override void Write(Utf8JsonWriter writer, int value, JsonSerializerOptions options)
        => writer.WriteNumberValue(value);

    public override int ReadAsPropertyName(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => int.Parse(reader.GetString()!, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);

    public override void WriteAsPropertyName(Utf8JsonWriter writer, int value, JsonSerializerOptions options)
        => writer.WritePropertyName(value.ToString(CultureInfo.InvariantCulture));
}
