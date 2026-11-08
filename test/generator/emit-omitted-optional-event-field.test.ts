// An `emit` that leaves out an OPTIONAL event field raises the event with that
// field set to null on every backend.  The event type declares the field
// (TS `note: string | null`, a positional C# record parameter, a Python
// dataclass field with no default), so a renderer that wrote only the provided
// fields produced a constructor call that does not compile (node, .NET) or
// raises at runtime (python), and a wire payload without the key.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import { corpusSource } from "../fixtures/corpus/harness.js";

type Backend = "node" | "dotnet" | "python" | "java" | "elixir";

async function emitted(backend: Backend): Promise<string> {
  const src = corpusSource("channels-broker")
    .replaceAll("__PLATFORM__", backend)
    .replace(
      "event OrderPlaced { order: Order id, at: datetime }",
      "event OrderPlaced { order: Order id, at: datetime, note: string? }",
    );
  const files = await generateSystemFiles(src);
  return [...files.entries()]
    .filter(([p]) => /order\.(ts|py)$|Order\.(cs|java)$|orders\.ex$/.test(p))
    .map(([, c]) => c)
    .join("\n");
}

describe("emit leaving out an optional event field", () => {
  it("node raises the event with note: null", async () => {
    expect(await emitted("node")).toContain(
      'type: "OrderPlaced", order: this._id, at: new Date(), note: null',
    );
  });
  it("dotnet passes Note: null", async () => {
    expect(await emitted("dotnet")).toMatch(/new OrderPlaced\([^\n]*Note: null\)/);
  });
  it("python passes note=None", async () => {
    expect(await emitted("python")).toMatch(/OrderPlaced\([^\n]*note=None\)/);
  });
  it("java passes a trailing null", async () => {
    expect(await emitted("java")).toMatch(/new OrderPlaced\([^\n]*, null\)/);
  });
  it("elixir sets note: nil", async () => {
    expect(await emitted("elixir")).toContain("note: nil");
  });
});
