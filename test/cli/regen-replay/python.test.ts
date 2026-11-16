// Gate for D-NO-READ-BACK (docs/decisions).
// The regeneration replay on `platform: python` — see `replay.ts`.
import { describe, expect, it } from "vitest";
import { replay, SCENARIOS } from "./replay.js";

describe("generate --merge / --check", () => {
  it("replays every scenario", () => {
    expect(replay("python")).toHaveLength(SCENARIOS);
  }, 300_000);
});
