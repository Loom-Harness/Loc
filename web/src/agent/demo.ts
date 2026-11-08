// ---------------------------------------------------------------------------
// Deterministic agent demo — the M-T8.3 "wedge": prose → `.ddd` → generate →
// record the initial migration → green, driven by a SCRIPTED agent (no live LLM, so it's reproducible enough
// to double as a Playwright e2e).  The script is canned, but every step runs
// the REAL browser-safe agent tools (`callTool` over `src/api/`) against the
// evolving source, so the results (validation, deployable manifest) are
// genuine — the same `loom_validate` / `loom_generate` an MCP client would get.
//
// This is intentionally the deterministic variant of the chat loop: the live-
// LLM transport (`Complete`) is a separate, decision-bearing slice.  Here the
// value is showing the loop end-to-end, faithfully, on a fixed transcript.
// ---------------------------------------------------------------------------

import type {
  GenerateReport,
  MigrationStatusReport,
  ValidateReport,
} from "../../../src/api/index.js";
import { callTool as catalogCallTool } from "../../../src/tools/index.js";
import type { TurnExtras } from "./turn.js";

/** The model the scripted agent "authors" from the prompt.  Validated + full-
 *  system-generated in CI (`agent-demo.test.ts`) so the demo can't rot into a
 *  broken source. */
export const TASK_TRACKER_DDD = `system TaskTracker {
  subdomain Work {
    context Work {
      enum Status { Todo, Doing, Done }

      aggregate Task with crudish {
        title: string
        status: Status
        invariant title.length > 0
        derived isDone: bool = status == Done
      }
    }
  }

  ui Board with scaffold(subdomains: [Work]) {
  }

  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }

  deployable api {
    platform: node
    contexts: [Work]
    dataSources: [workState]
    port: 3000
  }

  deployable board {
    platform: react
    targets: api
    ui: Board
    port: 3001
  }
}
`;

/** The user's opening prompt, shown as the first chat turn. */
export const DEMO_PROMPT =
  "Build a task tracker: a Task with a title and a status (Todo / Doing / Done), " +
  "plus a done flag derived from the status. Generate a Node/Hono API and a React board.";

export type AgentRole = "user" | "assistant";
export type ToolStatus = "running" | "ok" | "error";

/** One tool invocation shown inline in an assistant turn — the real
 *  `callTool` result, rendered to a short human summary. */
export interface AgentToolCall {
  tool: string;
  /** What the call is doing, in prose. */
  label: string;
  status: ToolStatus;
  /** Rendered result summary (filled once the call resolves). */
  result?: string;
}

export interface AgentMessage {
  id: string;
  role: AgentRole;
  text: string;
  toolCalls?: AgentToolCall[];
  /** True while the agent is still producing this turn. */
  pending?: boolean;
  /** Playground-side attachments for the turn this bubble closes — the plan
   *  awaiting approval, the receipt, the commit, the loop guard's stop card
   *  (M-T8.19).  Grafted on at render time by `attachTurnExtras`, never folded
   *  out of the transcript. */
  extras?: TurnExtras;
}

/** Mutations the driver performs on the outside world. */
export interface AgentDemoDeps {
  /** Replace the chat message list (React setState updater form). */
  setMessages: (fn: (prev: AgentMessage[]) => AgentMessage[]) => void;
  /** Push the authored `.ddd` into the editor / LSP (the source sink). */
  applySource: (ddd: string) => void;
  /** Kick the real playground generate so the Files pane populates. */
  triggerGenerate: () => void;
  /** Dispatch a tool call.  The playground passes the catalog with its host
   *  tools layered on, so the migration verbs act on the workspace; the
   *  default is the pure catalog, whose record returns the chain files and
   *  writes nothing. */
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Fixed pause between steps (ms).  When set it replaces the natural
   *  pacing entirely; `0` is the instant mode (no pauses, no streaming) used by
   *  tests.  Omit for the natural pacing in {@link PACING}. */
  delayMs?: number;
  /** Skip the streaming animation and shorten the pauses.  Defaults to the
   *  browser's `prefers-reduced-motion` setting. */
  reducedMotion?: boolean;
  /** Injectable sleep (fake timers / recording in tests).  Defaults to a
   *  `setTimeout` promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Cooperative cancellation (set `.cancelled` to abort mid-run). */
  signal?: { cancelled: boolean };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Natural-pacing constants (ms).  Every duration is a pure function of the
 *  text or tool involved, so a run is reproducible. */
export const PACING = {
  /** Beat after the user's prompt, before the agent starts thinking. */
  afterUserMs: 400,
  /** "Thinking" pause before an agent turn: base + per-character, clamped. */
  thinkBaseMs: 800,
  thinkPerCharMs: 4,
  thinkMaxMs: 1800,
  /** Streaming: words per chunk and the delay between chunks. */
  wordsPerChunk: 2,
  chunkMs: 60,
  /** How long each tool call stays "running". */
  toolMs: {
    edit: 700,
    loom_validate: 900,
    loom_generate: 1100,
    loom_migration_status: 700,
    loom_migration_record: 900,
  } as Record<string, number>,
  toolDefaultMs: 700,
  /** Reduced-motion thinking pause (no streaming). */
  reducedThinkMs: 300,
} as const;

/** The "thinking" pause before an agent turn that will say `text`. */
export function thinkMs(text: string): number {
  return Math.min(PACING.thinkMaxMs, PACING.thinkBaseMs + text.length * PACING.thinkPerCharMs);
}

/** Split `text` into progressive prefixes, `wordsPerChunk` words at a time.
 *  The last prefix is always the full text. */
export function streamPrefixes(text: string, wordsPerChunk: number = PACING.wordsPerChunk): string[] {
  const parts = text.match(/\S+\s*/g) ?? [text];
  const out: string[] = [];
  for (let i = wordsPerChunk; i < parts.length + wordsPerChunk; i += wordsPerChunk) {
    out.push(parts.slice(0, i).join(""));
  }
  if (out.length === 0 || out[out.length - 1] !== text) out.push(text);
  return out;
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let seq = 0;
const nextId = (): string => `m${++seq}`;

/** Run the scripted demo end to end.  Deterministic: the transcript is fixed
 *  and every tool call runs the real `callTool`, so a given run always
 *  produces the same messages + results (timing aside). */
export async function runAgentDemo(deps: AgentDemoDeps): Promise<void> {
  const { setMessages, applySource, triggerGenerate, signal } = deps;
  const callTool = deps.callTool ?? catalogCallTool;
  const instant = deps.delayMs === 0;
  const reduced = deps.reducedMotion ?? prefersReducedMotion();
  const sleep = deps.sleep ?? wait;
  const fixed = deps.delayMs;
  const stopped = (): boolean => signal?.cancelled === true;
  const pause = async (ms: number): Promise<void> => {
    if (!instant && ms > 0) await sleep(fixed ?? ms);
  };
  const stream = !instant && !reduced && fixed === undefined;

  const push = (m: AgentMessage): string => {
    setMessages((prev) => [...prev, m]);
    return m.id;
  };
  const patch = (id: string, p: Partial<AgentMessage>): void => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));
  };

  /** Show the thinking indicator (an empty pending bubble), pause in
   *  proportion to the reply, and return the bubble's id. */
  const think = async (reply: string): Promise<string> => {
    const id = push({ id: nextId(), role: "assistant", text: "", pending: true });
    await pause(reduced ? PACING.reducedThinkMs : thinkMs(reply));
    return id;
  };

  /** Reveal `text` in word chunks (or at once when streaming is off).  The
   *  bubble stays `pending` afterwards iff `keepPending`. */
  const say = async (id: string, text: string, keepPending = false): Promise<void> => {
    if (stream) {
      for (const prefix of streamPrefixes(text)) {
        if (stopped()) return;
        patch(id, { text: prefix, pending: true });
        await sleep(PACING.chunkMs);
      }
    }
    patch(id, { text, pending: keepPending });
  };

  const toolPause = (tool: string): Promise<void> =>
    pause(PACING.toolMs[tool] ?? PACING.toolDefaultMs);

  // 0) Reset to just the user's prompt.
  seq = 0;
  const userId = nextId();
  setMessages(() => [{ id: userId, role: "user", text: DEMO_PROMPT }]);
  await pause(PACING.afterUserMs);
  if (stopped()) return;

  // 1) The agent explains the model it will author.
  const planText =
    "Here's the Loom model — one `Task` aggregate in a `Work` context, a `Status` " +
    "enum, and `isDone` derived from the status. I'll wire a Node/Hono API and a " +
    "React board over it.";
  const planId = await think(planText);
  if (stopped()) return;
  await say(planId, planText);
  if (stopped()) return;

  // 2) Author the source (push it into the editor).
  patch(planId, { toolCalls: [{ tool: "edit", label: "Writing main.ddd", status: "running" }] });
  applySource(TASK_TRACKER_DDD);
  await toolPause("edit");
  patch(planId, {
    toolCalls: [{ tool: "edit", label: "Wrote main.ddd", status: "ok", result: `${TASK_TRACKER_DDD.trim().split("\n").length} lines` }],
  });
  if (stopped()) return;

  // 3) Validate — the repair loop's oracle (real loom_validate).
  const valLabel = "loom_validate(main.ddd)";
  const valId = await think("Validating the model…");
  if (stopped()) return;
  await say(valId, "Validating the model…", true);
  patch(valId, { toolCalls: [{ tool: "loom_validate", label: valLabel, status: "running" }] });
  const validate = (await callTool("loom_validate", { source: TASK_TRACKER_DDD })) as ValidateReport;
  await toolPause("loom_validate");
  if (stopped()) return;
  const errors = validate.diagnostics.filter((d) => d.severity === "error").length;
  patch(valId, {
    toolCalls: [
      {
        tool: "loom_validate",
        label: valLabel,
        status: validate.ok ? "ok" : "error",
        result: validate.ok ? "0 errors" : `${errors} error(s)`,
      },
    ],
  });
  await say(valId, validate.ok ? "The model is valid — no errors." : "The model has errors.");
  if (stopped() || !validate.ok) return;

  // 4) Report the deployable manifest (real loom_generate).
  const genLabel = "loom_generate(main.ddd)";
  const genId = await think("Deriving the deployable stack…");
  if (stopped()) return;
  await say(genId, "Deriving the deployable stack…", true);
  patch(genId, { toolCalls: [{ tool: "loom_generate", label: genLabel, status: "running" }] });
  const gen = (await callTool("loom_generate", { source: TASK_TRACKER_DDD })) as GenerateReport;
  await toolPause("loom_generate");
  if (stopped()) return;
  const manifest = gen.deployables.map((d) => `${d.name} (${d.platform}:${d.port})`).join(", ");
  patch(genId, {
    toolCalls: [{ tool: "loom_generate", label: genLabel, status: gen.ok ? "ok" : "error", result: manifest }],
  });
  await say(
    genId,
    `That's ${gen.deployables.length} deployable${gen.deployables.length === 1 ? "" : "s"}: ${manifest}.`,
  );
  if (stopped()) return;

  // 5) The schema is new, so nothing records it yet — and a boot only applies
  //    recorded migrations.  Check, then record the initial migration
  //    deliberately.
  const statusLabel = "loom_migration_status(main.ddd)";
  const statusId = await think("Checking the migration chain…");
  if (stopped()) return;
  await say(statusId, "Checking the migration chain…", true);
  patch(statusId, { toolCalls: [{ tool: "loom_migration_status", label: statusLabel, status: "running" }] });
  const status = (await callTool("loom_migration_status", {
    source: TASK_TRACKER_DDD,
  })) as MigrationStatusReport;
  await toolPause("loom_migration_status");
  if (stopped()) return;
  const unrecordedSteps = status.modules.reduce((n, m) => n + m.unrecordedSteps, 0);
  patch(statusId, {
    toolCalls: [
      {
        tool: "loom_migration_status",
        label: statusLabel,
        status: status.ok ? "ok" : "error",
        result: status.unrecorded ? `${unrecordedSteps} unrecorded step(s)` : "up to date",
      },
    ],
  });
  let recorded = !status.unrecorded;
  if (status.ok && status.unrecorded) {
    await say(
      statusId,
      "The schema isn't recorded as a migration yet, so a boot would leave the database empty. Recording the initial migration…",
      true,
    );
    const recLabel = "loom_migration_record(initial)";
    patch(statusId, {
      toolCalls: [
        {
          tool: "loom_migration_status",
          label: statusLabel,
          status: "ok",
          result: `${unrecordedSteps} unrecorded step(s)`,
        },
        { tool: "loom_migration_record", label: recLabel, status: "running" },
      ],
    });
    const rec = (await callTool("loom_migration_record", {
      source: TASK_TRACKER_DDD,
      name: "initial",
    })) as { ok: boolean; files: unknown[] };
    await toolPause("loom_migration_record");
    if (stopped()) return;
    recorded = rec.ok;
    patch(statusId, {
      toolCalls: [
        {
          tool: "loom_migration_status",
          label: statusLabel,
          status: "ok",
          result: `${unrecordedSteps} unrecorded step(s)`,
        },
        {
          tool: "loom_migration_record",
          label: recLabel,
          status: rec.ok ? "ok" : "error",
          result: rec.ok ? `recorded ${rec.files.length}` : "not recorded",
        },
      ],
    });
  }
  await say(
    statusId,
    recorded
      ? "The initial migration is recorded — a boot applies it to the database."
      : "The migration chain needs attention before a boot.",
  );
  if (stopped()) return;

  // 6) Emit the real project tree into the Files pane, and conclude.
  const doneText =
    "✅ Done — prose to a validated model, a recorded migration and a generated stack. The full " +
    "project tree is in the Files pane; open Preview to boot the Hono API + React board in-browser.";
  const doneId = await think(doneText);
  if (stopped()) return;
  triggerGenerate();
  await say(doneId, doneText);
}
