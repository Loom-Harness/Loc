// M-T6.93 — on java (JPA), two `getById` loads of one row inside a workflow are
// two independent handles, each carrying the version it read.
//
// JPA's persistence context handed a second `findById` of a managed row the
// SAME instance, so after `save(first)` bumped the version, `save(second)` read
// the bumped version off the shared object and its CAS succeeded — a stale
// write committed.  The fix: a repeat load of an already-managed row reads a
// DETACHED copy through a child Session on the transaction's connection, and
// saving such a handle merges it in a child Session too (never onto the managed
// first handle, which would hand that handle the bumped version).
//
// The runtime gate is the behavioural corpus case
// `workflow-two-handles-containment` on the `run-java.mjs` leg (pre-fix:
// `expected the call to reject, but it resolved`).  This file pins the emitted
// SHAPE it rests on, which no compile gate sees — dropping the fork compiles
// fine and silently re-aliases the handles.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const source = (caps: string): string => `system R {
  subdomain S { context C {
    aggregate Cart${caps} {
      name: string
      contains lines: Line[]
      entity Line { sku: string  qty: int }
      operation addLine(sku: string, qty: int) { lines += Line { sku: sku, qty: qty } }
    }
    repository Carts for Cart { }
    workflow addTwice transactional {
      create(c: Cart id) {
        let first = Carts.getById(c)
        let second = Carts.getById(c)
        first.addLine("A", 1)
        second.addLine("B", 1)
      }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: java, contexts: [C], dataSources: [st], port: 3000 }
}`;

const repoImpl = (files: Map<string, string>): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith("/CartRepositoryImpl.java"));
  expect(hit, "no CartRepositoryImpl.java emitted").toBeDefined();
  return hit![1];
};

/** The body of one Java method, from its signature to the next member. */
const method = (src: string, signature: string): string => {
  const start = src.indexOf(signature);
  expect(start, `no ${signature}`).toBeGreaterThan(-1);
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n {4}(@Override|public |private |\/\*\*)/);
  return src.slice(start, end === -1 ? undefined : start + signature.length + end);
};

describe("M-T6.93 — JPA loads a second handle of a managed row detached", () => {
  it("getById / findById read whether the row is managed BEFORE the scoped load, then swap in a detached handle", async () => {
    const repo = repoImpl(await generateSystemFiles(source(" with versioned")));
    const get = method(repo, "public Cart getById(CartId id) {");
    expect(get).toContain("var __shared = _isManaged(id);");
    expect(get.indexOf("var __shared = _isManaged(id);")).toBeLessThan(
      get.indexOf("var found = jpa.findById(id);"),
    );
    expect(get).toContain("return __shared ? _loadSecondHandle(id) : handle;");
    const find = method(repo, "public Optional<Cart> findById(CartId id) {");
    expect(find).toContain(
      "return __shared && found.isPresent() ? Optional.of(_loadSecondHandle(id)) : found;",
    );
  });

  it("the detached handle is read through a child Session sharing the transaction's connection", async () => {
    const repo = repoImpl(await generateSystemFiles(source(" with versioned")));
    const load = method(repo, "private Cart _loadSecondHandle(CartId id) {");
    expect(load).toContain("__session.flush();");
    expect(load).toContain(
      "__session.sessionWithOptions().connection().flushMode(org.hibernate.FlushMode.MANUAL).openSession()",
    );
    expect(load).toContain("return __fork.find(Cart.class, id);");
    const managed = method(repo, "private boolean _isManaged(CartId id) {");
    expect(managed).toContain("isActualTransactionActive()");
    expect(managed).toContain(
      "__s.getPersistenceContextInternal().containsEntity(__s.generateEntityKey(id, __p))",
    );
  });

  it("save writes a second handle through a child Session — never merged onto the managed first one — after the version CAS", async () => {
    const repo = repoImpl(await generateSystemFiles(source(" with versioned")));
    const save = method(repo, "public Cart save(Cart aggregate) {");
    expect(save).toContain(
      "var saved = _isSecondHandle(aggregate) ? _saveSecondHandle(aggregate) : jpa.save(aggregate);",
    );
    expect(save.indexOf("jpa.bumpVersion(")).toBeLessThan(save.indexOf("_isSecondHandle("));
    const second = method(repo, "private Cart _saveSecondHandle(Cart aggregate) {");
    expect(second).toContain("__fork.merge(aggregate);");
    expect(second).toContain("__fork.flush();");
    expect(repo).toContain("return !em.contains(aggregate) && _isManaged(aggregate.id());");
    expect(repo).toContain("@PersistenceContext");
  });

  it("an event-sourced aggregate (no state row, no `versioned`) keeps its own repository", async () => {
    const files = await generateSystemFiles(
      readFileSync("test/fixtures/corpus/event-sourcing.ddd", "utf8").replaceAll(
        "__PLATFORM__",
        "java",
      ),
    );
    const all = [...files.entries()].filter(([p]) => p.endsWith(".java")).map(([, c]) => c);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(c).not.toContain("_loadSecondHandle(");
      expect(c).not.toContain("_saveSecondHandle(");
    }
  });
});
