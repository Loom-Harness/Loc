// A workflow's REACTOR / named-create bodies must walk the same
// body checks its primary `create` body does.
//
// They did not.  `validateWorkflowBody` iterated `wf.statements` — which is only
// a FACADE over the primary (unnamed, command-triggered) create — so every
// `on(e: Event)` reactor body, and every non-primary `create`
// body bypassed the entire workflow-body check set.
//
// The construct that exposed it is a `for` over something that is not an
// aggregate array — at the time, a notification fan-out iterating an inline
// read, `for f in Follows.all(FollowersOf(e.author)) { … }` (an inline read is
// now hoisted into a `let`, `src/ir/lower/hoist-reads.ts`, so that spelling
// is supported; the cases below iterate a non-array instead).  In a `create`
// body that is rejected by `loom.workflow-foreach-source` ("must iterate a
// `let xs = Repo.all(...)` result").  In a reactor body it validated CLEAN and
// reached codegen, where each backend failed differently:
//
//   * elixir  — `dispatch-emit` threw `unsupported reactor statement kind
//               'for-each'`, aborting the whole `generate system` run (so every
//               OTHER deployable in the system lost its output too);
//   * java / hono / python / .NET — emitted
//               `Repo.run(<the criterion's predicate inlined as a boolean>)`,
//               a call that exists on no repository, with the criterion's
//               parameter resolved against the workflow STATE row
//               (`state.followee()`).
//
// So this is the gate: the same `.ddd` shape must be diagnosed in a reactor
// body exactly as it is in a create body.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

/** Every phase-⑦ diagnostic the IR validator raises for `src`. */
async function irDiagnostics(src: string) {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

/** One model, one workflow, the fan-out `for` written inline — in whichever
 *  body the caller names. */
function model(body: string): string {
  return `system S { subdomain D { context C {
  aggregate Member { handle: string  derived display: string = handle }
  aggregate Post { author: Member id  title: string  derived display: string = title }
  aggregate Follow { follower: Member id  followee: Member id  derived display: string = "f" }
  aggregate Note { member: Member id  post: Post id  derived display: string = "n" }
  repository Members for Member { }
  repository Posts for Post { }
  repository Follows for Follow { }
  repository Notes for Note { }
  criterion FollowersOf(who: Member id) of Follow = followee == who
  event PostPublished { post: Post id, author: Member id }
  channel Feed { carries: PostPublished }
  workflow FanOut {
    postId: Post id
    // A starter is REQUIRED: a reactor-only workflow never has an instance to
    // route to, so every inbound event logs event_unrouted and returns
    // (refused by loom.reactor-without-starter, M-T5.34 / audit #2864 G2).
    // This command create names the correlation field, so it is addressable.
    create(postId: Post id) { }
${body}
  }
} } api A from C storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node contexts: [C] serves: A dataSources: [st] port: 8080 } }`;
}

const INLINE_FOR = `      for f in Follows.all(FollowersOf(e.author)) {
        let n = Note.create(member: f.follower, post: e.post)
      }`;

/** A `for` over a value that is no aggregate array (an event field). */
const BAD_FOR = `      for f in e.author {
        let n = Note.create(member: e.author, post: e.post)
      }`;

const LET_FOR = `      let fs = Follows.all(FollowersOf(e.author), page: { offset: 0, limit: 50 })
      for f in fs {
        let n = Note.create(member: f.follower, post: e.post)
      }`;

describe("workflow reactor / handler bodies are validated (not just the create facade)", () => {
  it("accepts an inline `for x in Repo.all(...)` inside an `on` REACTOR body (hoisted)", async () => {
    const diags = await irDiagnostics(
      model(`    on(e: PostPublished) by e.post {\n${INLINE_FOR}\n    }`),
    );
    expect(
      diags.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`),
    ).toEqual([]);
  });

  it("rejects a `for` over a non-array inside an `on` REACTOR body", async () => {
    const diags = await irDiagnostics(
      model(`    on(e: PostPublished) by e.post {\n${BAD_FOR}\n    }`),
    );
    const hit = diags.find((d) => d.code === "loom.workflow-foreach-source");
    expect(
      hit,
      `expected loom.workflow-foreach-source from the reactor body; got: ${diags
        .map((d) => d.code)
        .join(", ")}`,
    ).toBeDefined();
    expect(hit?.severity).toBe("error");
    // The diagnostic must name the loop variable and the remedy, so the author
    // can act on it without reading the compiler.
    expect(hit?.message).toContain("for f in");
    expect(hit?.message).toContain("Repo.all(...)");
  });

  it("accepts the supported `let xs = Repo.all(...)` + `for x in xs` spelling in a reactor", async () => {
    const diags = await irDiagnostics(
      model(`    on(e: PostPublished) by e.post {\n${LET_FOR}\n    }`),
    );
    expect(
      diags.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`),
    ).toEqual([]);
  });

  it("a create body's own diagnostics are unchanged (no double-reporting)", async () => {
    // The primary create is reached through `wf.creates`, not the `statements`
    // facade — it must still be checked EXACTLY once.
    const diags = await irDiagnostics(
      model(
        `    create(postId: Post id, author: Member id) {\n${BAD_FOR.replaceAll(
          "e.author",
          "author",
        ).replace("e.post", "postId")}\n    }`,
      ),
    );
    expect(diags.filter((d) => d.code === "loom.workflow-foreach-source")).toHaveLength(1);
  });
});
