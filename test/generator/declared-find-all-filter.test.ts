import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Eval-closure item 2 — a DECLARED `find all(): X[] where <pred>` must keep its
// predicate on every backend.
//
// The `all` read is not a "custom" find on python or elixir: python's
// `emittableFinds` and elixir's `customFindsOf` both drop it, because the
// dedicated `all()` method / `list` CRUD seam IS that read.  But those seams
// were built from the capability filter alone, so the author's `where` was
// silently discarded and the list endpoint returned every row — while node,
// java and .NET applied it.  The fix AND-s the declared predicate into the
// all/list WHERE (both the plain and the paged list paths).
//
// Non-vacuity: each positive assertion names the rendered predicate itself, so
// a regression that drops it (the pre-fix shape: `select(DocRow)` /
// `Repo.all(Api.C.Doc)`) fails on the exact line.
// ---------------------------------------------------------------------------

function source(platform: string, finds: string, extra = ""): string {
  return `
system S {
  user { id: string  role: string }
  subdomain Sd {
    context C {
      aggregate Doc with crudish {
        title: string
        ownerUserId: string
      }
      repository Docs for Doc {
        ${finds}
      }
    }
  }
  api CApi from Sd
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable api { platform: ${platform}  contexts: [C]  dataSources: [cState]  serves: CApi  port: 4000 ${extra} }
}
`;
}

async function file(src: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no file ending ${suffix}`).toBeDefined();
  return files.get(key!)!;
}

const PY_REPO = "/app/db/repositories/doc_repository.py";
const EX_REPO = "/lib/api/c/doc_repository.ex";

describe("declared `find all() where …` keeps its filter (eval item 2)", () => {
  describe("python", () => {
    it("ANDs the predicate into the unpaged `all()` read", async () => {
      const body = await file(
        source("python", `find all(): Doc[] where ownerUserId != ""`),
        PY_REPO,
      );
      expect(body).toContain(
        `rows = (await self._session.execute(select(DocRow).where((DocRow.owner_user_id != "")))).scalars().all()`,
      );
      expect(body).not.toContain("execute(select(DocRow))).scalars()");
    });

    it("weaves the ambient principal accessor into a `currentUser` predicate", async () => {
      const body = await file(
        source("python", `find all(): Doc[] where ownerUserId == currentUser.id`, "auth: required"),
        PY_REPO,
      );
      const allMethod = body.slice(body.indexOf("async def all("));
      expect(allMethod.split("\n").slice(0, 3).join("\n")).toContain(
        "DocRow.owner_user_id == require_current_user().id",
      );
      expect(body).toMatch(/from app\.auth\.user import [^\n]*\brequire_current_user\b/);
    });

    it("keeps the synthesized `all` unfiltered (byte-identical control)", async () => {
      const body = await file(source("python", `find byTitle(t: string): Doc[]`), PY_REPO);
      expect(body).toContain(
        "await self._session.execute(select(func.count()).select_from(DocRow))",
      );
    });
  });

  describe("elixir", () => {
    it("ANDs the predicate into the unpaged `list` read", async () => {
      const body = await file(
        source("elixir", `find all(): Doc[] where ownerUserId != ""`),
        EX_REPO,
      );
      expect(body).toContain(
        `{:ok, from(record in Api.C.Doc, where: record.owner_user_id != "") |> Repo.all()}`,
      );
      expect(body).toContain("import Ecto.Query");
      expect(body).not.toContain("{:ok, Repo.all(Api.C.Doc)}");
    });

    it("ANDs the predicate into the PAGED `list` read", async () => {
      const body = await file(
        source("elixir", `find all(): Doc paged where ownerUserId != ""`),
        EX_REPO,
      );
      expect(body).toContain(
        `query = from(record in Api.C.Doc, where: record.owner_user_id != "")`,
      );
      expect(body).not.toContain("query = from(record in Api.C.Doc)\n");
    });

    it("threads the actor through repo, context and controller for a `currentUser` predicate", async () => {
      const src = source(
        "elixir",
        `find all(): Doc[] where ownerUserId == currentUser.id`,
        "auth: required",
      );
      const repo = await file(src, EX_REPO);
      expect(repo).toContain("def list(current_user \\\\ nil) do");
      expect(repo).toContain("where: record.owner_user_id == ^(current_user && current_user.id)");
      const ctx = await file(src, "/lib/api/c.ex");
      expect(ctx).toContain("defdelegate list_docs(current_user \\\\ nil)");
      const ctl = await file(src, "/lib/api_web/controllers/doc_controller.ex");
      const index = ctl.slice(ctl.indexOf("def index("));
      expect(index).toContain("current_user = Map.get(conn.assigns, :current_user)");
      expect(index).toContain("C.list_docs(current_user)");
    });
  });
});
