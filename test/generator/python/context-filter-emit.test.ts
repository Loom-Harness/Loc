// ---------------------------------------------------------------------------
// Python backend — capability filters.  A relational aggregate carrying
// `filter !this.isDeleted` applies that predicate to EVERY read through
// SQLAlchemy's global-criteria hook: one `do_orm_execute` listener in
// `app/db/read_scope.py` adds `with_loader_criteria(<Row>, …)` to each ORM
// SELECT (src/generator/python/read-scope-builder.ts).  The repository reads
// spell no filter conjunct at all, so no read path can forget one.  The node
// analogue is test/generator/typescript/context-filter-emit.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

const REPO = "api/app/db/repositories/customer_repository.py";
const SCOPE = "api/app/db/read_scope.py";

const SRC = `
system Shop {
  subdomain Sales {
    context Sales {
      aggregate Customer {
        name: string
        isDeleted: bool
        filter !this.isDeleted
      }
      repository Customers for Customer {
        find byName(n: string): Customer[] where name == n
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable api { platform: python, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 4000 }
}
`;

async function build(source: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(source);
  if (errors.length) throw new Error(`source has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

describe("python generator — capability filter (read-scope hook)", () => {
  it("hosts the filter in the hook and spells it in no repository read", async () => {
    const files = await build(SRC);
    const repo = files.get(REPO)!;
    const scope = files.get(SCOPE)!;
    expect(repo).toBeDefined();
    expect(scope).toBeDefined();

    expect(scope).toContain(
      "out.append(with_loader_criteria(CustomerRow, lambda cls: not_(cls.is_deleted), include_aliases=True))",
    );
    expect(scope).toContain('event.listen(Session, "do_orm_execute", _read_scope)');
    // The package init installs it, so every importer of `app.db` gets it.
    expect(files.get("api/app/db/__init__.py")).toContain("install_read_scope()");

    // The reads carry only their own predicates.
    expect(repo).not.toContain("is_deleted)");
    expect(repo).toContain("select(CustomerRow).where((CustomerRow.name == n))");
    expect(repo).toContain("select(CustomerRow).where(CustomerRow.id.in_(list(ids)))");
    // find_by_id runs SQL the hook narrows — never the identity-map get.
    expect(repo).toContain(
      "select(CustomerRow).where(CustomerRow.id == id).execution_options(populate_existing=True)",
    );
    expect(repo).not.toContain("self._session.get(");
  });

  it("emits no hook and no predicate when the aggregate has no filter", async () => {
    const files = await build(`
system Shop {
  subdomain Sales {
    context Sales {
      aggregate Plain {
        name: string
      }
      repository Plains for Plain {
        find byName(n: string): Plain[] where name == n
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable api { platform: python, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 4000 }
}
`);
    const repo = files.get("api/app/db/repositories/plain_repository.py")!;
    expect(repo).toBeDefined();
    expect(files.has(SCOPE)).toBe(false);
    expect(files.get("api/app/db/__init__.py")).toBe("");
    expect(repo).toContain(
      "await self._session.execute(select(PlainRow).order_by(_order).limit(page_size).offset(offset))",
    );
    expect(repo).toContain("row = await self._session.get(PlainRow, id)");
    expect(repo).not.toContain("and_(");
    expect(repo).not.toContain("not_(");
  });
});

// ---------------------------------------------------------------------------
// shape: embedded capability filters.  An embedded aggregate's root scalars
// are real columns, so its restrictions ride the same hook as the relational
// path.  Only `shape: document` filters in-app.
// ---------------------------------------------------------------------------

const EMBED_REPO = "api/app/db/repositories/cart_repository.py";

describe("python generator — capability filter on shape: embedded", () => {
  it("hosts a NON-PRINCIPAL filter in the hook for an embedded root", async () => {
    const files = await build(`
system Shop {
  subdomain Sales {
    context Sales {
      aggregate Cart shape: embedded {
        total: int
        archived: bool
        filter !this.archived
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable api { platform: python, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 4000 }
}
`);
    const repo = files.get(EMBED_REPO)!;
    expect(repo).toBeDefined();
    expect(files.get(SCOPE)).toContain(
      "with_loader_criteria(CartRow, lambda cls: not_(cls.archived), include_aliases=True)",
    );
    expect(repo).toContain("rows = (await self._session.execute(select(CartRow))).scalars().all()");
    expect(repo).toContain(
      "select(CartRow).where(CartRow.id == id).execution_options(populate_existing=True)",
    );
    expect(repo).toContain("select(CartRow).where(CartRow.id.in_(list(ids)))");
    expect(repo).not.toContain("not_(");
  });

  it("builds a PRINCIPAL filter from the request principal, failing closed without one", async () => {
    const files = await build(`
system Shop {
  user { id: string  tenantId: string }
  subdomain Sales {
    context Sales {
      aggregate Cart shape: embedded {
        total: int
        tenantId: string
        filter this.tenantId == currentUser.tenantId
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable api { platform: python, contexts: [Sales], dataSources: [salesState], serves: SalesApi, auth: required, port: 4000 }
}
`);
    const repo = files.get(EMBED_REPO)!;
    const scope = files.get(SCOPE)!;
    expect(repo).toBeDefined();
    // Built from the principal on each execution: a lambda's closure values
    // would be cached across requests.
    expect(scope).toContain("    user = current_user()");
    expect(scope).toContain(
      "out.append(with_loader_criteria(CartRow, (CartRow.tenant_id == user.tenant_id), include_aliases=True))",
    );
    // No principal: the read matches no row.
    expect(scope).toContain(
      "    if user is None:\n        out.append(with_loader_criteria(CartRow, false(), include_aliases=True))",
    );
    expect(repo).not.toContain("tenant_id ==");
  });

  it("keeps the embedded no-filter path on the primary-key get", async () => {
    const repo = (
      await build(`
system Shop {
  subdomain Sales {
    context Sales {
      aggregate Cart shape: embedded {
        total: int
        archived: bool
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable api { platform: python, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 4000 }
}
`)
    ).get(EMBED_REPO)!;
    expect(repo).toBeDefined();
    expect(repo).toContain("row = await self._session.get(CartRow, id)");
    expect(repo).toContain("rows = (await self._session.execute(select(CartRow))).scalars().all()");
    expect(repo).not.toContain("and_(");
    expect(repo).not.toContain("not_(");
  });
});
