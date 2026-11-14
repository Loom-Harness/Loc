# D-AI-EMPHASIS — Loom leads as a platform (mass-market land + regulated expand), IR-embedding deferred

**Status:** PINNED.

**Problem.** [`ai-generation-platform.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/ai-generation-platform.md)
§4.4/§7 leaves the platform-vs-IR emphasis open. Three coherent paths
were on the table:

- **A — IR-first.** Ship `@loom/core` as the deterministic, multi-stack,
  auditable engine that *other* AI builders embed (B2B2C). Lowest risk,
  plays to the compiler strength, dodges consumer-AI UX — but has no
  direct customer, leans on integrators with weak incentive to adopt a
  DDD compiler that constrains their breadth, and cannot monetise the
  niche that actually values the differentiation.
- **B — Mass-market platform.** Loom's own end-to-end AI generation
  platform competing for the broad "describe an app" market.
- **C — Vertical platform.** The same platform aimed at the regulated /
  domain-heavy / engineering-led niche (fintech, healthtech, govtech),
  where determinism + ownership + multi-stack + governance are
  non-negotiable and the consumer-grade incumbents cannot follow.

**Decision: B + C.** Loom leads as a **first-party platform across both
motions** — a land-and-expand:

- **B is the funnel.** A free/low tier for the broad market is the
  distribution and brand engine. It is winnable *not* on UX polish alone
  but on the genuine differentiators: model-as-memory (no context rot as
  the app grows), determinism (maintainable/upgradable output), multi-stack,
  and code ownership. The pitch is "AI apps that don't collapse at scale and
  that you own," not "a prettier Bolt."
- **C is the revenue.** The regulated/engineering niche is where pricing
  power lives — governance/conformance/provenance reporting, private
  backends, hosted `verify`, SLA'd determinism. B lands these users; C
  expands them.
- **A is deferred, not dropped.** IR-embedding (`@loom/core` as an engine
  other builders license) is a later **channel/partnership** play, reachable
  *from* a proven platform; the reverse climb (embedded engine → owns the
  customer) is much harder.

**Rationale.**

- The emphasis question is **GTM and narrative, not architecture.** Platform
  and IR run the *same* validate→repair→verify loop over the same model
  patches ([`ai-authoring-loop.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/ai-authoring-loop.md)); the
  wedge demo advances all paths. So committing to B+C costs nothing
  technically and keeps A open.
- Owning the customer (B+C) is the only path that monetises Loom's defensible
  whitespace directly; A buries the differentiation three layers down someone
  else's stack.
- B funds C: the mass-market top-of-funnel supplies the distribution that a
  pure-niche motion lacks, while C supplies the margin a pure-mass motion
  lacks.

**Consequences / honest caveats.** B+C is the **highest-prize and
highest-cost** path, and it leans hardest on Loom's weakest muscle — consumer
AI UX and the capital/team to compete on it. It is justified only if (a) the
on-ramp can be made cheap (grammar-constrained `.ddd` authoring + the
context-pack, `ai-authoring-loop.md` §5) so the engine carries the UX, and
(b) the build sequences the **wedge demo first** (prove the loop end-to-end in
the browser playground) before any mass-market growth spend. If funding/team
for B does not materialise, fall back to **C-only** (vertical-first) rather
than A — keep the direct customer.

**Affects.** `ai-generation-platform.md` §4.4 (reframe the "two strategies,
sequence them" block from IR-first to B+C platform-first with A deferred) and
§7 (resolve the platform-vs-IR open question, citing this tag).
