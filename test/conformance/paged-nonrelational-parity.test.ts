import { describe, expect, it } from "vitest";
import { BACKENDS } from "../fixtures/corpus/backends.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// Ledger row F2-CB-C1 — `find … paged` over a NON-RELATIONAL carrier.
//
// The route, the repository DECLARATION (interface / Protocol / behaviour) and
// the response model all derive their contract from `pagedReturn(returnType)`,
// so they declared the paged shape — four extra wire controls and a paged
// envelope.  The document and event-log repository IMPLEMENTATIONS, which
// rehydrate the whole set and filter it in app, had no paged branch on .NET and
// python and kept emitting the unpaged method: a route built for one contract
// calling a repository built for the other (CS0535 + CS0029; a 5-argument call
// into a 1-argument `async def`, then `.items` on a bare aggregate).  Nothing
// diagnosed it — all five backends reported OK.
//
// THE ASSERTION IS A DISAGREEMENT, not a spelling.  Each arm reads the
// DECLARATION out of one emitted file and the IMPLEMENTATION out of a
// DIFFERENT one and requires both to carry the four paging controls — which is
// the shape of the defect (two emitters, one contract, no agreement), and takes
// the expected value from outside whichever emitter is under test rather than
// from a constant this test and the emitter share.
//
// Both carriers are swept (rule 11): they are separate builders on every
// backend, so a fix to one leaves the other's arm live here.  Each arm opens
// with a VACUITY GUARD that the named file exists and mentions the method — a
// renamed emit path must fail as a missing file, never pass as a satisfied
// `toContain`.
// ---------------------------------------------------------------------------

const FIXTURE = "paged-nonrelational";

/** The number of arguments a paged find's CALL SITE passes: the find's own
 *  params (one here) plus page / pageSize / sort / dir.  Counted from the call
 *  text, so it is independent of how the repository emitter spells the
 *  signature — the two disagreeing IS the defect. */
const PAGED_CALL_ARGS = 5;

/** The four paging controls, as each backend spells them in a signature. */
const CONTROLS: Record<string, readonly string[]> = {
  node: ["page: number", "pageSize: number", "sort: string", "dir: string"],
  dotnet: ["int page", "int pageSize", "string sort", "string dir"],
  java: ["int page", "int pageSize", "String sort", "String dir"],
  python: ["page: int", "page_size: int", "sort: str", "dir: str"],
  vanilla: ["page \\\\ 1", "page_size \\\\ 20", 'sort \\\\ "id"', 'dir \\\\ "asc"'],
};

interface Carrier {
  /** `shape: document` / `persistedAs: eventLog`, for the test name. */
  readonly carrier: string;
  /** The find's method name, per backend spelling. */
  readonly method: Record<string, string>;
  /** Where the CONTRACT is declared (interface / Protocol / behaviour). */
  readonly declaration: Record<string, string>;
  /** The declaration's own spelling of the name, when it differs from the
   *  implementation's — elixir's context module delegates under a
   *  `<find>_<aggregate>` alias, not the repository function's own name. */
  readonly declarationMethod?: Record<string, string>;
  /** Where it is IMPLEMENTED — a different file on every backend. */
  readonly implementation: Record<string, string>;
  /** The caller's own spelling of the name, when it differs (elixir calls the
   *  context module's `<find>_<aggregate>` delegate). */
  readonly callName?: Record<string, string>;
  /** Where the CALLER invokes it (route / handler / service / controller) —
   *  a THIRD emitter, and the one whose disagreement with the implementation IS
   *  the defect.  On python the Protocol is derived from the same builder as
   *  the implementation, so without this arm that backend would only be
   *  checking an emitter against itself. */
  readonly callSite: Record<string, string>;
}

const CARRIERS: readonly Carrier[] = [
  {
    carrier: "shape: document",
    method: {
      node: "inRegion",
      dotnet: "InRegion",
      java: "inRegion",
      python: "in_region",
      vanilla: "in_region",
    },
    declaration: {
      node: "domain/repository-ports.ts",
      dotnet: "Domain/Invoices/IInvoiceRepository.cs",
      java: "features/invoices/InvoiceRepository.java",
      python: "app/domain/repository_ports.py",
      vanilla: "lib/d/ledger.ex",
    },
    declarationMethod: { vanilla: "in_region_invoice" },
    implementation: {
      node: "db/repositories/invoice-repository.ts",
      dotnet: "Infrastructure/Repositories/InvoiceRepository.cs",
      java: "features/invoices/InvoiceRepositoryImpl.java",
      python: "app/db/repositories/invoice_repository.py",
      vanilla: "lib/d/ledger/invoice_repository.ex",
    },
    callName: { vanilla: "in_region_invoice" },
    callSite: {
      node: "http/invoice.routes.ts",
      dotnet: "Application/Invoices/Queries/InRegionHandler.cs",
      java: "features/invoices/InvoiceService.java",
      python: "app/http/invoice_routes.py",
      vanilla: "controllers/invoice_controller.ex",
    },
  },
  {
    carrier: "persistedAs: eventLog",
    method: {
      node: "byOwner",
      dotnet: "ByOwner",
      java: "byOwner",
      python: "by_owner",
      vanilla: "by_owner",
    },
    declaration: {
      node: "domain/repository-ports.ts",
      dotnet: "Domain/Accounts/IAccountRepository.cs",
      java: "features/accounts/AccountRepository.java",
      python: "app/domain/repository_ports.py",
      vanilla: "lib/d/ledger.ex",
    },
    declarationMethod: { vanilla: "by_owner_account" },
    implementation: {
      node: "db/repositories/account-repository.ts",
      dotnet: "Infrastructure/Repositories/AccountRepository.cs",
      java: "features/accounts/AccountRepositoryImpl.java",
      python: "app/db/repositories/account_repository.py",
      vanilla: "lib/d/ledger/account_repository.ex",
    },
    callName: { vanilla: "by_owner_account" },
    callSite: {
      node: "http/account.routes.ts",
      dotnet: "Application/Accounts/Queries/ByOwnerHandler.cs",
      java: "features/accounts/AccountService.java",
      python: "app/http/account_routes.py",
      vanilla: "controllers/account_controller.ex",
    },
  },
];

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no emitted file ends in ${suffix} — the arms below would pass vacuously`).toBeTypeOf(
    "string",
  );
  return files.get(key!)!;
}

/** Every CODE line declaring or defining `method` in `src`, joined.
 *
 *  Comments and elixir `@spec` attributes are dropped: a `@spec` restates the
 *  ARITY but not the default-argument text the assertions read, so leaving it in
 *  makes the elixir arm match the wrong line. */
function signatureLine(src: string, method: string): string {
  const decl = new RegExp(`\\b${method}\\b\\s*\\(`);
  const lines = src
    .split("\n")
    .filter((l) => decl.test(l))
    .filter((l) => !/^\s*(\/\/|\/\*|\*|#|@spec)/.test(l));
  expect(
    lines.length,
    `no signature line for '${method}' — the assertion would pass vacuously`,
  ).toBeGreaterThan(0);
  return lines.join("\n");
}

/** How many arguments the FIRST call to `method` in `src` passes.
 *
 *  Counts top-level commas inside the call's parentheses, so a nested call or a
 *  `Map.get(params, "sort", "id")` argument counts as ONE.  A trailing
 *  `cancellationToken` is dropped: .NET threads it on every async repository
 *  method, paged or not, so it is not part of the paged contract. */
function callArgs(src: string, method: string): number {
  const at = src.search(new RegExp(`(?:\\.|\\b)${method}\\s*\\(`));
  expect(at, `no call to '${method}' — the arity assertion would pass vacuously`).toBeGreaterThan(
    -1,
  );
  const open = src.indexOf("(", at);
  let depth = 0;
  let args = 1;
  let i = open;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) break;
    } else if (ch === "," && depth === 1) args++;
  }
  const inner = src.slice(open + 1, i);
  return /cancellationToken/i.test(inner) ? args - 1 : args;
}

describe("F2-CB-C1 — a paged find over a non-relational carrier", () => {
  for (const backend of BACKENDS) {
    describe(backend, () => {
      for (const c of CARRIERS) {
        const method = c.method[backend]!;
        it(`declares AND implements the paged contract for ${c.carrier}`, async () => {
          const files = await generateCorpusCase(FIXTURE, backend);
          const declared = signatureLine(
            bySuffix(files, c.declaration[backend]!),
            c.declarationMethod?.[backend] ?? method,
          );
          const implemented = signatureLine(bySuffix(files, c.implementation[backend]!), method);
          // The CALLER — a third emitter — passes the find's own argument plus
          // the four paging controls.  This is the assertion whose expected
          // value comes from neither the repository emitter nor a constant this
          // test shares with it: the route was ALWAYS built for the paged
          // contract, and the repository is what failed to offer it.
          const call = callArgs(
            bySuffix(files, c.callSite[backend]!),
            c.callName?.[backend] ?? method,
          );
          expect(
            call,
            `${backend}/${c.carrier}: the caller passes ${call} argument(s) to '${method}' — ` +
              `the paged contract is ${PAGED_CALL_ARGS} (the find's own + page/pageSize/sort/dir).`,
          ).toBe(PAGED_CALL_ARGS);
          for (const control of CONTROLS[backend]!) {
            expect(
              declared,
              `${backend}/${c.carrier}: the DECLARATION of '${method}' omits '${control}'`,
            ).toContain(control);
            expect(
              implemented,
              `${backend}/${c.carrier}: '${method}' is DECLARED paged but its IMPLEMENTATION omits ` +
                `'${control}' — the route is built for a contract the repository does not offer ` +
                `(F2-CB-C1 has regressed on this backend).`,
            ).toContain(control);
          }
        });
      }
    });
  }
});
