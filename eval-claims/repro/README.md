# Minimal repros

Each file is a self-contained `.ddd`. Unless noted, all report
`0 error(s), 0 warning(s)` from `node bin/cli.js parse`.

| file | finding | how to see it |
|---|---|---|
| `F-101-outbox-workflow-no-reactor.ddd` | F-101 | `generate system`, then `cd out/api && npm i && npx tsc --noEmit` → 4 × TS2304/TS2305 |
| `F-101-control-workflow-less.ddd` | F-101 control | same model minus the workflow — all three factories are emitted |
| `F-102-projection-cross-context-vo.ddd` | F-102 | `cd out/api_a && npx tsc --noEmit` → TS2306 "not a module" |
| `F-103-reactor-unbound-currentuser.ddd` | F-103 | generate for each of `node/java/dotnet/python/elixir` and grep the reactor for `currentUser` |
| `F-104-create-arg-id-confusion.ddd` | F-104 | parse alone: a `B2 id` is accepted for a field declared `A id` |
| `F-105-test-body-untyped-args.ddd` | F-105 | `cd out/api && npx tsc --noEmit` → 2 × TS2345 |
| `F-105-control-workflow-body-typed.ddd` | F-105 control | the same two calls in a workflow body — **2 parse errors**, correctly |
| `F-106-F-107-money-in-page-slot.ddd` | F-106, F-107 | `cd out/web && npm i && npx tsc --noEmit` → TS2322 (and TS2554 with `.round(0)`) |
| `F-113-unused-workflow-params.ddd` | F-113 | grep `out/api/http/workflows.ts` for `ignoredNote` — required on the wire, never read |

One-liner probes (no fixture file needed):

```bash
# F-109 — 78 of 79 soft keywords are legal field names and illegal in a migration step
printf 'context C { aggregate A with crudish { description: string  derived display: string = description } repository As for A { } }\nmigration "r" { A.description -> summary }\n' > /tmp/m.ddd
node bin/cli.js parse /tmp/m.ddd

# F-110 / F-115 — no `date` type, and the hint suggests a crudish operation
printf 'context C { aggregate A with crudish { occurredOn: date  n: string } repository As for A { } }\n' > /tmp/d.ddd
node bin/cli.js parse /tmp/d.ddd     # → Did you mean 'update'?

# F-111 — `string ← any primitive` is false for guid / datetime / json / File
for t in guid datetime json File bool int; do
  printf 'context C { aggregate A with crudish { v: %s\n derived d: string = string(v) } repository As for A { } }\n' "$t" > /tmp/p.ddd
  printf '%-9s ' "$t"; node bin/cli.js parse /tmp/p.ddd 2>&1 | head -1
done
```
