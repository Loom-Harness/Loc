import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The paged-find ARITY CONTRACT between the two elixir emitters, on the
// `shape: document` path — pairwise finding F14.
//
// `context-emit.ts` emits ONE defdelegate head for every paged find, whatever
// the aggregate's saving shape:
//
//     defdelegate by_label_thing(l, page \\ 1, page_size \\ 20,
//                                sort \\ "id", dir \\ "asc"), to: …ThingRepository
//
// The RELATIONAL repository matched it; the DOCUMENT repository emitted only
// `page`/`page_size`, so the delegate named a function that does not exist:
//
//     warning: D.Main.ThingRepository.by_label/5 is undefined or private.
//     Did you mean: * by_label/1  * by_label/2  * by_label/3
//
// Under `mix compile --warnings-as-errors` — which is what the corpus and
// pairwise elixir legs run — that is a BUILD FAILURE, not a warning.  It went
// unseen because the arity is split across two files that no unit test read
// together, and the only gate that composes them boots docker.
//
// This test reads both halves out of the same emission, so the contract is
// pinned WITHOUT a toolchain: if either emitter changes its paged parameter
// list, this fails in the fast suite.
// ---------------------------------------------------------------------------

const SOURCE = `
system DocPaged {
  subdomain Core {
    context Main {
      aggregate Thing shape: document {
        label: string
        amount: int = 0
      }
      repository Things for Thing {
        find byLabel(l: string): Thing paged where this.label == l
      }
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main]
    dataSources: [mainState]
    serves: MainApi
    port: 4000
  }
}
`;

/** Count the parameters in an Elixir function head, `\\ default` included. */
function arityOf(head: string): number {
  const args = head.slice(head.indexOf("(") + 1, head.lastIndexOf(")")).trim();
  return args === "" ? 0 : args.split(",").length;
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key as string) as string;
}

describe("vanilla document — paged find arity matches its context delegate", () => {
  it("the repository head carries page, page_size, sort and dir", async () => {
    const repo = file(await generateSystemFiles(SOURCE), "/main/thing_repository.ex");
    const head = repo.split("\n").find((l) => l.includes("def by_label("));
    expect(head, "by_label head in the document repository").toBeDefined();
    // Named individually: an arity assertion alone would pass on four
    // parameters with the wrong names, and the delegate forwards positionally.
    expect(head).toContain("page \\\\ 1");
    expect(head).toContain("page_size \\\\ 20");
    expect(head).toContain('sort \\\\ "id"');
    expect(head).toContain('dir \\\\ "asc"');
  });

  it("the delegate's arity is one the repository actually defines", async () => {
    const files = await generateSystemFiles(SOURCE);
    const repo = file(files, "/main/thing_repository.ex");
    const context = file(files, "/lib/d/main.ex");
    const delegate = context.split("\n").find((l) => l.includes("defdelegate by_label_thing("));
    const head = repo.split("\n").find((l) => l.includes("def by_label("));
    expect(delegate, "by_label_thing delegate in the context").toBeDefined();
    expect(head, "by_label head in the document repository").toBeDefined();
    expect(arityOf(delegate as string)).toBe(arityOf(head as string));
  });

  it("sorts before slicing, so `sort`/`dir` are honoured and not merely accepted", async () => {
    const repo = file(await generateSystemFiles(SOURCE), "/main/thing_repository.ex");
    // Without this the arity could be repaired with two ignored parameters —
    // green gate, unchanged (wrong) behaviour.
    expect(repo).toContain("Enum.sort_by(");
    expect(repo).toContain('if(dir == "desc", do: :desc, else: :asc)');
    expect(repo).toContain("Enum.slice(sorted, offset, page_size)");
    expect(repo).toContain('"label" -> row.data.label');
  });
});
