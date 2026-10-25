// A malformed id — a path `{id}` or a body `X id` field that is not a dashed-hex
// uuid — answers a SENTENCE in `errors[].message`, never the server's regex.
//
// Node's `UuidString` used to fall through to zod's default text and python's
// pattern constraint to pydantic's, so a client read
// `Invalid string: must match pattern /^[0-9a-fA-F]{8}-…$/` (node) or
// `String should match pattern '^[0-9a-fA-F]{8}-…$'` (python).  Both now send
// `UUID_WIRE_MESSAGE`, the text java's type-mismatch arm and elixir's path-id
// plug already answered — one constant, so the backends cannot drift apart.

import { describe, expect, it } from "vitest";
import { UUID_WIRE_MESSAGE, UUID_WIRE_PATTERN } from "../../src/util/uuid-wire.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system U {
  subdomain D {
    context Desk {
      aggregate Agent with crudish { name: string }
      aggregate Ticket with crudish {
        title: string
        owner: Agent id?
        operation assign(agent: Agent id) { owner := agent }
      }
      repository Agents for Agent { }
      repository Tickets for Ticket { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: Desk, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Desk], dataSources: [st], serves: A, port: 4000 }
}
`;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

describe("a malformed id answers a sentence, not the uuid regex", () => {
  it("the shared message names no pattern", () => {
    expect(UUID_WIRE_MESSAGE).not.toContain(UUID_WIRE_PATTERN);
    expect(UUID_WIRE_MESSAGE).not.toMatch(/pattern|\[0-9/);
  });

  it("node: the shared UuidString (path, query and body ids) carries the message", async () => {
    const files = await generateSystemFiles(src("node"));
    const problem = fileEndingWith(files, "http/problem-details.ts");
    expect(problem).toContain(
      `.regex(/${UUID_WIRE_PATTERN}/, ${JSON.stringify(UUID_WIRE_MESSAGE)})`,
    );
    // The body field rides that schema, so it inherits the message.
    expect(fileEndingWith(files, "http/ticket.routes.ts")).toMatch(/agent: UuidString/);
  });

  it("python: a uuid pattern miss is re-worded before it reaches errors[]", async () => {
    const files = await generateSystemFiles(src("python"));
    const problem = fileEndingWith(files, "app/http/problem.py");
    expect(problem).toContain(`_UUID_PATTERN = r"${UUID_WIRE_PATTERN}"`);
    expect(problem).toContain('e.get("type") == "string_pattern_mismatch"');
    expect(problem).toContain('ctx.get("pattern") == _UUID_PATTERN');
    expect(problem).toContain(`return ${JSON.stringify(UUID_WIRE_MESSAGE)}`);
    // …and the handler actually routes every entry through it.
    expect(problem).toContain("else _wire_message(e),");
    expect(problem).not.toContain('"message": str(e["msg"]),');
  });

  it("elixir: the path-id plug sends the same constant", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const problem = fileEndingWith(files, "problem_details.ex");
    expect(problem).toContain(`message: ${JSON.stringify(UUID_WIRE_MESSAGE)}}])`);
  });
});
