// Criterion reads (`Repo.all(C(…))` / `Repo.find(C(…))`) desugar to a
// synthetic `findAllBy<C>` retrieval each backend renders as a runner.  Three
// predicate shapes the runners got wrong:
//
//  - python: the runner appends its own `offset` / `limit` paging keywords, so a
//    criterion param of either name was a duplicate argument (SyntaxError).
//    The colliding param is renamed in the signature AND the predicate.
//  - .NET EF: `this.<refColl>.contains(p)` over an `X id[]` field read the
//    navigation EF `Ignore`s (it lives in the join table) — untranslatable.
//    The repository filters through the join set; the spec keeps the sort.
//  - elixir: the same membership rendered the in-memory `Enum.member?` inside
//    an Ecto `where:`, which does not compile.  It is an `id in subquery(…)`
//    over the `many_to_many` association.
//
// And one shape every backend gets wrong in a different way, refused instead:
// a WHOLE value object as a query operand (`this.ref == r`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/index.js";

const src = (platform: string) => `
system X {
  subdomain S { context C {
    aggregate Pokemon with crudish { name: string }
    aggregate Trainer with crudish { name: string  party: Pokemon id[] }
    aggregate Product with crudish { price: money  name: string }
    repository Pokemons for Pokemon
    repository Trainers for Trainer
    repository Products for Product
    criterion CheaperThan(limit: money, offset: int) of Product = this.price < limit
    criterion HasPoke(p: Pokemon id) of Trainer = this.party.contains(p)
    criterion NamedWith(p: Pokemon id, n: string) of Trainer = this.party.contains(p) && this.name == n
    queryHandler Cheap(limit: money, offset: int): Product[] { let r = Products.all(CheaperThan(limit, offset)) return r }
    queryHandler Owners(p: Pokemon id): Trainer[] { let x = Trainers.all(HasPoke(p)) return x }
    queryHandler OwnersNamed(p: Pokemon id, n: string): Trainer[] { let x = Trainers.all(NamedWith(p, n)) return x }
  } }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [r], port: 3000 }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("python — criterion params named like the runner's paging keywords", () => {
  it("renames the colliding params in the signature and the predicate", async () => {
    const repo = await file("python", "db/repositories/product_repository.py");
    expect(repo).toContain(
      "async def run_find_all_by_cheaper_than(self, limit_: Decimal, offset_: int, offset: int | None = None, limit: int | None = None) -> list[Product]:",
    );
    expect(repo).toContain("query = select(ProductRow).where((ProductRow.price < limit_))");
    // The port is derived from the repository's signature.
    expect(await file("python", "domain/repository_ports.py")).toContain(
      "async def run_find_all_by_cheaper_than(self, limit_: Decimal, offset_: int, offset: int | None = None, limit: int | None = None)",
    );
  });

  it("callers still pass the criterion args positionally", async () => {
    expect(await file("python", "application/cheap.py")).toContain(
      "await products.run_find_all_by_cheaper_than(limit, offset)",
    );
  });
});

describe(".NET EF — reference-collection membership in a criterion read", () => {
  const repo = () => file("dotnet", "Infrastructure/Repositories/TrainerRepository.cs");

  it("filters through the join set in the repository; the spec carries no where", async () => {
    expect(await repo()).toContain(
      "var result = await __q.Where(x => _db.TrainerParties.Any(__j => __j.TrainerId == x.Id && __j.PokemonId == p)).WithSpecification(new FindAllByHasPokeSpec()).ApplyPaging(page).ToListAsync(cancellationToken);",
    );
    const spec = await file("dotnet", "Domain/Trainers/FindAllByHasPokeSpec.cs");
    expect(spec).toContain("public FindAllByHasPokeSpec()");
    expect(spec).not.toContain("Query.Where(");
  });

  it("a membership composed with a column test keeps both, in the repository", async () => {
    expect(await repo()).toContain(
      ".Where(x => _db.TrainerParties.Any(__j => __j.TrainerId == x.Id && __j.PokemonId == p) && x.Name == n).WithSpecification(new FindAllByNamedWithSpec())",
    );
  });

  it("the criterion keeps its in-memory face but has no untranslatable ToExpression", async () => {
    const crit = await file("dotnet", "Domain/Criteria/HasPokeCriterion.cs");
    expect(crit).toContain(
      "public override bool IsSatisfiedBy(Trainer candidate) => (candidate.Party).Contains(p);",
    );
    expect(crit).not.toContain("ToExpression()");
  });
});

describe("elixir — reference-collection membership in a criterion read", () => {
  it("queries the association's join table, not Enum.member? inside where:", async () => {
    const ret = await file("elixir", "c/retrievals/find_all_by_has_poke.ex");
    expect(ret).toContain(
      "query = from(record in Api.C.Trainer.base_query(), where: record.id in subquery(from(owner_row in Api.C.Trainer, join: member_row in assoc(owner_row, :party), where: member_row.id == ^p, select: owner_row.id)))",
    );
    expect(ret).not.toContain("Enum.member?");
    const composed = await file("elixir", "c/retrievals/find_all_by_named_with.ex");
    expect(composed).toContain(
      "where: record.id in subquery(from(owner_row in Api.C.Trainer, join: member_row in assoc(owner_row, :party), where: member_row.id == ^p, select: owner_row.id)) and record.name == ^n)",
    );
  });
});

describe("a whole value object as a criterion operand is refused", () => {
  const model = (body: string) => `
system X {
  subdomain S { context C {
    valueobject RefId { code: string }
    aggregate Order with crudish { ref: RefId  alt: RefId? }
    repository Orders for Order
    criterion Q(r: RefId, c: string) of Order = ${body}
    queryHandler H(r: RefId, c: string): Order[] { let x = Orders.all(Q(r, c)) return x }
  } }
  storage p { type: postgres }
  resource s { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [s], port: 3000 }
}`;
  async function errors(body: string) {
    const { model: m } = await parseString(model(body), { validate: false });
    return validateLoomModel(enrichLoomModel(lowerModel(m))).filter((d) => d.severity === "error");
  }

  it("`this.ref == r` names the value object and the leaf rewrite", async () => {
    const errs = await errors("this.ref == r");
    expect(errs.map((d) => d.code)).toContain("loom.retrieval-where-not-queryable");
    expect(errs.map((d) => d.message).join("\n")).toContain(
      "whole value object 'this.ref' (RefId) — a value object is stored as its fields",
    );
  });

  it("an optional value object compared with null is refused too", async () => {
    const errs = await errors("this.alt == null");
    expect(errs.map((d) => d.message).join("\n")).toContain(
      "whole value object 'this.alt' (RefId)",
    );
  });

  it("a value-object LEAF stays queryable", async () => {
    expect(await errors("this.ref.code == c")).toEqual([]);
  });
});
