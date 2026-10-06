import { describe, expect, it } from "vitest";
import {
  EmissionClobberError,
  EmissionSink,
  emissionSink,
  rewrite,
} from "../../src/util/emission-sink.js";

describe("EmissionSink", () => {
  it("refuses a second write of different content to one path, naming both writers", () => {
    const out = emissionSink("probe");
    function firstEmitter() {
      out.set("lib/a.ex", "defmodule A do end");
    }
    function secondEmitter() {
      out.set("lib/a.ex", "defmodule B do end");
    }
    firstEmitter();
    let err: unknown;
    try {
      secondEmitter();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EmissionClobberError);
    const msg = (err as Error).message;
    expect(msg).toContain('"lib/a.ex"');
    expect(msg).toContain("[probe]");
    expect(msg).toMatch(/first writer: +firstEmitter/);
    expect(msg).toMatch(/second writer: +secondEmitter/);
    // The first file survives the refused write.
    expect(out.get("lib/a.ex")).toBe("defmodule A do end");
  });

  it("allows an identical re-write (a dedupe, not a clobber)", () => {
    const out = emissionSink("probe");
    out.set("shared.ts", "x");
    expect(() => out.set("shared.ts", "x")).not.toThrow();
    expect(out.size).toBe(1);
  });

  it("allows a deliberate rewrite through replace / rewrite", () => {
    const out = emissionSink("probe");
    out.set("a.ts", "x");
    out.replace("a.ts", "x\n//# sourceMappingURL=a.ts.map");
    expect(out.get("a.ts")).toContain("sourceMappingURL");
    rewrite(out, "a.ts", "y");
    expect(out.get("a.ts")).toBe("y");
    // ...and a later plain write is checked against the REWRITTEN content.
    expect(() => out.set("a.ts", "z")).toThrow(EmissionClobberError);
  });

  it("guards entries passed to the constructor", () => {
    expect(
      () =>
        new EmissionSink("probe", [
          ["a", "1"],
          ["a", "2"],
        ]),
    ).toThrow(EmissionClobberError);
  });

  it("is a Map, so every consumer typed Map<string, string> keeps working", () => {
    const out: Map<string, string> = emissionSink("probe");
    out.set("a", "1");
    expect([...out]).toEqual([["a", "1"]]);
    out.delete("a");
    expect(() => out.set("a", "2")).not.toThrow();
  });

  it("copyFrom carries each file's ORIGINAL writer, so a cross-tree clobber names the emitters", () => {
    const a = emissionSink("a");
    const b = emissionSink("b");
    function emitApiA() {
      a.set("lib/x.ex", "A");
    }
    function emitApiB() {
      b.set("lib/x.ex", "B");
    }
    emitApiA();
    emitApiB();
    const root = emissionSink("system");
    root.copyFrom(a, "api/");
    expect(root.writerOf("api/lib/x.ex")).toMatch(/^emitApiA/);
    expect(() => root.copyFrom(b, "api/")).toThrow(
      /first writer: +emitApiA[\s\S]*second writer: +emitApiB/,
    );
  });
});
