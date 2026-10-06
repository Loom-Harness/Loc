// The elixir pure domain core on every persistence shape.
//
// A unit `test` block runs against the aggregate's PURE core — `<Agg>.create/1`
// and `<Agg>.<op>/2`, no Repo — which `domain-core-emit.ts` emits for any
// aggregate a unit test constructs.  That core existed only for the relational
// shape: an event-sourced or `shape: document` aggregate (as the test subject or
// as a sibling a test builds) left the emitted test calling a `create/1` nothing
// defined, `UndefinedFunctionError` at `mix test`.  And the relational create
// left `id` nil, so an id comparison in a test compared `nil == nil`.
//
// These are shape assertions; the emitted suites were also run under real
// `mix test` (Elixir 1.18 / OTP 27, no database) — see the PR that added this.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix} — the probe is stale`).toBeDefined();
  return hit![1];
}

const ES = `system Bank {
  subdomain Ledger {
    context Ledger {
      event Opened { account: Account id, owner: string }
      event Deposited { account: Account id, amount: int }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create open(owner: string) {
          precondition owner != ""
          emit Opened { account: id, owner: owner }
        }
        operation deposit(amount: int) {
          precondition amount > 0
          emit Deposited { account: id, amount: amount }
        }
        apply(e: Opened) { owner := e.owner  balance := 0 }
        apply(e: Deposited) { balance := balance + e.amount }
        test "opening folds the creation event" {
          let a = Account.create({ owner: "Ada", balance: 0 })
          expect(a.owner).toBe("Ada")
          let b = Account.create({ owner: "Bea", balance: 0 })
          expect(a.id == b.id).toBe(false)
          expect(Account.create({ owner: "", balance: 0 })).toThrow()
        }
        test "deposit folds" {
          let a = Account.create({ owner: "Ada", balance: 0 })
          a.deposit(5)
          expect(a.balance).toBe(5)
          expect(a.deposit(0)).toThrow()
        }
      }
      aggregate Statement with crudish {
        title: string
        test "a sibling event-sourced create" {
          let a = Account.create({ owner: "Bob", balance: 0 })
          expect(a.owner).toBe("Bob")
        }
      }
    }
  }
  api LedgerApi from Ledger
  storage primary { type: postgres }
  resource st { for: Ledger, kind: state, use: primary }
  resource ev { for: Ledger, kind: eventLog, use: primary }
  deployable d {
    platform: elixir
    contexts: [Ledger]
    dataSources: [st, ev]
    serves: LedgerApi
    port: 4000
  }
}`;

const DOC = `system DocSys {
  subdomain Cms {
    context Cms {
      enum Stage { Draft, Live }
      aggregate Article shape: document, with crudish {
        title: string
        viewCount: int
        stage: Stage
        operation bump() {
          precondition viewCount < 10
          viewCount := viewCount + 1
        }
        operation restage(to: Stage) { stage := to }
        test "document create + ops in memory" {
          let a = Article.create({ title: "T1", viewCount: 0, stage: Live })
          expect(a.stage).toBe(Live)
          a.bump()
          expect(a.viewCount).toBe(1)
          a.restage(Draft)
          expect(a.stage).toBe(Draft)
        }
      }
      valueobject Ref { article: Article id  note: string }
      aggregate Shelf with crudish {
        name: string
        ref: Ref
        test "a sibling document create carries a real id" {
          let a = Article.create({ title: "T", viewCount: 0, stage: Draft })
          let s = Shelf.create({ name: "S", ref: Ref { article: a.id, note: "n" } })
          expect(s.ref.article == a.id).toBe(true)
          expect(s.id != null).toBe(true)
        }
      }
    }
  }
  api CmsApi from Cms
  storage primary { type: postgres }
  resource cmsState { for: Cms, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Cms]
    dataSources: [cmsState]
    serves: CmsApi
    port: 4000
  }
}`;

describe("elixir pure core — event-sourced aggregates", () => {
  it("the struct module defines the create/1 and op/2 the emitted test calls", async () => {
    const files = await generateSystemFiles(ES);
    const mod = file(files, "lib/d/ledger/account.ex");
    const test = file(files, "test/ledger/account_test.exs");
    expect(test).toContain("D.Ledger.Account.create(%{owner: ");
    expect(test).toContain("D.Ledger.Account.deposit(a, %{");
    expect(mod).toMatch(/^ {2}def create\(attrs\) when is_map\(attrs\) do$/m);
    expect(mod).toMatch(
      /^ {2}def deposit\(%__MODULE__\{\} = state, params\) when is_map\(params\) do$/m,
    );
    expect(test).not.toContain("@tag :skip");
  });

  it("folds the emitted events through the same Fold the event store replays", async () => {
    const mod = file(await generateSystemFiles(ES), "lib/d/ledger/account.ex");
    expect(mod).toContain("{:ok, D.Ledger.AccountFold.from_events(id, events)}");
    expect(mod).toContain(
      "Enum.reduce(events, state, fn ev, acc -> D.Ledger.AccountFold.apply_event(acc, ev) end)",
    );
    // Pure: the core never appends to the event log.
    expect(mod).not.toContain("AccountRepository");
  });

  it("mints the id the creation event carries", async () => {
    const mod = file(await generateSystemFiles(ES), "lib/d/ledger/account.ex");
    expect(mod).toContain("    id = UUIDv7.generate()");
    expect(mod).toContain("%D.Ledger.Events.Opened{account: id, owner: owner}");
  });

  it("a guarded create answers the runner's denial term; a guarded op raises GuardError", async () => {
    const files = await generateSystemFiles(ES);
    const mod = file(files, "lib/d/ledger/account.ex");
    expect(mod).toContain(
      ':ok <- if(owner != "", do: :ok, else: {:error, {:precondition_failed, "Precondition failed: owner != \\"\\""}})',
    );
    expect(mod).toContain("raise(D.GuardError, kind: :precondition");
    const test = file(files, "test/ledger/account_test.exs");
    expect(test).toContain(
      'assert {:error, _} = D.Ledger.Account.create(%{owner: "", balance: 0})',
    );
    expect(test).toContain("assert_raise D.GuardError, fn -> D.Ledger.Account.deposit(a, %{");
  });

  it("a SIBLING's test that constructs the aggregate reaches the same core", async () => {
    const files = await generateSystemFiles(ES);
    expect(file(files, "test/ledger/statement_test.exs")).toContain(
      'D.Ledger.Account.create(%{owner: "Bob", balance: 0})',
    );
    expect(file(files, "lib/d/ledger/account.ex")).toMatch(/^ {2}def create\(attrs\)/m);
  });

  it("an event-sourced aggregate no unit test reaches keeps a bare struct module", async () => {
    const model = ES.replace(
      / {8}test "opening[\s\S]*?\n {8}}\n {8}test "deposit[\s\S]*?\n {8}}\n/,
      "",
    ).replace(/ {8}test "a sibling[\s\S]*?\n {8}}\n/, "");
    expect(model).not.toContain('test "');
    const mod = file(await generateSystemFiles(model), "lib/d/ledger/account.ex");
    expect(mod).not.toContain("def create(");
  });

  it("a create with no guard cannot fail in memory, so its toThrow skips with the reason", async () => {
    const model = ES.replace('          precondition owner != ""\n', "");
    expect(model).not.toContain('precondition owner != ""');
    const test = file(await generateSystemFiles(model), "test/ledger/account_test.exs");
    expect(test).toContain("@tag :skip");
    expect(test).toContain("toThrow over an event-sourced create");
    expect(test).not.toContain('Account.create(%{owner: "", balance: 0})');
  });

  it("an aggregate with no create has no pure constructor, so the test skips", async () => {
    const model = ES.replace(
      /create open\(owner: string\) \{[\s\S]*?emit Opened \{ account: id, owner: owner \}\n {8}}/,
      "",
    );
    expect(model).not.toContain("create open(");
    const files = await generateSystemFiles(model);
    const test = file(files, "test/ledger/statement_test.exs");
    expect(test).toContain("@tag :skip");
    expect(test).toContain("declares no `create`");
    expect(file(files, "lib/d/ledger/account.ex")).not.toContain("def create(");
  });
});

describe("elixir pure core — document aggregates", () => {
  it("the root module defines create/1 over the Data embed, and the ops over its struct", async () => {
    const files = await generateSystemFiles(DOC);
    const mod = file(files, "lib/d/cms/article.ex");
    expect(mod).toMatch(/^ {2}def create\(attrs\) when is_map\(attrs\) do$/m);
    expect(mod).toContain("D.Cms.Article.Data.changeset(%D.Cms.Article.Data{}, attrs)");
    expect(mod).toContain("def bump(%D.Cms.Article.Data{} = record, _params) do");
    expect(file(files, "test/cms/article_test.exs")).not.toContain("@tag :skip");
  });

  it("writes the Data embed BEFORE the root module that names its struct", async () => {
    // A struct literal expands at compile time, so within one file the embed
    // must be defined first or `%D.Cms.Article.Data{}` fails to compile.
    const mod = file(await generateSystemFiles(DOC), "lib/d/cms/article.ex");
    expect(mod.indexOf("defmodule D.Cms.Article.Data do")).toBeGreaterThanOrEqual(0);
    expect(mod.indexOf("defmodule D.Cms.Article.Data do")).toBeLessThan(
      mod.indexOf("defmodule D.Cms.Article do"),
    );
  });

  it("a document no unit test reaches is byte-identical: root first, no core", async () => {
    const model = DOC.replace(/ {8}test "document create[\s\S]*?\n {8}}\n/, "").replace(
      / {8}test "a sibling document[\s\S]*?\n {8}}\n/,
      "",
    );
    expect(model).not.toContain('test "');
    const mod = file(await generateSystemFiles(model), "lib/d/cms/article.ex");
    expect(mod).not.toContain("def create(");
    expect(mod.indexOf("defmodule D.Cms.Article do")).toBeLessThan(
      mod.indexOf("defmodule D.Cms.Article.Data do"),
    );
  });

  it("mints an id onto the in-memory record (the embed itself carries none)", async () => {
    const mod = file(await generateSystemFiles(DOC), "lib/d/cms/article.ex");
    expect(mod).toContain("{:ok, Map.put(record, :id, UUIDv7.generate())}");
    // The stored blob stays id-free: no `id` field joins the embed.
    expect(mod).not.toMatch(/field :id\b/);
  });

  it("speaks the embed's string enums in attrs, op params and reads", async () => {
    const test = file(await generateSystemFiles(DOC), "test/cms/article_test.exs");
    expect(test).toContain('D.Cms.Article.create(%{title: "T1", view_count: 0, stage: "Live"})');
    expect(test).toContain('assert a.stage == "Live"');
    expect(test).toContain('D.Cms.Article.restage(a, %{"to" => "Draft"})');
    expect(test).toContain('assert a.stage == "Draft"');
  });
});

describe("elixir pure core — the relational create mints its id", () => {
  it("seeds the struct with a UUIDv7 id, as the schema's autogenerate does on insert", async () => {
    const files = await generateSystemFiles(DOC);
    expect(file(files, "lib/d/cms/shelf.ex")).toContain(
      "D.Cms.ShelfChangeset.base_changeset(%__MODULE__{id: UUIDv7.generate()}, attrs)",
    );
    // A document SIBLING built inside a relational subject's test still speaks
    // the embed's string enums — the rule follows the record, not the subject.
    expect(file(files, "test/cms/shelf_test.exs")).toContain('stage: "Draft"');
  });
});
