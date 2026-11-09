import { describe, expect, it } from "vitest";
import type { GenerateReport, ValidateReport } from "../../src/api/index.js";
import { callTool } from "../../src/tools/index.js";
import {
  type AgentMessage,
  PACING,
  runAgentDemo,
  streamPrefixes,
  TASK_TRACKER_DDD,
  thinkMs,
} from "../../web/src/agent/demo.js";

// The deterministic agent demo (M-T8.3 wedge: prose → .ddd → generate → green).
// Headless-testable by construction: the driver runs the real browser-safe
// tools, so this locks BOTH that the authored source stays valid/generatable
// AND that the scripted loop reaches a green conclusion.

describe("agent demo", () => {
  it("TASK_TRACKER_DDD validates clean and generates a node+react stack", async () => {
    const v = (await callTool("loom_validate", { source: TASK_TRACKER_DDD })) as ValidateReport;
    expect(v.ok).toBe(true);
    expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const g = (await callTool("loom_generate", { source: TASK_TRACKER_DDD })) as GenerateReport;
    expect(g.ok).toBe(true);
    expect(g.deployables.map((d) => d.platform).sort()).toEqual(["node", "react"]);
  });

  it("runAgentDemo plays the scripted loop to a green conclusion", async () => {
    let messages: AgentMessage[] = [];
    let appliedSource = "";
    let generated = false;
    await runAgentDemo({
      setMessages: (fn) => {
        messages = fn(messages);
      },
      applySource: (ddd) => {
        appliedSource = ddd;
      },
      triggerGenerate: () => {
        generated = true;
      },
      delayMs: 0,
    });

    // Opens with the user's prompt.
    expect(messages[0]?.role).toBe("user");
    // The agent authored the model into the editor and kicked a real generate.
    expect(appliedSource).toBe(TASK_TRACKER_DDD);
    expect(generated).toBe(true);
    // The real tool calls landed their results.
    const tools = messages.flatMap((m) => m.toolCalls ?? []);
    expect(tools.find((t) => t.tool === "loom_validate")?.result).toBe("0 errors");
    expect(tools.find((t) => t.tool === "loom_generate")?.status).toBe("ok");
    // The new schema is recorded deliberately (the pure catalog here: the
    // entry comes back as a file, nothing is written).
    expect(tools.find((t) => t.tool === "loom_migration_status")?.result).toMatch(/unrecorded/);
    expect(tools.find((t) => t.tool === "loom_migration_record")?.result).toBe("recorded 1");
    // No dangling "running"/pending state at the end.
    expect(tools.every((t) => t.status !== "running")).toBe(true);
    expect(messages.every((m) => !m.pending)).toBe(true);
    // Concludes green.
    expect(messages.at(-1)?.text).toMatch(/Done/);
  });

  it("aborts cleanly when signalled", async () => {
    let messages: AgentMessage[] = [];
    const signal = { cancelled: true };
    await runAgentDemo({
      setMessages: (fn) => {
        messages = fn(messages);
      },
      applySource: () => {},
      triggerGenerate: () => {},
      delayMs: 0,
      signal,
    });
    // Cancelled up front ⇒ never gets past the user turn.
    expect(messages.length).toBeLessThanOrEqual(2);
  });
});

describe("agent demo pacing", () => {
  const run = async (deps: Partial<Parameters<typeof runAgentDemo>[0]>) => {
    let messages: AgentMessage[] = [];
    const snapshots: AgentMessage[][] = [];
    const sleeps: number[] = [];
    await runAgentDemo({
      setMessages: (fn) => {
        messages = fn(messages);
        snapshots.push(messages);
      },
      applySource: () => {},
      triggerGenerate: () => {},
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...deps,
    });
    return { messages, snapshots, sleeps };
  };

  it("thinkMs scales with the reply and is clamped to 800-1800", () => {
    expect(thinkMs("")).toBe(800);
    expect(thinkMs("x".repeat(100))).toBe(1200);
    expect(thinkMs("x".repeat(5000))).toBe(1800);
  });

  it("streamPrefixes grows by words and ends on the full text", () => {
    expect(streamPrefixes("a b c d e", 2)).toEqual(["a b ", "a b c d ", "a b c d e"]);
    expect(streamPrefixes("one")).toEqual(["one"]);
  });

  it("natural mode shows a thinking bubble, streams text, and runs tools with their own durations", async () => {
    const { messages, snapshots, sleeps } = await run({ reducedMotion: false });
    // An empty pending bubble (the thinking indicator) precedes each agent text.
    expect(
      snapshots.some(
        (s) => s.at(-1)?.role === "assistant" && s.at(-1)?.text === "" && s.at(-1)?.pending,
      ),
    ).toBe(true);
    // Text arrives progressively: some snapshot holds a strict prefix of the plan text.
    const plan = messages[1]?.text ?? "";
    expect(
      snapshots.some((s) => s[1] && s[1].text.length > 0 && s[1].text.length < plan.length),
    ).toBe(true);
    // Tool durations and thinking pauses were requested.
    expect(sleeps).toContain(PACING.toolMs.loom_validate);
    expect(sleeps).toContain(PACING.toolMs.loom_generate);
    expect(sleeps.some((ms) => ms >= 800 && ms <= 1800)).toBe(true);
    // A tool is observably "running" before it is "ok".
    const statuses = snapshots
      .flatMap((s) => s.flatMap((m) => m.toolCalls ?? []))
      .filter((t) => t.tool === "loom_validate")
      .map((t) => t.status);
    expect(statuses[0]).toBe("running");
    expect(statuses.at(-1)).toBe("ok");
    expect(messages.every((m) => !m.pending)).toBe(true);
    expect(messages.at(-1)?.text).toMatch(/Done/);
  });

  it("reduced motion skips streaming and shortens the pauses", async () => {
    const { snapshots, sleeps } = await run({ reducedMotion: true });
    expect(sleeps).not.toContain(PACING.chunkMs);
    expect(sleeps).toContain(PACING.reducedThinkMs);
    const plan = snapshots.at(-1)?.[1]?.text ?? "";
    expect(snapshots.every((s) => !s[1] || s[1].text === "" || s[1].text === plan)).toBe(true);
  });

  it("delayMs: 0 is instant — no sleeping at all", async () => {
    const { sleeps, messages } = await run({ delayMs: 0, reducedMotion: false });
    expect(sleeps).toEqual([]);
    expect(messages.at(-1)?.text).toMatch(/Done/);
  });
});
