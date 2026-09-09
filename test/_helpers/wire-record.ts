// ---------------------------------------------------------------------------
// Cross-backend runtime wire differential — the per-request recorder + the
// canonical-golden differ (M-T9.11 slices b + c).
//
// Slice (a) (`response-diff.ts`) proved the sensor works but ran ALL-PAIRS over
// the full five-backend compose stack: nightly-shaped, and — the lesson the
// first report taught — pairwise disagreement alone names no WINNER.  RS-11 is
// the proof: three backends agreed on `version: 0` and were all three WRONG
// (the `versioned` capability declares `version: int token = 1`), so a
// majority vote would have broken the one correct backend.
//
// This module is the answer to both problems at once:
//
//   1. ORACLE.  Instead of diffing backends against each other, each backend is
//      diffed against a COMMITTED canonical recording — `wire-golden/<case>.json`
//      — which is a reviewed answer key.  A wire change becomes a visible diff
//      on a checked-in file that a human approves.
//   2. PER-PR, AT ZERO NEW BOOT COST.  If A ≡ golden and B ≡ golden then A ≡ B,
//      so the N-way differential decomposes into N INDEPENDENT one-way gates —
//      each of which rides a backend's ALREADY-per-PR behavioral workflow
//      (`behavioral-e2e*.yml`) instead of needing its own compose boot.
//
// Alignment is free: every `test/behavioral/run-*.mjs` dispatches the SAME
// emitted api suite through ONE fetch chokepoint, and `runTests` is strictly
// sequential — so request N is the same code path on every backend and the
// SEQUENCE ORDINAL is a stable key (ids are not — they differ per run, which is
// exactly what defeated slice (a)'s index alignment on derived `seqTag`).
//
// Pure functions only — no I/O, no fs.  Fast-suite tested (wire-record.test.ts);
// `test/behavioral/wire-differential.mjs` is the thin booted-runner wrapper.
// ---------------------------------------------------------------------------

import {
  DEFAULT_NORMALIZE,
  type DivergenceKind,
  diffBodies,
  type Json,
  type NormalizeOpts,
  normalizeBody,
} from "./response-diff.js";

export type { Json } from "./response-diff.js";

/** One recorded request/response pair, already normalized — the unit the golden
 *  stores and the differ compares.  `seq` is the ordinal within the case's
 *  suite run (0-based); `path` is TEMPLATED (volatile segments → `{id}`) so a
 *  per-run uuid in the URL isn't mistaken for a contract difference. */
export interface WireEntry {
  readonly seq: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: Json;
  /** Sorted wire SPELLINGS of every number in this body whose source text is
   *  not the canonical shortest round-trip form (`String(value)`) — omitted
   *  entirely when there are none, which is the overwhelmingly common case, so
   *  existing goldens stay byte-identical.
   *
   *  WHY THIS FIELD EXISTS.  `body` is the JSON.parse'd value, and parsing is
   *  where the evidence dies: RS-24 says a `decimal` is a float64 JSON number,
   *  and `9.99`, `9.990`, and Java's un-narrowed
   *  `9.9900000000000000000000000000000000` (34 significant digits) all parse
   *  to the SAME double.  So the differ compared them as equal and the gate
   *  could not fail on excess precision **by construction** — which is exactly
   *  how the #2545→#2631 money/decimal series ran green through this tier, and
   *  why M-T6.46 shipped 34 digits with every wire gate passing.
   *
   *  Capturing the spelling puts the discarded half back in front of the
   *  comparator.  Scope is deliberately the FORMAT dimension only: the value
   *  dimension is already covered, at full JSON-path precision, by `diffBodies`.
   *
   *  WHAT COUNTS is `offContractNumber` — see its own comment for the two
   *  rules and the measurement behind them.  The short version: this is NOT
   *  "any spelling that differs from `String(value)`".  That was the first cut
   *  and it reported 23 divergences on every python run, all of them `10.0`
   *  against node's `10` — the same number under every parser, and a bill
   *  payable only in waivers nobody could ever delete.
   *
   *  KNOWN LIMIT, stated rather than hidden: this is a multiset of spellings
   *  with no JSON path attached, so a non-canonical number MOVING between two
   *  fields of one body reads as no change. Path-carrying would mean threading
   *  a path through `JSON.parse`'s bottom-up reviver, which has no path to
   *  give; the multiset catches the class this exists for (a backend that
   *  publishes precision the wire type does not have) and the offending
   *  spelling is greppable in `body`. */
  readonly numberFormats?: readonly string[];
}

/** One backend's full recording for one case. */
export interface WireRecording {
  /** Case name — a corpus feature id or a `systems/*.ddd` basename. */
  readonly case: string;
  readonly backend: string;
  readonly entries: readonly WireEntry[];
}

/** The committed answer key.  `oracle` records WHICH backend the bytes were
 *  captured from and WHY that backend is the reference for this case — the
 *  golden is a reviewed decision, not "whatever ran first". */
export interface WireGolden {
  readonly case: string;
  readonly oracle: string;
  readonly entries: readonly WireEntry[];
}

// ── path templating ────────────────────────────────────────────────────────

const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_SEG = /^\d+$/;
// A ULID/base32-ish or long opaque token — id-shaped enough that a per-run
// value in a path segment would otherwise read as a route difference.
const OPAQUE_SEG = /^[0-9A-Za-z_-]{20,}$/;

/** True when a URL path segment is a per-run identifier rather than a route
 *  literal.  Deliberately conservative — a false positive silently merges two
 *  distinct routes, so only uuid / all-digits / long-opaque qualify. */
export function isVolatileSegment(seg: string): boolean {
  return UUID_SEG.test(seg) || INT_SEG.test(seg) || OPAQUE_SEG.test(seg);
}

/** `http://x/api/products/6f0f…?page=2` → `/api/products/{id}?page=2`.
 *  Host/port are dropped (each backend listens on its own), volatile segments
 *  collapse to `{id}`, query params sort by key and their values run through the
 *  same volatile-VALUE normalization the bodies use. */
export function templatePath(url: string, opts: NormalizeOpts = DEFAULT_NORMALIZE): string {
  let pathname: string;
  let search: string;
  try {
    const u = new URL(url, "http://loom.invalid");
    pathname = u.pathname;
    search = u.search;
  } catch {
    const q = url.indexOf("?");
    pathname = q === -1 ? url : url.slice(0, q);
    search = q === -1 ? "" : url.slice(q);
  }
  const templated = pathname
    .split("/")
    .map((seg) => (isVolatileSegment(seg) ? "{id}" : seg))
    .join("/");
  if (!search) return templated;
  const params = [...new URLSearchParams(search).entries()]
    .map(([k, v]) => {
      for (const rule of opts.volatileValue ?? [])
        if (rule.test(v)) return [k, rule.token] as const;
      return [k, opts.volatileKey?.(k) ? "<volatile:key>" : v] as const;
    })
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${k}=${v}`);
  return params.length ? `${templated}?${params.join("&")}` : templated;
}

/** A uuid appearing ANYWHERE inside a longer string — not anchored, unlike the
 *  `UUID_SEG` / `UUID_RE` whole-value forms.  Two spellings of one pattern: a
 *  STATELESS one to detect with (a `g` regex carries `lastIndex` across `.test`
 *  calls, which makes every other call answer wrong) and a global one to
 *  replace every occurrence with. */
const UUID_INSIDE_SRC = String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`;
const UUID_INSIDE = new RegExp(UUID_INSIDE_SRC, "i");
const UUID_INSIDE_ALL = new RegExp(UUID_INSIDE_SRC, "gi");

/** The wire gate's normalization: the shared defaults PLUS two rewrite rules
 *  for strings that are PARTLY volatile and partly contract.
 *
 *  1. PATH-shaped — an RFC 9457 problem body carries
 *     `instance: "/api/listings/<uuid>/discontinue"`, a per-run value embedded
 *     in a ROUTE.  The default value-shape rules don't fire (it isn't a bare
 *     uuid), so without this the error golden could never match twice;
 *     collapsing the whole string to one token would instead discard the route,
 *     which is the part a divergence actually shows up in.
 *
 *  2. PROSE with an embedded id — the RS-27 `detail` sentence
 *     `"Order <uuid> not found"`.  Same structure as (1) and the same reason:
 *     the SENTENCE is the contract (a client reads it, and the five backends
 *     must agree on it), the uuid inside is per-run noise.  Before this rule
 *     that field was unbaselinable — every run produced a different `detail`, so
 *     a 404-by-id could not be held by a golden on ANY backend, which is exactly
 *     why the four-way divergence RS-27 names went unnoticed until a test
 *     finally drove the route.  Templating to `{id}` keeps the wording under
 *     gate and drops only the id.
 *
 *  Both rewrite rather than tokenize; the `token` is just the rule's label. */
export const WIRE_NORMALIZE: NormalizeOpts = {
  ...DEFAULT_NORMALIZE,
  volatileValue: [
    ...(DEFAULT_NORMALIZE.volatileValue ?? []),
    {
      token: "<path>",
      test: (s) => s.startsWith("/") && s.split("/").some(isVolatileSegment),
      rewrite: (s) =>
        s
          .split("/")
          .map((seg) => (isVolatileSegment(seg) ? "{id}" : seg))
          .join("/"),
    },
    {
      // Ordered AFTER `<path>` so a path-shaped string keeps its segment-wise
      // templating (which also collapses INT / OPAQUE segments, not just uuids).
      // A WHOLE-value uuid never reaches here — `DEFAULT_NORMALIZE`'s `<uuid>`
      // rule is earlier in the list and wins.
      token: "<embedded-id>",
      test: (s) => UUID_INSIDE.test(s),
      rewrite: (s) => s.replace(UUID_INSIDE_ALL, "{id}"),
    },
  ],
};

/** Build one normalized `WireEntry` from a raw dispatch result.  A non-JSON body
 *  (empty 204, a text/plain error) is kept as a string so the differ still sees
 *  it; JSON is parsed then normalized (uuids/timestamps → tokens, keys sorted,
 *  keys NEVER dropped — absence is contract). */
export function toWireEntry(
  seq: number,
  method: string,
  url: string,
  status: number,
  bodyText: string,
  opts: NormalizeOpts = WIRE_NORMALIZE,
): WireEntry {
  let body: Json;
  const spellings: string[] = [];
  const trimmed = bodyText.trim();
  if (trimmed === "") {
    body = "";
  } else {
    try {
      // The reviver's third argument carries the RAW SOURCE TEXT of a primitive
      // (Node >= 21 / V8 >= 11.9).  `String(value)` is the canonical form
      // precisely because RS-24 defines the wire type as a float64 JSON
      // number, so the shortest round-trip spelling IS the contract — and a
      // source that is not DECIMAL-EQUAL to it is publishing digits the
      // contract does not carry.  That inequality, not textual inequality, is
      // the test (see `numberFormats`).
      body = normalizeBody(
        JSON.parse(trimmed, (_key, value, context) => {
          const src = (context as { source?: string } | undefined)?.source;
          if (typeof value === "number" && typeof src === "string" && src !== String(value)) {
            if (offContractNumber(src, String(value))) spellings.push(src);
          }
          return value;
        }) as Json,
        opts,
      );
    } catch {
      body = trimmed;
    }
  }
  const entry: WireEntry = {
    seq,
    method: method.toUpperCase(),
    path: templatePath(url, opts),
    status,
    body,
  };
  // Omitted when empty so a body of ordinary numbers serializes exactly as it
  // did before this field existed — no golden churn, and the field's presence
  // in a golden is itself the signal that something spells numbers unusually.
  return spellings.length > 0 ? { ...entry, numberFormats: [...spellings].sort() } : entry;
}

/** Exact decimal value of a JSON number literal, as a canonical
 *  `sign|digits|exponent` triple with trailing fractional zeros removed — so
 *  `10`, `10.0`, `1e1` and `0.10e2` all normalize to the same string, and
 *  `3.3333333333333335` and `3.333333333333333333333333333333333` do not.
 *
 *  Deliberately string arithmetic, not `Number` or a big-decimal dependency:
 *  routing through a double is exactly the information loss this whole field
 *  exists to undo, and the test tree carries no decimal library.
 *
 *  Returns `null` for anything not shaped like a JSON number; callers treat an
 *  unparseable spelling as NOT equal, so a form this does not understand is
 *  reported rather than silently accepted. */
export function decimalKey(literal: string): string | null {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(literal.trim());
  if (!m) return null;
  const [, sign, intPart, fracPart = "", expPart] = m;
  // One digit string with the point conceptually after `intPart`, then shift.
  const digits = `${intPart}${fracPart}`;
  let exponent = (expPart ? Number(expPart) : 0) - fracPart.length;
  // Strip leading zeros (value-preserving) and trailing zeros (absorbed into
  // the exponent), leaving one canonical mantissa per value.
  let start = 0;
  while (start < digits.length - 1 && digits[start] === "0") start++;
  let end = digits.length;
  while (end > start + 1 && digits[end - 1] === "0") {
    end--;
    exponent++;
  }
  const mantissa = digits.slice(start, end);
  // Zero has no sign and no exponent, or `-0.0` and `0` would read as distinct.
  if (/^0+$/.test(mantissa)) return "0";
  return `${sign === "-" ? "-" : ""}${mantissa}e${exponent}`;
}

/** True when two JSON number literals denote the same exact decimal value.
 *  An unparseable literal is never equal — see `decimalKey`. */
export function decimalEqual(a: string, b: string): boolean {
  const ka = decimalKey(a);
  return ka !== null && ka === decimalKey(b);
}

/** IEEE-754 binary64 carries about 15-17 significant decimal digits; 17 is the
 *  round-trip guarantee, so a literal wider than that is claiming precision the
 *  wire type cannot hold no matter what its value is. */
const FLOAT64_SIGNIFICANT_DIGITS = 17;

/** Significant decimal digits in a JSON number literal — leading zeros do not
 *  count, trailing ones do (they are the padding an un-narrowed big decimal
 *  emits, and the whole point is that the padding is visible). */
export function significantDigits(literal: string): number {
  const key = decimalKey(literal);
  if (key === null) return 0;
  if (key === "0") return 1;
  const digits = /^-?(\d+)e/.exec(key)?.[1] ?? "";
  // `decimalKey` already stripped trailing zeros into the exponent, so measure
  // the literal's own mantissa instead.
  const m = /^[+-]?0*(\d*?)\.?(\d*?)(?:[eE][+-]?\d+)?$/.exec(literal.trim());
  if (!m) return digits.length;
  const raw = `${m[1]}${m[2]}`.replace(/^0+/, "");
  return raw.length || digits.length;
}

/** Is this wire spelling off-contract for a float64 JSON number?
 *
 *  TWO independent ways to be, and both are needed — dropping either one was
 *  measured to break the gate in a different direction:
 *
 *  1. **It denotes a different value than the canonical rendering.** java's
 *     un-narrowed `3.333333333333333333333333333333333` against node's
 *     `3.3333333333333335` is a different number to any decimal-preserving
 *     client, which is the M-T6.46 defect.
 *  2. **It claims more significant digits than a float64 holds**, even when the
 *     value is identical. `9.9900000000000000000000000000000000` is exactly
 *     `9.99`, so rule 1 alone lets it pass — but it is the SAME un-narrowed
 *     BigDecimal serializer, caught on a value that happens to be exact. A gate
 *     silent on that stays silent until the first division.
 *
 *  What neither rule fires on is the cosmetic case: python renders a float64
 *  as `10.0` where V8 renders `10`, and .NET/java render a `NUMERIC(19,4)`
 *  column as `12.5000`. Same value, well inside float64's width, and no client
 *  can tell after parsing. Those produced 23 divergences per python run on the
 *  first cut of this field — a bill payable only in permanent waivers, since
 *  neither backend is wrong. */
export function offContractNumber(source: string, canonical: string): boolean {
  return !decimalEqual(source, canonical) || significantDigits(source) > FLOAT64_SIGNIFICANT_DIGITS;
}

// ── the differ ─────────────────────────────────────────────────────────────

/** Divergence kinds beyond the body-level ones `response-diff` classifies:
 *  the recording can also disagree on HOW MANY requests were made, on WHICH
 *  request was made at an ordinal, or on the response STATUS. */
export type RecordDivergenceKind =
  | "request-count"
  | "request"
  | "status"
  /** The bodies carry the same VALUES but one side spells a number in a form
   *  the other does not — excess scale, trailing zeros, digits past what a
   *  float64 keeps.  Its own kind because it is invisible to every value-level
   *  comparison (see `WireEntry.numberFormats`) and because it names a
   *  different defect: not "this backend computed something else" but "this
   *  backend serializes numbers off-contract". */
  | "number-format"
  | DivergenceKind;

export interface RecordDivergence {
  readonly seq: number;
  /** `GET /api/products` — the request the divergence sits on, for the report. */
  readonly request: string;
  readonly kind: RecordDivergenceKind;
  /** JSON path within the body (`$…`), or `$` for whole-entry divergences. */
  readonly path: string;
  readonly golden: Json | undefined;
  readonly actual: Json | undefined;
}

/** Seq-aligned diff of an actual recording against the golden.
 *
 *  A request-count or per-ordinal request mismatch SHORT-CIRCUITS the rest of
 *  the comparison for that recording: once the sequences desynchronize, every
 *  later ordinal compares unrelated requests and the report becomes noise (the
 *  contamination that made slice (a)'s `seqTag` finding unreadable). */
export function diffRecording(
  golden: readonly WireEntry[],
  actual: readonly WireEntry[],
): RecordDivergence[] {
  const out: RecordDivergence[] = [];
  if (golden.length !== actual.length) {
    return [
      {
        seq: -1,
        request: "(recording)",
        kind: "request-count",
        path: "$",
        golden: golden.length,
        actual: actual.length,
      },
    ];
  }
  for (let i = 0; i < golden.length; i++) {
    const g = golden[i];
    const a = actual[i];
    const label = `${g.method} ${g.path}`;
    if (g.method !== a.method || g.path !== a.path) {
      out.push({
        seq: i,
        request: label,
        kind: "request",
        path: "$",
        golden: `${g.method} ${g.path}`,
        actual: `${a.method} ${a.path}`,
      });
      // Desynchronized — everything after this ordinal is meaningless.
      return out;
    }
    if (g.status !== a.status) {
      out.push({
        seq: i,
        request: label,
        kind: "status",
        path: "$",
        golden: g.status,
        actual: a.status,
      });
    }
    for (const d of diffBodies(g.body, a.body)) {
      out.push({ seq: i, request: label, kind: d.kind, path: d.path, golden: d.a, actual: d.b });
    }
    // The format dimension, which `diffBodies` cannot see: both sides already
    // parsed to equal doubles or the loop above would have said so.  Absent and
    // empty mean the same thing (every number canonical), so a golden written
    // before this field existed compares clean against a still-canonical
    // backend and nothing has to be rebaselined.
    const gFmt = g.numberFormats ?? [];
    const aFmt = a.numberFormats ?? [];
    if (gFmt.length !== aFmt.length || gFmt.some((v, k) => v !== aFmt[k])) {
      out.push({
        seq: i,
        request: label,
        kind: "number-format",
        path: "$",
        golden: gFmt.join(", "),
        actual: aFmt.join(", "),
      });
    }
  }
  return out;
}

// ── waivers ────────────────────────────────────────────────────────────────

/** An EXPLICIT, reviewed exception: "this backend is known to diverge here, and
 *  here is why + what closes it."  Same contract as the corpus `COMPILE_SKIP`
 *  maps — a gap is a line of code someone signed, never a silent filter.
 *
 *  `path` is a glob over the divergence's body path with array indices already
 *  collapsed to `[*]`:  `**.version` (suffix, any depth) · `$[*].amount`
 *  (exact, any index) · `$.total` (exact). */
export interface WireWaiver {
  /** Backends this waiver applies to.  A divergence on any OTHER backend gates. */
  readonly backends: readonly string[];
  /** Cases it applies to; omit for every case. */
  readonly cases?: readonly string[];
  /** Glob over the request label (`"POST /api/*"`), where `*` matches exactly
   *  ONE path segment.  Omit for every request.  Needed because some
   *  divergences are scoped by the ENDPOINT rather than by a body path — e.g.
   *  "this backend over-returns on every create POST", where the extra keys
   *  are different field names on every aggregate. */
  readonly request?: string;
  /** Body path glob; `"**"` matches any path (use only with a `request` or
   *  `kinds` scope, never on its own). */
  readonly path: string;
  /** Divergence kinds it covers; omit for every kind at that path. */
  readonly kinds?: readonly RecordDivergenceKind[];
  /** Why this is tolerated AND what closes it — an RS-rule id or a mission id. */
  readonly reason: string;
}

/** Array indices → `[*]`, so one waiver covers every element of a collection. */
export function generalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, "[*]");
}

/** Glob match for waiver paths.  `**` matches any path; `**.x` matches `x` at
 *  ANY depth; otherwise the pattern must equal the generalized path exactly. */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern === "**") return true;
  const p = generalizePath(path);
  if (pattern.startsWith("**.")) {
    const suffix = `.${pattern.slice(3)}`;
    return p.endsWith(suffix);
  }
  return pattern === p;
}

/** Glob match for a request label (`"POST /api/products"`).  `*` matches
 *  exactly ONE path segment, so `POST /api/*` covers every collection create
 *  but NOT `POST /api/orders/{id}/confirm`. */
export function requestMatches(pattern: string, request: string): boolean {
  const rx = new RegExp(
    `^${pattern
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*")}$`,
  );
  return rx.test(request);
}

export function waiverCovers(
  w: WireWaiver,
  backend: string,
  caseName: string,
  d: RecordDivergence,
): boolean {
  if (!w.backends.includes(backend)) return false;
  if (w.cases && !w.cases.includes(caseName)) return false;
  if (w.kinds && !w.kinds.includes(d.kind)) return false;
  if (w.request && !requestMatches(w.request, d.request)) return false;
  return pathMatches(w.path, d.path);
}

export interface WaiverSplit {
  /** Divergences no waiver covers — these FAIL the gate. */
  readonly gating: readonly RecordDivergence[];
  /** Divergences a waiver covered, tagged with the waiver that did it. */
  readonly waived: readonly (RecordDivergence & { readonly reason: string })[];
  /** Indices into the supplied waiver list that matched nothing. */
  readonly usedWaivers: ReadonlySet<number>;
}

export function applyWaivers(
  divergences: readonly RecordDivergence[],
  backend: string,
  caseName: string,
  waivers: readonly WireWaiver[],
): WaiverSplit {
  const gating: RecordDivergence[] = [];
  const waived: (RecordDivergence & { reason: string })[] = [];
  const usedWaivers = new Set<number>();
  for (const d of divergences) {
    const hit = waivers.findIndex((w) => waiverCovers(w, backend, caseName, d));
    if (hit === -1) {
      gating.push(d);
    } else {
      usedWaivers.add(hit);
      waived.push({ ...d, reason: waivers[hit].reason });
    }
  }
  return { gating, waived, usedWaivers };
}

/** Waivers that apply to this backend + these cases but matched nothing — the
 *  RATCHET half.  A divergence that got fixed must take its waiver with it, or
 *  the list only ever grows and stops meaning anything.  Scoped so it cannot
 *  false-fire: a case-scoped waiver is only checked when ALL its cases ran. */
export function staleWaivers(
  waivers: readonly WireWaiver[],
  backend: string,
  ranCases: readonly string[],
  used: ReadonlySet<number>,
): WireWaiver[] {
  const ran = new Set(ranCases);
  return waivers.filter((w, i) => {
    if (used.has(i)) return false;
    if (!w.backends.includes(backend)) return false;
    if (w.cases) return w.cases.every((c) => ran.has(c));
    return ranCases.length > 0;
  });
}

// ── report ─────────────────────────────────────────────────────────────────

/** How many waived rows to print before collapsing to a count. */
const WAIVED_SHOWN = 6;

const short = (v: Json | undefined): string => {
  const s = JSON.stringify(v ?? null);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
};

/** Human-readable gate output.  Groups by divergence kind so a systemic class
 *  (every enum mis-cased) reads as ONE heading rather than N scattered rows. */
export function renderWireReport(backend: string, caseName: string, split: WaiverSplit): string {
  const lines: string[] = [];
  // Waived divergences are LISTED, not just counted: a tolerated divergence
  // that drifts (a different value, a wider path) would otherwise hide behind
  // its own waiver, which is the failure mode the registry exists to prevent.
  // Capped like the gating list so a systemic waiver (elixir over-returns every
  // field of every create) can't bury the rest of the log.
  for (const w of split.waived.slice(0, WAIVED_SHOWN)) {
    lines.push(
      `  ~ wire: waived #${w.seq} ${w.request} at ${w.path} — golden ${short(w.golden)} ≠ ${backend} ${short(w.actual)}  [${w.reason.split(" — ")[0]}]`,
    );
  }
  if (split.waived.length > WAIVED_SHOWN) {
    lines.push(`  ~ wire: … ${split.waived.length - WAIVED_SHOWN} more waived`);
  }
  if (split.gating.length === 0) {
    lines.push(
      `  ⟐ wire: matches golden${split.waived.length ? ` (${split.waived.length} waived)` : ""}`,
    );
    return lines.join("\n");
  }
  lines.push(
    `  ✗ wire: ${split.gating.length} divergence(s) from wire-golden/${caseName}.json on ${backend}`,
  );
  const byKind = new Map<RecordDivergenceKind, RecordDivergence[]>();
  for (const d of split.gating) {
    const b = byKind.get(d.kind) ?? [];
    b.push(d);
    byKind.set(d.kind, b);
  }
  const ORDER: RecordDivergenceKind[] = [
    "request-count",
    "request",
    "status",
    // Listed with the rest, not omitted: a kind absent from this table is
    // COUNTED in the headline and then printed nowhere, so the report reads
    // "5 divergence(s)" and names none of them.  That is the same defect this
    // gate exists to remove, one level up.
    "number-format",
    "type-mismatch",
    "key-set",
    "null-vs-empty",
    "enum-casing",
    "ordering",
    "value",
  ];
  for (const kind of ORDER) {
    const rows = byKind.get(kind);
    if (!rows?.length) continue;
    lines.push(`      ${kind} (${rows.length}):`);
    for (const d of rows.slice(0, 8)) {
      lines.push(
        `        #${d.seq} ${d.request} at ${d.path} — golden ${short(d.golden)} ≠ ${backend} ${short(d.actual)}`,
      );
    }
    if (rows.length > 8) lines.push(`        … ${rows.length - 8} more`);
  }
  return lines.join("\n");
}
