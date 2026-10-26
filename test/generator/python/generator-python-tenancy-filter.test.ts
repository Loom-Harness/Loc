// ---------------------------------------------------------------------------
// Python backend — principal (tenancy) capability filter.
//
// `filter this.tenantId == currentUser.tenantId` has no compile-time
// principal, so the read-scope hook (`app/db/read_scope.py`) builds its
// criterion from the request's principal on every ORM execution — the
// ambient `ContextVar[User | None]` the auth middleware sets — and adds it
// with `with_loader_criteria` to every read of the row class: the auto
// find_by_id / all / find_many_by_ids and every custom find alike.  No read
// method gains a parameter and none spells the predicate.  With no principal
// the criterion is `false()`: a read matches no row.  The java analogue is
// test/generator/java/generator-java-tenancy-filter.test.ts.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

const SRC = readFileSync("test/e2e/fixtures/python-build/tenancy-filter.ddd", "utf8");
const REPO = "api/app/db/repositories/account_repository.py";
const SCOPE = "api/app/db/read_scope.py";

async function build(): Promise<Map<string, string>> {
  const { model, errors } = await parseString(SRC);
  if (errors.length) throw new Error(`source has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

describe("python generator — principal (tenancy) capability filter", () => {
  it("hosts the principal criterion in the read-scope hook", async () => {
    const scope = (await build()).get(SCOPE)!;
    expect(scope).toContain("from app.auth.user import current_user");
    expect(scope).toContain("    user = current_user()");
    expect(scope).toContain(
      "with_loader_criteria(AccountRow, (AccountRow.tenant_id == user.tenant_id), include_aliases=True)",
    );
  });

  it("fails closed with no principal", async () => {
    expect((await build()).get(SCOPE)).toContain(
      "    if user is None:\n        out.append(with_loader_criteria(AccountRow, false(), include_aliases=True))",
    );
  });

  it("leaves every repository read to the hook", async () => {
    const repo = (await build()).get(REPO)!;
    expect(repo).not.toContain("tenant_id ==");
    expect(repo).not.toContain("require_current_user");
    expect(repo).toContain("select(AccountRow).where((AccountRow.balance >= min))");
    // A guessed cross-tenant id runs SQL the hook narrows.
    expect(repo).toContain(
      "select(AccountRow).where(AccountRow.id == id).execution_options(populate_existing=True)",
    );
  });

  it("emits the ContextVar carrier + fail-closed accessor in app/auth/user.py", async () => {
    const user = (await build()).get("api/app/auth/user.py")!;
    expect(user).toContain("current_user_var: ContextVar[User | None] = ContextVar(");
    expect(user).toContain("def current_user() -> User | None:");
    expect(user).toContain("def require_current_user() -> User:");
    expect(user).toContain('raise PermissionError("unauthorized")');
    expect(user).toContain("tenant_id: str");
  });
});
