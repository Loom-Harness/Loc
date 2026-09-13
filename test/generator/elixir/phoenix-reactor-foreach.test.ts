// A `for x in xs` loop over a `let xs = Repo.run(<Criterion>(args))` bind
// inside a workflow REACTOR body — the notification fan-out shape.
//
// `src/generator/elixir/dispatch-emit.ts` (the reactor / event-create emitter,
// which is NOT the vanilla command emitter and NOT on the shared
// `_workflow/stmt-target.ts` spine) had no arm for `for-each` or `repo-run` at
// all.  Its `default:` THREW:
//
//   Error: dispatch-emit: unsupported reactor statement kind 'for-each'
//
// with no `loom.*` code, no `.ddd` file:line, and — because the throw escapes
// `generateSystemsFromLoom` — no partial output: the whole `generate system`
// run died, so every OTHER deployable in the system lost its emission too.
//
// It now emits the same `Enum.reduce_while/3` shape the vanilla command path
// does, so the first failing element halts the fan-out and threads `{:error, _}`
// up the handler's own `with`-chain.  Proven against a real compiler:
// `MIX_ENV=prod mix compile --warnings-as-errors` on the emitted project.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `system S { subdomain D { context Community {
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
    on(e: PostPublished) by e.post {
      let fs = Follows.run(FollowersOf(e.author), page: { offset: 0, limit: 100 })
      for f in fs {
        let n = Note.create({ member: f.follower, post: e.post })
      }
    }
  }
} } api A from D storage pg { type: postgres }
  resource st { for: Community, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Community] serves: A dataSources: [st] port: 4000 } }`;

async function reactor(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const hit = [...files.entries()].find(([k]) => k.endsWith("on_post_published.ex"));
  expect(hit, `reactor module not emitted; got:\n${[...files.keys()].join("\n")}`).toBeDefined();
  return hit![1];
}

describe("phoenix reactor: `for x in xs` over a repo-run bind", () => {
  it("emits the whole system without throwing", async () => {
    // The regression in one line: this used to reject with
    // `dispatch-emit: unsupported reactor statement kind 'for-each'`.
    const files = await generateSystemFiles(SRC);
    expect(files.size).toBeGreaterThan(10);
  });

  it("renders the repo-run as the shared retrieval entry the command path calls", async () => {
    const src = await reactor();
    expect(src).toContain(
      "{:ok, fs} <- Api.Community.run_find_all_by_followers_of_follow(event.author, offset: 0, limit: 100)",
    );
  });

  it("renders the loop as an Enum.reduce_while that halts on the first failure", async () => {
    const src = await reactor();
    expect(src).toContain("Enum.reduce_while(fs, {:ok, nil}, fn f, _acc ->");
    // The body must run INSIDE the callback — a nested statement hoisted out of
    // the loop would fire once instead of once per element.
    const loop = src.slice(src.indexOf("Enum.reduce_while"));
    expect(loop).toContain("Api.Community.create_note(%{member: f.follower, post: event.post})");
    expect(loop).toContain("err -> {:halt, err}");
    expect(loop).toContain("{:cont, {:ok, nil}}");
  });

  it("keeps the loop variable bound (not underscored) when the body reads it", async () => {
    const src = await reactor();
    expect(src).toContain("fn f, _acc ->");
    expect(src).not.toContain("fn _f, _acc ->");
  });

  it("discards the unread per-iteration bind so --warnings-as-errors stays clean", async () => {
    const src = await reactor();
    // `n` is never read after its create, so the bind must be `_n`.
    expect(src).toContain("{:ok, _n} <-");
    expect(src).not.toMatch(/\{:ok, n\} <-/);
  });
});

// The same loop carrying everything a reactor body can hold: a guard, a
// factory-let, an `emit`, and a read of the saga row — all INSIDE the loop.
// Each is a distinct hazard for an emitter whose top-level assembler buckets
// lines by kind (`renderBody` puts every guard first and every dispatch last).
//
// The saga row is read ONLY from inside the loop, deliberately: that is the
// case `bodyUsesThis` used to miss (it had no `for-each` arm), and any
// top-level `state` reference would mask it.
const RICH = `system S { subdomain D { context Community {
  aggregate Member { handle: string  derived display: string = handle }
  aggregate Post { author: Member id  title: string  derived display: string = title }
  aggregate Follow { follower: Member id  followee: Member id  derived display: string = "f" }
  aggregate Note { member: Member id  post: Post id  seen: bool  derived display: string = "n" }
  repository Members for Member { }
  repository Posts for Post { }
  repository Follows for Follow { }
  repository Notes for Note { }
  criterion FollowersOf(who: Member id) of Follow = followee == who
  event PostPublished { post: Post id, author: Member id }
  event Notified { post: Post id, member: Member id }
  channel Feed { carries: PostPublished, Notified }
  workflow FanOut {
    postId: Post id
    fanned: int
    on(e: PostPublished) by e.post {
      let fs = Follows.run(FollowersOf(e.author), page: { offset: 0, limit: 100 })
      for f in fs {
        precondition fanned >= 0
        let n = Note.create({ member: f.follower, post: e.post, seen: false })
        emit Notified { post: e.post, member: f.follower }
      }
    }
  }
} } api A from D storage pg { type: postgres }
  resource st { for: Community, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Community] serves: A dataSources: [st] port: 4000 } }`;

describe("phoenix reactor loop body: guard, emit and saga-state read", () => {
  async function rich(): Promise<string> {
    const files = await generateSystemFiles(RICH);
    return [...files.entries()].find(([k]) => k.endsWith("on_post_published.ex"))![1];
  }

  it("re-shapes a loop-body guard into a `<-` clause, not a throw", async () => {
    const src = await rich();
    // A top-level guard renders `unless …, do: throw(…)`.  Inside the loop that
    // would abort the whole handler mid-fan-out instead of halting the reduce,
    // so it must become a clause carrying the SAME tagged denial term.
    const loop = src.slice(src.indexOf("Enum.reduce_while"));
    expect(loop).toContain(
      ':ok <- (if state.fanned >= 0, do: :ok, else: {:error, {:precondition_failed, "Precondition failed: fanned >= 0"}})',
    );
    expect(loop).not.toContain("throw(");
  });

  it("keeps a loop-body `emit` INSIDE the loop, as a re-entrant dispatch", async () => {
    const src = await rich();
    const loop = src.slice(src.indexOf("Enum.reduce_while"), src.indexOf("end)"));
    // Hoisting it to the handler's do-branch (where `renderBody` sends every
    // top-level dispatch line) would fire one event for the whole fan-out.
    expect(loop).toContain(
      "Api.Community.Dispatcher.dispatch(%Api.Community.Events.Notified{post: event.post, member: f.follower})",
    );
  });

  it("binds `state` (not `_state`) when only the LOOP BODY reads the saga row", async () => {
    const src = await rich();
    // `bodyUsesThis` used to scan top-level statements only, with no `for-each`
    // arm — a `state.<field>` read nested in the loop was invisible, the handler
    // bound `_state`, and the loop then named an undefined variable under
    // `mix compile --warnings-as-errors`.
    expect(src).toContain("      state ->");
    expect(src).not.toContain("      _state ->");
    expect(src).toContain("state.fanned >= 0");
  });

  it("indents the nested with-chain's continuations under their own clause", async () => {
    const src = await rich();
    // `indent()` shifts every PHYSICAL line, but the with-chain assembler only
    // prefixes the FIRST line of a multi-line clause — so the loop body has to
    // be split on newlines before it is padded, or the nested chain's second
    // clause lands left of the `with` that opens it (valid Elixir, unreadable
    // output).
    const withLine = src.split("\n").find((l) => l.includes("with :ok <- (if state.fanned"))!;
    const nextClause = src.split("\n").find((l) => l.trimStart().startsWith("{:ok, _n} <-"))!;
    const col = (l: string) => l.length - l.trimStart().length;
    expect(col(nextClause)).toBe(col(withLine) + "with ".length);
  });
});
