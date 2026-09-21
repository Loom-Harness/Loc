// A find the author DECLARED as `all`, with a `where`, on all five backends.
//
// `find all(): Doc[] where ownerUserId != ""` is an ordinary read restriction.
// Two backends DROPPED it — silently, with no compile error and no diagnostic:
//
//   node    `.where(ne(schema.docs.ownerUserId, ""))`             ✅
//   dotnet  `.Where(x => x.OwnerUserId != "")`                    ✅
//   java    `@Query("… where e.ownerUserId <> ''")`               ✅
//   python  `async def all(self)` running `select(DocRow)`        ❌ no where
//   elixir  `def list` running `Repo.all(Api.C.Doc)`              ❌ no where
//
// Both drop every find NAMED `all` from their custom-find list (`emittableFinds`
// / `customFindsOf`) to avoid colliding with the CRUD `list` seam — but that
// NAME test cannot tell the enrichment-synthesized auto-`findAll` (which carries
// no filter) from an author-declared `all` (which does).  So the author's
// restriction vanished and the UNFILTERED CRUD seam answered in its place.
//
// For a read restriction that is not a missing feature, it is an authorization
// bypass: the same model, generated for python or elixir instead of node,
// returns rows the `.ddd` says are out of scope.  It is also why the shape hid
// for so long — the F-007 repro names its find `all`, so on those two backends
// the predicate never reached the query lowerer at all and the generator
// reported success while emitting an unrestricted read.
//
// The fix applies the declared predicate to the seam that answers in its place,
// which is also why the `where` is asserted on the LIST path here rather than on
// a method of its own: there is no second method, by design.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SRC = (platform: string) => `
system DeclaredAll {
  subdomain S {
    context C {
      aggregate Doc {
        ownerUserId: string
        title: string
      }
      repository Docs for Doc {
        find all(): Doc[] where ownerUserId != ""
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: ${platform} contexts: [C] dataSources: [st] port: 3000 }
}`;

/** One emitted file, by path suffix — fails loudly rather than asserting over
 *  an empty string when the emitter renames a file. */
function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) {
    throw new Error(
      `no emitted file ending in '${suffix}'.  Emitted:\n  ${[...files.keys()].join("\n  ")}`,
    );
  }
  return hit[1];
}

describe("a DECLARED `find all(...) where <pred>` reaches the emitted query", () => {
  it("python: the list seam carries the predicate", async () => {
    const files = await generateSystemFiles(SRC("python"));
    const repo = file(files, "app/db/repositories/doc_repository.py");
    const all = repo.slice(repo.indexOf("async def all("));
    const body = all.slice(0, all.indexOf("\n    async def", 1));
    // The regression: `select(DocRow)` with no `.where(...)` at all.
    expect(body).toContain('DocRow.owner_user_id != ""');
  });

  it("elixir: the list seam carries the predicate", async () => {
    const files = await generateSystemFiles(SRC("elixir"));
    const repo = file(files, "/c/doc_repository.ex");
    const list = repo.slice(repo.indexOf("def list"));
    const body = list.slice(0, list.indexOf("\n  end") + 1);
    // The regression: a bare `Repo.all(Api.C.Doc)`.
    expect(body).toContain('record.owner_user_id != ""');
  });

  // ---------------------------------------------------------------------
  // The declared `all` whose predicate reads the PRINCIPAL.  Both backends
  // answer it through a seam that has no `current_user` parameter, so the
  // actor has to arrive some other way — and on both, the first fix bound it
  // in ONE place and left the other emitting a name nothing defines.  Each of
  // these was found by a REAL TOOLCHAIN on the generated project, not by an
  // emission assertion, which is the whole argument for the corpus compile
  // tier.
  // ---------------------------------------------------------------------
  const PRINCIPAL_SRC = (platform: string) => `
system DeclaredAllActor {
  user { id: string  role: string }
  subdomain S {
    context C {
      aggregate Doc with crudish {
        ownerUserId: string
        title: string
      }
      repository Docs for Doc {
        find all(): Doc[] where ownerUserId == currentUser.id
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  api A from S
  deployable api { platform: ${platform} contexts: [C] serves: A dataSources: [st] auth: required port: 3000 }
}`;

  it("elixir: the UNGATED index action binds the actor it passes", async () => {
    const files = await generateSystemFiles(PRINCIPAL_SRC("elixir"));
    const controller = file(files, "controllers/doc_controller.ex");
    const index = controller.slice(controller.indexOf("def index("));
    const body = index.slice(0, index.indexOf("\n  end") + 1);
    // The regression: `C.list_docs(current_user)` with nothing binding it —
    // `** (CompileError) undefined variable "current_user"`.  It hid because
    // the binding WAS emitted on the `requires`-gated arm of `index`, and the
    // F-007 repro carried `requires true`, so it took that arm.
    expect(body).toContain("current_user = Map.get(conn.assigns, :current_user)");
    expect(body).toMatch(/list_docs\(current_user\)/);
  });

  it("python: the ambient accessor the list seam calls is IMPORTED", async () => {
    const files = await generateSystemFiles(PRINCIPAL_SRC("python"));
    const repo = file(files, "app/db/repositories/doc_repository.py");
    expect(repo).toContain("require_current_user()");
    // The regression: the call emitted, the import not — `mypy` → `Name
    // "require_current_user" is not defined [name-defined]`, which is the same
    // runtime NameError one line higher up.
    expect(repo).toMatch(/^from app\.auth\.user import .*\brequire_current_user\b/m);
  });

  it("node keeps its already-correct predicate", async () => {
    const files = await generateSystemFiles(SRC("node"));
    expect(file(files, "db/repositories/doc-repository.ts")).toContain(
      'schema.docs.ownerUserId, ""',
    );
  });

  it.each([
    ["dotnet", 'OwnerUserId != ""'],
    ["java", "e.ownerUserId <> ''"],
  ] as const)("%s keeps its already-correct predicate", async (platform, needle) => {
    const files = await generateSystemFiles(SRC(platform));
    // .NET and java each split the read across an interface / port and its
    // impl; assert over every emitted file so a move between them is not a
    // failure, while an ABSENT predicate still is.
    const hit = [...files.values()].some((c) => c.includes(needle));
    expect(hit, `no emitted ${platform} file carries the declared \`all\` predicate`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A `bool` PARAMETER compared against a `bool` column (python).
//
// The request-constant fold that lets `currentUser.role == "admin"` lower to a
// host-language boolean is keyed on the shape "row-free and boolean" — and a
// bare `bool` find parameter is exactly that.  Folded in VALUE position it
// replaced the right-hand side of an ordinary comparison with the always-term:
//
//   SELECT … WHERE tickets.note = (tickets.id IS NOT NULL)      -- wrong rows
//
// emitted under `0 error(s)`.  The same re-entry crashed outright where the
// operand was the whole predicate — `RangeError: Maximum call stack size
// exceeded` out of `ddd generate system` (`pipeline-fuzz`, seeds 1 and 11) —
// so one defect had a loud half and a silent half.  The fold now happens only
// where a boolean is what the position wants.
// ---------------------------------------------------------------------------

const BOOL_PARAM_SRC = `
system BoolParam {
  subdomain S {
    context C {
      aggregate Ticket with crudish {
        note: bool
        title: string
      }
      repository Tickets for Ticket {
        find byNote(v: bool): Ticket[] where this.note == v
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: python contexts: [C] dataSources: [st] port: 3000 }
}`;

const BOOL_CONST_SRC = `
system BoolConst {
  subdomain S {
    context C {
      aggregate Doc with crudish {
        title: string
      }
      repository Docs for Doc {
        find visible(flag: bool): Doc[] where flag == true
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: python contexts: [C] dataSources: [st] port: 3000 }
}`;

describe("a `bool` parameter in value position is the parameter, not an always-term", () => {
  it("python compares the column against the parameter", async () => {
    const files = await generateSystemFiles(BOOL_PARAM_SRC);
    const repo = file(files, "db/repositories/ticket_repository.py");
    expect(repo).toContain("TicketRow.note == v");
    // The always-term's signature — `id IS NOT NULL` chosen because it is true
    // for every row.  Spliced HERE it is the folded parameter, and the read
    // answers for rows the `.ddd` excluded.
    expect(repo).not.toContain("TicketRow.id.isnot(None) if v");
  });

  // The OTHER side of the same seam: a comparison that genuinely IS a request
  // constant (`flag == true` — no column on either side) still folds, and its
  // operands are rendered by the ordinary arms.  Lowering an operand through
  // the fold again would not terminate: `flag` is itself a request constant,
  // so `lower` -> `requestConstantHost` -> `val` -> `lower` cycles on it.
  it("python folds a genuinely request-constant comparison, operands and all", async () => {
    const files = await generateSystemFiles(BOOL_CONST_SRC);
    const repo = file(files, "db/repositories/doc_repository.py");
    expect(repo).toContain("DocRow.id.isnot(None) if flag == True");
  });
});
