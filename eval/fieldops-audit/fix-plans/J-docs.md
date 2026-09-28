Verification complete. Everything below was re-run against `/tmp/loom-main` @ `9a8f2fe0`. **Nothing was modified** in `/tmp/loom-main` or `/home/user/Loc`; no PR, push, or commit. Scratch in `/tmp/agentJ/`.

## 1. Verification table

| # | Doc `path:line` + claim | Observed on fresh main | Verdict | Claimed? |
|---|---|---|---|---|
| **F-043** | `README.md:18` `**Live site:** <https://lemmit.github.io/Loc/>`; `:54` `<…/Loc/#compare>`; `:202` `<…/Loc/playground/>` | `lemmit.github.io/Loc/ → 404`, `/playground/ → 404`; `loom-harness.github.io/Loc/ → 200`, `/playground/ → 200`, and `id="compare"` **is** present on the live page. **11 more hits repo-wide** (list below). | **LIVE** | **UNCLAIMED** — #2861 is the only open PR touching `README.md` and its diff covers only the Quick-example fence (lines 60–140); lines 18/54/202 and §License untouched. |
| **F-045** | `README.md:370` "the CLI emits a `LICENSE` file at the output-directory root" | `generate system examples/acme.ddd -o …` → `Wrote 286 file(s)`; `ls .../LICENSE` → `No such file or directory`; `find -iname 'LICENSE*'` → empty. `ddd new crudapp --template crud` → `Scaffolded 4 file(s)`, and `LICENSE` **is** among them. `docs/license-faq.md:42-47` is correct. | **LIVE** (README wrong, FAQ right) | **UNCLAIMED** |
| **F-021** | `docs/auth.md:976` "a JSON object of user claims"; `:981` `curl -H 'x-loom-dev-claims: {"id":"u-1",…}'` | `src/platform/hono/v4/auth-emit.ts:96-101` emits `JSON.parse(Buffer.from(injected,"base64")…)` inside `try { } catch { return base; }`. Executed: raw-JSON header → `{"id":"admin","role":"admin","tenantId":"admin"}` (built-in identity, **silently**); base64 → `{"id":"u-1","role":"manager","tenantId":"t-1"}`. Same `base64` in dotnet/java/python/elixir emitters. **`docs/language-reference/17-auth.md:250-253` already has the correct form.** | **LIVE** (one doc wrong, its sibling right) | **UNCLAIMED** (search for `"base64" "x-loom-dev-claims"` → 0 open PRs) |
| **F-005** | `docs/tenancy.md:136` "**`POST /organizations` works for any authenticated principal**… create org → issue token → read it back" | Transcribed §Surface verbatim → **it does not even parse**: `tenancy-bootstrap.ddd:8:7 error: Expecting token of type '}' but found 'crossTenant'` (the fence writes `crossTenant aggregate Plan`, while the doc's *own* line 100 says the modifier goes **after** the name; `ddd.langium:1062` confirms `(crossTenant?='crossTenant' ','?)` is in the header region). After fixing that: `0 error(s)`, and `grep -o 'method: "[a-z]*"' api/http/organization.routes.ts` → `get get` — **no POST**. Adding `with crudish` → `post get delete post get`. The pinned fixture `test/fixtures/corpus/tenancy-owned.ddd:27` does spell it `aggregate Organization with crudish`. | **LIVE, and worse than reported** (the example is also a parse error) | **UNCLAIMED** |
| **F-006** | `docs/language.md:435` "the unnamed form is the aggregate's canonical creator (**the `POST /<plural>` route takes its params**)" | `create(n: string) { }` on `aggregate Thing { name: string }` → `const CreateThingRequest = z.object({ name: … })` and `static create(input: { name: string })`. `grep '\bn\b'` over `domain/thing.ts` + `http/thing.routes.ts` → **no match**. Event-sourced is the opposite: `create open(ownerName: string)` → `CreateAccountRequest = z.object({ ownerName: … })`. `docs/language-reference/06-behavior-and-statements.md:360` already states it correctly; `docs/language.md:494` states the event-sourced half correctly. | **LIVE** (`:435` over-generalises the event-sourced rule) | **code half CLAIMED BY #2861** (§4 adds `loom.create-params-not-wire`, mints **M-T5.32** to make params *become* the create input and delete the gate). **Doc half UNCLAIMED** — #2861 does not touch `docs/language.md`; #2874 touches it only at `:1330`. |
| **F-031** | `src/language/validators/deployable.ts:444` "use one of: light, dark, cupcake, …" | Reproduced all four cases. **But the premise is wrong:** `DesignPack` (`ddd.langium:434-435`) ends in `\| STRING`, so `design: "dark"` **parses and validates clean** (`0 error(s), 0 warning(s)`). Only the *bareword* fails. `design: "not-a-theme"` correctly errors. So this is a **message-text bug**, not a grammar gap. **Also:** the message is inline and carries **no `loom.*` code at all** — so it is invisible to `diagnostic-catalog.test.ts` *and* to `diagnostic-docs-anchors.test.ts`. | **LIVE, reclassified** (one-line message fix, not a grammar change) | **UNCLAIMED** |
| **F-001** | `ddd new --template crud` warns on its own output | Reproduced: `main.ddd:34:14 warning: repository find 'byProject' is a wire-shaped list query …` `0 error(s), 1 warning(s).` | **LIVE on main** | **CLAIMED BY #2874** (open, `mergeable_state: clean`, not draft). Its body quotes the fixed run: `0 error(s), 0 warning(s). PARSE_EXIT=0`. **Resolves itself on merge — no action.** |
| **F-030** | `README.md:270` "…build and boot the generated stacks against real toolchains (… `mix compile --warnings-as-errors`)" | The claim is **structurally true**: `elixir-vanilla-build.yml` and `corpus-elixir-build.yml` both run `mix deps.get` + `mix compile --warnings-as-errors` in `hexpm/elixir`. The gap is **corpus coverage** — `grep -rln "requires true" test/fixtures/corpus/` → **0 of 68 fixtures**. I could not reproduce the 7 warnings from the `crud` template (`grep "not true"` over its Elixir output → empty; a `requires true` model emits `ensure((true), …)` against `defp ensure(true, _reason)`). | **CHANGED** — README claim not false; the defect is an uncovered shape | **UNCLAIMED** |

---

## 2. Precise doc edits

### F-043 — the org rename. **Docs (5 lines, 3 files):**

`README.md:18-20`:
```
**Live site:** <https://loom-harness.github.io/Loc/> — landing, browser
playground (typed editor + visual system builder + live preview +
in-browser test runner), and the full documentation set.
```
`README.md:54`:
```
Full feature-by-feature comparison: <https://loom-harness.github.io/Loc/#compare>.
```
`README.md:202`:
```
<https://loom-harness.github.io/Loc/playground/>.
```
`docs/playground.md:7-8`:
```
<https://loom-harness.github.io/Loc/playground/> (landing page at
<https://loom-harness.github.io/Loc/>) and lives in the `web/` workspace.
```
`docs/README.md:19` — replace `at lemmit.github.io/Loc/playground.` with `at loom-harness.github.io/Loc/playground.`

**Code carrying the same 404 (same PR, flagged as code — `status-refresh` is docs-only, but these are user-visible strings, not behaviour):**

| File:line | Current | Why it matters |
|---|---|---|
| `src/diagnostics/code-docs.ts:32` | `export const DOCS_SITE = "https://lemmit.github.io/Loc/";` | **Every `loom.*` diagnostic's docs link is a 404.** |
| `web/src/layout/vocabulary.ts:167-168` | `docsUrl` / `referenceUrl` | The playground's `?` → Docs / Language reference menu items are 404s. |
| `test/system/diagnostic-docs-anchors.test.ts:80`, `test/playground/crash-report.test.ts:66` | pin the literal | Update with the constants; these are what make the fix non-trivial to forget. |

Replacement for all: `https://loom-harness.github.io/Loc/` (verified 200; `language-reference/README.html` and `language-reference/04-type-system.html` also 200).

**A second, larger tier the F-043 brief did not anticipate — `github.com/lemmit/*` (60+ hits).** The two that ship *into user repos* are the ones that matter:

- `src/cli/new-templates.ts:321,322,331,362,368` — **every project `ddd new` scaffolds** gets four dead links in its `README.md`/`.loomignore` and one in its `LICENSE` (`"This project was scaffolded by Loom (https://github.com/lemmit/loc)"`).
- `docs/index.html:557,586,1223,1242` + `docs/build.mjs:163,176` — the **landing page's own "GitHub" button**.
- `docs/playground.md:252` + `web/e2e/crash-reporting.spec.ts:46` + `test/playground/crash-report.test.ts:252` — the playground's "Report a problem" files issues at the old owner.
- `web/src/examples/loom-landing.ddd` — 17 hits; `web/src/util/export-readme.ts:90`; `README.md:335`; `docs/observability.md:469`; `docs/conformance-semantics.md:1005,1025`; `docs/ci-gating.md:709`.

> Honesty note: `lemmit.github.io/**` is a **confirmed hard 404** (clean A/B against `loom-harness.github.io` → 200). `github.com/lemmit/Loc` I could **not** conclusively resolve — the sandbox proxy returns 403 for GitHub HTML and gates the API. GitHub's owner-rename redirect *usually* keeps such URLs alive, so treat this tier as **stale, probably-still-redirecting**, not confirmed-broken. It still deserves the same sweep: a redirect is reclaimable by anyone who registers `lemmit/Loc`, and one of these URLs is baked into the **LICENSE file of every scaffolded project**.

### F-045 — README §License. Replace `README.md:368-372`:
```
The **code Loom generates** (everything `ddd generate` writes into
`<outdir>/`) is licensed to you under the **MIT License**, unencumbered
by FSL.  `ddd new` writes that grant as a `LICENSE` file at the root of
the project it scaffolds; `ddd generate` deliberately does not, because
it emits build output into a tree you may have already licensed
differently.  The grant is a property of the generator's licence, not of
a file in your output directory — production users can ship generated
projects without inheriting any FSL terms either way.
```
The FAQ is right and its reasoning (`docs/license-faq.md:44-47`) is sound; the README should defer to it rather than the reverse. **Legal-facing, so do not weaken it to "a LICENSE file may be emitted"** — state the split explicitly.

### F-021 — `docs/auth.md`. Two edits.

`:976-977`, replace `— a JSON object of user` / `claims —` with:
```
reads an optional **`x-loom-dev-claims`** request header — a **base64-encoded**
JSON object of user claims — and projects it onto the `User` shape, so you can
```
`:980-983`, replace the fence with the form already proven in `17-auth.md:253`:
```bash
curl -H "x-loom-dev-claims: $(echo -n '{"id":"u-1","role":"manager","tenantId":"t-1"}' | base64)" \
  http://localhost:8080/api/orders
```
And add immediately after the fence:
```
A header that is not valid base64-encoded JSON is **silently ignored** — the
stub catches the decode failure and falls back to the built-in identity
(`auth/dev-stub.ts`), so a raw-JSON header looks like it worked and quietly
gives you a different principal.
```
That last sentence is the whole point: the failure mode is a false pass.

### F-005 — `docs/tenancy.md`. Three edits.

`:21`, fix the parse error (the fence contradicts the doc's own §crossTenant bullet at `:95-104`):
```ddd
      aggregate Plan crossTenant { code: string  monthlyPrice: decimal }
```
`:28`, give the registry the constructor the bootstrap paragraph assumes:
```ddd
      aggregate Organization with crudish { name: string }   // the registry — named in `of`, no tenancy marker
```
`:134-142`, replace the bootstrap paragraph:
```
**Claim-less signup bootstrap.** Filters never gate creates and the registry
carries no stamp, so `POST /organizations` works for any authenticated
principal — including one whose token has **no (or a foreign) tenant claim**.
This needs a *declared* constructor on the registry: an aggregate with no
`create` and no `with crudish` emits `GET /organizations` and
`GET /organizations/{id}` only, and the loop below has no entry point.  With
one declared, the created org's `id` is a valid `tenantId` claim value (that's
the identity), closing the signup loop: create org → issue token with
`tenantId = <org id>` → read it back.  Pinned end-to-end by
`test/e2e/tenancy-isolation.test.ts` (`LOOM_TENANCY_E2E=1`), whose fixture
spells the registry `aggregate Organization with crudish`.
```

### F-006 — `docs/language.md:435`. Replace the table cell:
```
| `create [name](params) [audited] { … }` | Lifecycle factory — the body populates a fresh `this`; the unnamed form is the aggregate's canonical creator, which emits `POST /<plural>`.  On a **state-based** aggregate the request body is the **create-input projection of the field set**, not the parameter list — a declared `create(n: string)` on `aggregate Thing { name: string }` emits `Thing.create({ name })` and `n` appears nowhere.  On an **event-sourced** aggregate the body *is* the create's params (the command shape).  See [`language-reference/06-behavior-and-statements.md`](language-reference/06-behavior-and-statements.md). |
```
This makes `:435` agree with `:494` and with `06-behavior-and-statements.md:360`, which are both already correct. Stated as-is it stays true whichever way **M-T5.32** resolves; if M-T5.32 lands, the state-based sentence is the one deleted.

### F-031 — `src/language/validators/deployable.ts:441-449`. **Code, not docs.** Two coupled changes:

1. Fix the message — the themes must be **quoted**, since `DesignPack` admits them only via its `STRING` alternative:
```ts
`Design '${d.design}' on Feliz deployable '${d.name}' is not a daisyUI theme. Feliz's 'design:' selects a daisyUI theme, written as a quoted string — e.g. \`design: "dark"\`; a bareword is a parse error. Themes: ${DAISYUI_THEMES.join(", ")}.`
```
2. Give it a `loom.*` code and move the text to `src/diagnostics/messages.ts`. It currently has **no code at all**, which is why it slipped both `diagnostic-catalog.test.ts` (inline-literal gate) and `diagnostic-docs-anchors.test.ts` — CLAUDE.md's rule is scoped to `loom.*` diagnostics, so a codeless one is outside every gate. Suggested: `loom.feliz-design-not-theme`.

Mutation proof: assert that the string the message recommends round-trips — parse `design: "dark"` and expect zero diagnostics; revert the quoting and the test must go red.

### F-030 — do **not** soften the README claim. Instead:
- Keep `README.md:270` as-is. The gate exists, runs per-PR, and uses the flag.
- Refresh the two stale numbers at `README.md:263-264`: measured **2,094 test files** (`find test -name '*.test.ts' -o -name '*.test.tsx'`, minus the one under `test/fixtures/`), and #2874's full local run on main reports `7 failed | 22532 passed`. Replacement: `**2,000+ test files / 22,000+ tests** cover parsing, validation, …`
- Hand the emitter owner the real gap: **no corpus fixture carries `requires true`** (0/68). The fix is a corpus fixture, not README prose — that's what makes `--warnings-as-errors` actually reach the shape.

---

## 3. Sweep results

I ran four mechanical passes over `README.md`, `docs/*.md`, `docs/language-reference/*.md`, `docs/architecture/*.md` (excluding `docs/old/`, `docs/new-plan/`).

**URLs — 51 distinct absolute URLs.** 9 are `lemmit.github.io` (all 404). One is doubly dead:
> `docs/observability.md:153` links the Phoenix log formatter to `https://github.com/lemmit/Loc/blob/main/src/generator/phoenix-live-view/index.ts` — **wrong org *and* a directory that no longer exists.** `docs/decisions.md:1506` records the rename itself: `src/generator/phoenix-live-view/` → `src/generator/elixir/`. Fix: `…/Loom-Harness/Loc/blob/main/src/generator/elixir/index.ts`.

The rest (nuget, pino, likec4, micrometer, pub.dev, opensource.org/license/mit, `http://localhost:*`) are fine.

**Relative markdown links — 1,473 checked, 1 real break:**
> `docs/channels.md:19` → `new-plan/missions/M-T4.4-broker-eventing-design.md`. The file moved to `docs/new-plan/archive/missions/M-T4.4-broker-eventing-design.md`. (The only other hit, `AUTHORING.md:26 → ../foo.md`, is an illustrative placeholder.)

**CLI invocations — 22 fenced blocks.** Every documented flag checks out against `--help`: `trace --map/-o`, `breakpoints --line/--map/-o`, `verify --results/--out/--require-all/--min/--json`, `patch --patches/--json`, `generate system --k8s/--dry-run/--trace/--allow-destructive/--allow-rebaseline/--sourcemap/--inline-sources`. `docs/tools.md:400`'s `curl http://localhost:8080/health   # → {"status":"ok"}` matches the emitter (`return c.json({ status: "ok" })`). **One small inversion of F-045:** `ddd new --help` says it scaffolds `(main.ddd + README + .loomignore)` — it omits `LICENSE`, which it *does* write. The CLI undersells here exactly where the README oversells.

**curl examples — 8.** Only `docs/auth.md:981` is wrong (F-021).

**"the CLI emits X" — 3 claims.** `docs/tools.md:392` (docker-compose.yml) verified present; `docs/license-faq.md:42` verified correct; `README.md:370` is F-045.

**`.loom/` artifact inventory** (`docs/loom-artifacts.md:11-39` vs the real 286-file acme run): every documented file is emitted, and the conditional ones (`sourcemap.json`, `verification.*`) are correctly marked conditional. **One omission:**
> **`.loom/asyncapi.yaml` is emitted on every run** (`src/system/index.ts:384`, `src/system/asyncapi.ts` — AsyncAPI 3.0) **and appears in no user-facing doc at all** — not in the tree at `:11-39`, not in any per-file table, not in `docs/channels.md`. Only `docs/old/`, `docs/audits/` and `docs/new-plan/` mention it. Add a tree line and a row to the eventing table.

**Two code-side finds I am *not* fixing** (docs-only boundary — flagging and stopping, per the skill):

1. **The compiler crashes with a raw `TypeError` on an `apply` typo, and reports no syntax error first.** 10-line repro at `/tmp/agentJ/repro/apply-crash.ddd` (`apply Opened { … }` instead of `apply(e: Opened) { … }`):
   ```
   TypeError: Cannot read properties of undefined (reading 'ref')
       at lowerApply (file:///tmp/loom-main/out/ir/lower/lower-members.js:31:31)
   ```
   `src/ir/lower/lower-members.ts:75` reads `a.event.ref?.name ?? a.event.$refText` — the `?.` guards the *ref* but not `a.event`, which is `undefined` on a partially-recovered parse. Exit code is 1, so it is not silent, but the user gets a stack trace instead of the parse error. Same shape as `experience_gathered.md` §59's swallowed-parse class.
2. **F-006's code half** — owned by #2861 / M-T5.32, as above.

**Judgement: these six are a sample, not the set.** The evidence is the *shape* of what turned up. Of the six assigned rows, one (F-005) was worse than reported — the example does not parse — and one (F-031) had the wrong diagnosis, because nobody had tried the quoted form. Two mechanical passes I ran on top found four more contradictions in under ten minutes (the `observability.md` doubly-dead link, the `channels.md` broken link, the undocumented `asyncapi.yaml`, the `ddd new --help` omission), plus a 60-hit second tier of stale-org URLs that reaches into **every scaffolded user project's LICENSE file**. #2861 §3 independently reached the same conclusion from the other direction — *"Nothing read the fenced examples, so they drifted until the headline ones broke"* — and it fixed the README Quick example, `docs/workflow.md` and `docs/traceability.md` by hand, one at a time. That is the tell: this is a standing tax with no ratchet, not a backlog with a bottom.

---

## 4. Gate recommendation

**A gate is not only possible, it is a ~20-line edit to a file that already exists** — `test/system/archived-docs-fence.test.ts` already walks every live doc and resolves relative `.md` links. It just checks too narrow a slice:

```ts
// test/system/archived-docs-fence.test.ts:129
if (!/^(old\/|audits\/)/.test(rel)) continue;
```

That one line is why `docs/channels.md:19` (target under `new-plan/`) slipped through. **Cheapest version — three changes, no network, no new file:**

1. **Delete line 129** to check *all* relative `.md` targets. I simulated it: **1,473 links, 2 failures** — one real (`channels.md`), one placeholder (`AUTHORING.md:26 → ../foo.md`, waive with a reason per the repo's ratchet convention). Nearly free, and the `seen > 40` reach-assertion already present generalises to `seen > 1000`.
2. **Add `README.md` to `liveDocs()`** — it currently starts from `CLAUDE.md` + `docs/`, so the repo's single most-read file is outside the only doc gate there is.
3. **Add a stale-host denylist** over absolute URLs in the same walk — `lemmit.github.io`, `github.com/lemmit/` — widened to `src/`, `web/src/`, `docs/index.html` and `docs/build.mjs`. Ten lines. This is the whole of F-043 including the 60-hit second tier, and it ratchets: the day the project moves org again, the gate names every file.

**What that catches:** F-043 entirely, `channels.md:19`, `observability.md:153`, and every future rename. **What it does not:** F-045, F-021, F-005, F-006, F-031 — none of those is a link.

**The second gate, which is where the real yield is: execute the fenced `ddd` blocks.** Collect every ```` ```ddd ```` fence in `README.md` + `docs/*.md` + `docs/language-reference/*.md` and run each through `validate()` from `src/api/` (already browser-safe, `EmptyFileSystem`, no CLI spawn — so it runs in the fast tier). Fences that are deliberate fragments get a `<!-- loom-doc-fence: fragment -->` marker immediately above, and the marker list is a ratchet.

- **Catches F-005 outright** — `docs/tenancy.md`'s §Surface is a parse error today.
- **Catches the entire class #2861 §3 fixed by hand** — five retired spellings across README/`workflow.md`/`traceability.md` — and stops it re-accreting.
- **Mutation proof is free:** revert the `crossTenant` word order in `tenancy.md` and the gate must go red naming that fence.

Executing fenced **`bash`** blocks I'd skip: most need a booted stack or Docker, so the leg is expensive and flaky, and the yield is one finding (F-021) that a fence-validator cannot see anyway. Cover the `curl`/CLI examples the cheap way instead — assert that every `ddd <subcommand> --flag` string appearing in a docs fence is a flag the corresponding Commander command declares. That is a pure string check against `src/cli/main.ts`, catches invented flags and renamed ones, and would have caught `loom.persistence-mode-unsupported`'s `dataSource X { … }` suggestion (#2861 §3) had it been pointed at diagnostic messages too.