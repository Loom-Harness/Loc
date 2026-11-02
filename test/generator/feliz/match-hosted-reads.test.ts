// Reads that live inside a `match` arm — the Feliz read collector used to stop
// at the `match` node.
//
// THE GAP THIS CLOSES (silent, uncompilable F#).  `collectBodyReads`
// (src/generator/feliz/wire.ts) walks a page body for read-bearing `of:`
// arguments through a local `exprChildren` helper, which had no `match` arm.
// Every `QueryView` hosted by a `match` was therefore invisible to the MVU
// wiring, while the VIEW walk (which has no such gap) still emitted
// `View.remoteList model.<Field> …` for it.  The result was an `App.fs` whose
// view named Model fields that:
//
//   * the `Model` record never declares,
//   * `init` never seeds,
//   * no `Msg` case ever carries and no `update` arm ever stores,
//   * and no `Cmd` ever fetches.
//
// A hand-written `match` over page state whose arms each host a read has
// exactly that shape: both reads were dropped, not just one.
//
// Not proven by compilation here: `dotnet fable` is not available in this
// container, so these assertions read the emitted F# structurally.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** A `match` over a page `state {}` cell whose arms each host a `QueryView`,
 *  each over a different aggregate's list. */
const HAND_WRITTEN_MATCH = `
system Docs {
  subdomain Knowledge {
    context Library {
      aggregate Doc {
        title: string
        vis: string
        derived display: string = title
      }
      repository Docs for Doc
      aggregate Topic {
        name: string
        derived display: string = name
      }
      repository Topics for Topic
    }
  }
  api LibApi from Knowledge
  storage pg { type: postgres }
  resource libState { for: Library, kind: state, use: pg }
  ui WebApp {
    api K: LibApi
    page Browse {
      route: "/browse"
      title: "Browse"
      state { chosen: string = "" }
      body: Stack {
        Field("Visibility", bind: chosen),
        match {
          chosen != "" => QueryView {
            of: K.Topic.all,
            empty: Text { "No topics" },
            data: rows => For { each: rows, s => Text { s.name } }
          }
          else => QueryView {
            of: K.Doc.all,
            empty: Text { "No docs" },
            data: rows => For { each: rows, d => Text { d.title } }
          }
        }
      }
    }
  }
  deployable api { platform: node contexts: [Library] dataSources: [libState] serves: LibApi port: 8080 }
  deployable web { platform: feliz targets: api ui: WebApp { K: api } port: 3000 }
}
`;

async function appFs(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  return [...files].find(([p]) => p.endsWith("App.fs"))![1];
}

/** Every `model.<Field>` the emitted app READS, minus the record labels the
 *  `Model` type DECLARES — i.e. the fields nothing binds.  Empty is the
 *  invariant; a non-empty set is an F# "The record label is not defined"
 *  (FS0039) waiting to happen. */
function undeclaredModelFields(app: string): string[] {
  const decl = app.slice(app.indexOf("type Model ="), app.indexOf("type Msg ="));
  const declared = new Set([...decl.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]!));
  const used = new Set([...app.matchAll(/\bmodel\.(\w+)/g)].map((m) => m[1]!));
  return [...used].filter((f) => !declared.has(f)).sort();
}

describe("feliz reads hosted by a match arm", () => {
  it("a hand-written match over page state wires both arms' reads", async () => {
    const app = await appFs(HAND_WRITTEN_MATCH);
    expect(app).toContain("AllTopics: Remote<Topic list>");
    expect(app).toContain("AllDocs: Remote<Doc list>");
    expect(undeclaredModelFields(app)).toEqual([]);
  });
});
