// The int32 range refusal on the .NET request wire (RS-42).
//
// System.Text.Json reads a request `int` with `Utf8JsonReader.GetInt32`, which
// fails an out-of-range literal (`3000000000`) and a fractional one (`1.5`)
// with the SAME FormatException — so the input formatter can only record "the
// body did not deserialize", and `ValidationProblem` answered both as a 400
// malformed body.  Every other backend answers the range case as a field: a
// 422 whose `errors[]` entry points at the field and says
// `INTEGER_RANGE_MESSAGE`.
//
// This converter separates the two at the one place that can still see the
// token: an integer LITERAL (no `.`, no exponent) that does not fit an Int32 is
// a range refusal and throws a JsonException carrying exactly that message;
// every other shape falls through to `GetInt32`, i.e. the reader's own error
// and the unchanged 400.  A user-supplied JsonException message survives
// System.Text.Json untouched (only the default message gets "Path: …" appended),
// and the MVC input formatter files it under the field's JSON path — which is
// how `ValidationProblem.FromModelState` recognises it.

import { csIntegerRangeMessage } from "../wire-policy-cs.js";

export function renderInt32RangeConverter(ns: string): string {
  return `// Auto-generated.
using System;
using System.Buffers;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ${ns}.Serialization;

/// <summary>Reads a request <see cref="int"/> like the default converter,
/// except that an integer literal outside the Int32 range is refused with the
/// cross-backend range sentence (RS-42) instead of the reader's generic
/// FormatException — the one signal <c>ValidationProblem</c> needs to answer
/// it as a 422 at the field rather than a 400 for the whole body.</summary>
public sealed class Int32RangeJsonConverter : JsonConverter<int>
{
    /// <summary>The refusal message every backend sends for an int32 overflow.</summary>
    public const string Message = ${JSON.stringify(csIntegerRangeMessage())};

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
`;
}
