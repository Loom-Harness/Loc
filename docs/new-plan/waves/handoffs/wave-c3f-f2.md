# Wave C3F — packet F2 (.NET / Dapper): hand-off

Branch `claude/c3f-f2`, cut from `origin/main` `4233416e6`. Items come from the 3d D-table in
`wave-c3-3d-promote.md`. Each was re-checked on fresh `main` before any work.

| Item | Outcome | Where |
|---|---|---|
| **D5** Dapper does not enforce `unique (…)` | **Covered by open draft #3204** (`claude/dapper-unique-index`). Not rebuilt here. That PR renders the MigrationsIR unique indexes into `DbSchema.cs` via a new `renderCreateIndexIfNotExists` in `sql-pg.ts`. Verified below. | #3204 |
| **D8** `aggregate Event` → CS0104 against `EventId` | **Fixed here.** | this branch |
| **D12** find param named `x` → CS0019 | **Covered by open PR #3185** (now ready, not draft). `find-emit.ts` renames the lambda parameter through `csLocalNamer` when a param is named `x`. Still reproduces on `main`: `.Where(x => x.Price >= x)`. | #3185 |

## D8 — the fix

Root cause: the main project is `Microsoft.NET.Sdk.Web` with `<ImplicitUsings>`. That adds
`global using Microsoft.Extensions.Logging;`, which declares `struct EventId`. So in every file
that imports `<ns>.Domain.Ids`, the domain `EventId` is ambiguous. That gives 13 × CS0104 (plus
one Mediator CS0311) on EF and on Dapper.

```ddd
aggregate Event with crudish { title: string  startsAt: datetime }
```
```cs
// Domain/Ids/EventId.cs — before: 13 × CS0104
// after:
// Auto-generated.
global using EventId = D.Domain.Ids.EventId;

namespace D.Domain.Ids;

public readonly record struct EventId(Guid Value) { … }
```

- `bcl-collision.ts`: a new `IMPLICIT_USING_COLLIDING_ID_NAMES` set (only `EventId`) and
  `implicitUsingIdAlias()`. A using alias outranks a namespace import at the same scope. Every
  other id file is byte-identical.
- `emit/ids.ts` `renderId`: prepends the alias. This covers aggregate ids, part ids and the
  foreign-id copies.
- Once that compiles, the next error is **CA1716** (`Event` is a Visual Basic keyword).
  `emit/program.ts` adds CA1716 to the csproj `NoWarn` next to CA1711, with the same rationale:
  the domain noun is not Loom's to rename. The two `test/fixtures/baseline-output/*/…csproj`
  fixtures are updated to match.
- Test: `test/generator/dotnet/bcl-type-collision.test.ts`, new describe "id type colliding
  with an implicit SDK using". It has an EF case, a Dapper case and a control case (`Meetup`).

**Mutation proof** (file copied aside, mutated, copied back):
- Alias forced to `undefined` → both adapter cases fail:
  `expected '// Auto-generated.\nnamespace Api.Dom…' to contain 'global using EventId = Api.Domain.Ids…'`.
- CA1716 removed from `NoWarn` → both fail:
  `expected '<!-- Auto-generated. -->\n<Project Sd…' to match /<NoWarn>[^<]*\bCA1716\b/`.

**Compile evidence** (docker `mcr.microsoft.com/dotnet/sdk:10.0`, `dotnet build /warnaserror`).
Repro: `test/fixtures/corpus/seed-values.ddd` with `Meetup`→`Event` and `meetups`→`events`.
- `main`, EF: 13 Error(s), all CS0104 `'EventId' is an ambiguous reference between
  'D.Domain.Ids.EventId' and 'Microsoft.Extensions.Logging.EventId'`, plus CS0311 in the
  Mediator generator.
- Alias only: 1 Error, CA1716 on `class Event`.
- Branch tip, EF: `Build succeeded. 0 Warning(s) 0 Error(s)`.
- Branch tip, Dapper: `Build succeeded. 0 Warning(s) 0 Error(s)`.

## D5 — verification of #3204 (no code here)

#3204's tip (`5092cb72d`) was merged with fresh `main` locally. The merge is clean.
- `tsc -b` is clean.
- `dapper-unique-index.test.ts` and `dotnet-unique-conflict.test.ts` pass (3/3).

Runtime check: the model is `aggregate Sku with crudish { code, name, unique (code) }` on
`platform: dotnet { persistence: dapper }`. It ran with `dotnet run` in the SDK container against
`postgres:17-alpine`, and the duplicate was `POST /api/skus {"code":"A1"}` sent twice.

| Build | 1st POST | 2nd POST | After app restart | Index |
|---|---|---|---|---|
| `main` | 201 | **201** (duplicate row) | — | none |
| #3204 + main | 201 | **409** `{"title":"Conflict","detail":"A resource with these values already exists."}` | 409 again; list shows 1 row | `skus_code_uq` present |

Still for #3204's owner:
- Its PR body states no mutation proof.
- MikroORM D6 stays with F3.

## Fence crossings

- `test/fixtures/baseline-output/api/Api.csproj` and
  `test/fixtures/baseline-output/catalog_api/CatalogApi.csproj` are regenerated-shape fixtures
  that mirror `renderCsproj`'s NoWarn line.
- Everything else is inside `src/generator/dotnet/**` plus its test.

## Merge notes

- #3185 also edits the csproj `<NoWarn>` line (it adds CA1720 and CA1866) and appends to
  `bcl-collision.ts`. Both conflicts are textual. Resolve by keeping both sides:
  `CA1707;CA1711;CA1716;CA1720;…;CA1866;MSG0005`, with both comment blocks.
- #3185's targeted CA1716 suppression on repository interface methods becomes redundant under
  the project-wide `NoWarn`, but it is harmless.

## Gates (branch tip)

- `npx tsc -b`: clean.
- `node scripts/test-typecheck.mjs`: OK.
- `npx biome ci .`: clean (3563 files).
- `npx vitest run test/generator/dotnet test/adapters/dotnet-dapper.test.ts`: 124 files /
  791 tests passed.
- `npx vitest run test/system test/ir`: see the commit note below.
