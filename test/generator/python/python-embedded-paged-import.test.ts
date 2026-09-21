// ---------------------------------------------------------------------------
// Python / FastAPI backend — a `paged` find on a `shape: embedded` aggregate
// returns the `PagedResult` carrier, so the EMBEDDED repository builder must
// import it exactly as its four siblings do (relational / document /
// event-sourced / port all gate the same line on the emitted body).
//
// It was the one builder that never picked the gate up: the annotation and the
// constructor were both emitted with no import, so every such project failed
// `ruff check` with two × F821 and did not run.  Found by the pairwise compile
// oracle (`versioned-embedded-none-tph-paged-default`), red on `main` for a
// week; recorded as the live half of F13 in
// docs/audits/pairwise-corpus-findings-2026-08.md.
//
// The crossing is independent of inheritance — `embedded × paged` alone
// reproduces it, which is what this fixture pins.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const source = (read: string) => `
  system Shop {
    subdomain Sales {
      context Ordering {
        aggregate Order shape: embedded {
          label: string
          amount: int = 0
          contains lines: Line[]
          entity Line {
            sku: string
            qty: int
          }
        }
        repository Orders for Order {
          find byLabel(l: string): Order ${read} where this.label == l
        }
      }
    }
    api SalesApi from Sales
    storage primarySql { type: postgres }
    resource ordState { for: Ordering, kind: state, use: primarySql }
    deployable api {
      platform: python
      contexts: [Ordering]
      dataSources: [ordState]
      serves: SalesApi
      port: 8081
    }
  }
`;

const repoFor = async (read: string): Promise<string> => {
  const files = await generateSystemFiles(source(read));
  const entry = [...files.entries()].find(([p]) =>
    p.endsWith("app/db/repositories/order_repository.py"),
  );
  expect(entry, "order_repository.py missing").toBeDefined();
  return entry![1];
};

describe("python shape: embedded × a paged find", () => {
  it("imports the PagedResult carrier it annotates and constructs", async () => {
    const repo = await repoFor("paged");
    // Both uses are present …
    expect(repo).toContain("-> PagedResult[Order]:");
    expect(repo).toContain("return PagedResult(");
    // … so the import must be too (ruff F821 otherwise).
    expect(repo).toContain("from app.domain.paging import PagedResult");
  });

  it("does not import it when no find is paged (ruff F401)", async () => {
    const repo = await repoFor("");
    expect(repo).not.toContain("PagedResult");
  });
});
