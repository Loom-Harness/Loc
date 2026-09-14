// `<Ctx>Dispatcher` must declare + inject every repository the REACTOR bodies
// it renders actually call.
//
// It sized its injected repository set with `reposUsed(wf, ctx)`, which walks
// `wf.statements` — the PRIMARY-CREATE FACADE.  A reactor-only workflow has an
// empty facade, so a body that reads `Follows` and saves a `Note` compiled to:
//
//   var fs = followsRepository.runFindAllByFollowersOf(e.author());   // undeclared
//   for (var f : fs) { var n = Note.create(...); notesRepository.save(n); }  // undeclared
//
//   CommunityDispatcher.java:40: error: cannot find symbol
//     symbol: variable followsRepository   location: class CommunityDispatcher
//   CommunityDispatcher.java:43: error: cannot find symbol
//     symbol: variable notesRepository     location: class CommunityDispatcher
//
// — verified against a real `gradle testClasses bootJar` (gradle:9-jdk25), which
// now BUILDS SUCCESSFUL on the same model.
//
// The fix is `reactorReposUsed`: the same derivation, over the bodies this class
// ACTUALLY renders (every `on` reactor, every `create` starter, every named
// `handle`) plus their saves — and riding `walkWorkflowStmtsDeep`, so an
// `if-let` branch's binds and `savesInThen`/`savesInElse` count too (the
// hand-rolled recursion it replaces descended into `for-each` bodies only).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const FANOUT = `system S { subdomain D { context Community {
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
  deployable api { platform: java contexts: [Community] serves: A dataSources: [st] port: 8080 } }`;

async function dispatcher(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const hit = [...files.entries()].find(([k]) => k.endsWith("Dispatcher.java"));
  expect(hit, "dispatcher not emitted").toBeDefined();
  return hit![1];
}

describe("java dispatcher injects the repositories its reactor bodies use", () => {
  it("declares a field for every repository the reactor body calls", async () => {
    const d = await dispatcher(FANOUT);
    expect(d).toContain("private final FollowRepository followsRepository;");
    expect(d).toContain("private final NoteRepository notesRepository;");
  });

  it("takes them as constructor parameters and assigns them", async () => {
    const d = await dispatcher(FANOUT);
    expect(d).toMatch(
      /public CommunityDispatcher\([^)]*FollowRepository followsRepository[^)]*NoteRepository notesRepository[^)]*\)/,
    );
    expect(d).toContain("this.followsRepository = followsRepository;");
    expect(d).toContain("this.notesRepository = notesRepository;");
  });

  it("imports both repository types", async () => {
    const d = await dispatcher(FANOUT);
    expect(d).toContain("FollowRepository;");
    expect(d).toContain("NoteRepository;");
  });

  it("every repository field the body references is declared (the javac gate, structurally)", async () => {
    const d = await dispatcher(FANOUT);
    // Collect `<x>Repository.<method>(` receivers used anywhere in the class,
    // then require each to have a matching `private final … <x>Repository;`.
    const used = new Set(
      [...d.matchAll(/\b([a-z][A-Za-z0-9]*Repository)\.\w+\(/g)].map((m) => m[1] as string),
    );
    expect(used.size, "the fixture must actually call repositories").toBeGreaterThan(0);
    const undeclared = [...used].filter(
      (name) => !new RegExp(`private final \\w+ ${name};`).test(d),
    );
    expect(undeclared, `dispatcher references undeclared repository field(s)`).toEqual([]);
  });

  it("covers an event-triggered `create` STARTER body too, not just `on` reactors", async () => {
    // The dispatcher renders both body kinds, so both must feed the injection
    // set.  The fixture keeps a COMMAND create alongside the event starter on
    // purpose: `wf.statements` then resolves to the command body (`creates
    // .find(c => c.name === null && c.triggerKind === "command")`), leaving the
    // starter's body just as invisible to the facade as a reactor's.  With the
    // starter ALONE the facade falls back to `creates[0]` — which is the
    // starter — and the bug does not reproduce.
    const d = await dispatcher(
      FANOUT.replace(
        "on(e: PostPublished) by e.post {",
        "create bootstrap(p: Post id) { let sp = Posts.getById(p) }\n    create(e: PostPublished) by e.post {",
      ),
    );
    expect(d).toContain("private final FollowRepository followsRepository;");
    expect(d).toContain("private final NoteRepository notesRepository;");
    const used = new Set(
      [...d.matchAll(/\b([a-z][A-Za-z0-9]*Repository)\.\w+\(/g)].map((m) => m[1] as string),
    );
    expect([...used].filter((name) => !new RegExp(`private final \\w+ ${name};`).test(d))).toEqual(
      [],
    );
  });
});
