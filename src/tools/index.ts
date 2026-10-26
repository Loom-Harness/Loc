// The Loom agent-tool catalog — see https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/agent-tools-and-mcp.md and
// D-AGENT-TOOLS.  Transport-neutral: imported by the MCP server, the playground
// chat, and any future host.

export {
  type Complete,
  type Completion,
  type ContentBlock,
  dispatchToolUses,
  type Message,
  type RunAgentOptions,
  type RunAgentResult,
  runAgent,
  type TextBlock,
  type TokenUsage,
  type ToolResultBlock,
  type ToolSpec,
  type ToolUseBlock,
  toolSpecs,
} from "./agent-loop.js";
export { callTool, TOOLS, TOOLS_BY_NAME, type ToolDef } from "./catalog.js";
