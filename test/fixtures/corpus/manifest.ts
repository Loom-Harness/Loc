// Shared fixture corpus — the declared feature × backend coverage matrix.
//
// One canonical `.ddd` per feature (platform-agnostic, `platform: __PLATFORM__`)
// lives beside this file, and its manifest row lives beside it too, as
// `<id>.corpus.json`.  `CORPUS` is discovered from those sidecars, so adding a
// feature = drop `<feature>.ddd` + `<feature>.corpus.json` here, and two
// changes that add different features touch disjoint files and merge without
// conflict.  `test/conformance/corpus-coverage.test.ts` enforces the matrix:
// every declared cell must generate cleanly in-memory (no docker).
//
// A sidecar holds `title`, optional `doc` / `note` / `deployables`, an optional
// `"//"` comment, and `backends`: either a list of backend keys or the name of
// one of the `BACKEND_SETS` below.  Loading fails loudly on an unpaired `.ddd`
// or sidecar, an unknown key, an unknown set name, or a missing title, so a
// malformed row never drops out of the matrix silently.
//
// This is the machine-readable form of the matrix in
// `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/global-test-coverage-plan.md`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Backend, BACKENDS } from "./backends.js";

/** All backends — the common case for platform-agnostic domain features. */
const ALL: readonly Backend[] = BACKENDS;

/** Every backend filters a `shape: document` aggregate IN-APP over the
 *  rehydrated instance (the jsonb blob is not per-field queryable), so the
 *  document × authorization crossing now runs on ALL five — this alias is kept
 *  as the NAME of that property, and as the place its history is recorded.
 *
 *  3 -> 4: `dotnet` joined.  It was excluded for a compile gap + a silent
 *  unfiltered read, and BOTH are closed — `src/generator/dotnet/emit/repository.ts`
 *  now hoists the AND-ed capability predicate into `_CapabilityVisible(...)` and
 *  applies it on all three document read paths (`GetByIdAsync`,
 *  `FindManyByIdsAsync`, every emitted find), and emits the
 *  `GetByIdForWriteAsync` write-scope member whose absence was the CS0535.
 *
 *  4 -> 5: `elixir` joined.  It was the LAST unwired (family, shape) cell in
 *  `supportsNonRelationalFilter`'s whole inventory — an honest, coded rejection
 *  (`loom.context-filter-no-principal`), not a silent gap, but a rejection all
 *  the same.  `renderDocRepository` now AND-s the capability predicate into
 *  every document read (`list`, `find_by_id`, `find_by_id_for_write`, and each
 *  custom find), evaluated over the rehydrated `%<Agg>.Data{}` embed with the
 *  `deep` sentinel rendered by `renderDeepScopeInApp`. */
const IN_APP_DOCUMENT_FILTER: readonly Backend[] = ALL;


/** The backends whose transactional workflow dispatches an aggregate event only
 *  AFTER its transaction commits — the one runtime-distinguishable half of
 *  banking-eval B-04 (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T4-eventing-temporal.md, M-T4.3 item 6).
 *
 *  This is the NAME of the restriction.  Every leg below except java was
 *  measured by booting it (#3224), not reasoned:
 *  - node: the backend where the defect was DB-visible — its reactors run on
 *    the pool, so a rolled-back workflow's `Debited` still committed the
 *    reactor's Audit row.  Discriminates.
 *  - python: passes.  Its reactor runs inside the open transaction (same
 *    session), so the dispatch half has no discriminating power there; armed
 *    because it honestly passes.  Its 409 `detail` is node's sentence since
 *    M-T6.91 (RS-40), so no wire waiver.
 *  - .NET (the `dotnet` key — both persistence adapters, since the Dapper
 *    leg reads the same key): EF discriminates M-T6.90 — two `getById` loads of
 *    one row were ONE tracked entity, so `debitTwice` never conflicted and the
 *    double debit committed (`expected the call to reject, but it resolved`);
 *    the second handle now loads into a forked change tracker and its stale
 *    save 409s.  Dapper discriminates #3224's atomicity fix: pre-fix the saves
 *    committed on their own connections (`expected 80 to be 90`).  Same 409
 *    `detail` (RS-40).
 *  - elixir (`vanilla`): passes since M-T6.92.  Pre-fix the stale save inside
 *    the workflow's `Repo.transaction` rolled back but answered 500: the
 *    workflows controller's `respond/2` had no `{:error, :conflict}` arm, so
 *    the rescued `Ecto.StaleEntryError` fell to the sanitized catch-all.
 *    Same 409 `detail` waiver (M-T6.91).
 *  - java: passes since M-T6.93 — each `getById` load is its own detached
 *    handle, so the second save of `debitTwice` is stale and the workflow
 *    rolls back.  Its dispatch half (the workflow route publishes after the
 *    commit) is gated by `transactional-workflow-post-commit-dispatch`, which
 *    runs on every backend. */
const POST_COMMIT_WORKFLOW_DISPATCH: readonly Backend[] = ["node", "python", "dotnet", "vanilla", "java"];

/** The backends where two `getById` loads of one row inside a workflow are two
 *  independent handles over a contained collection
 *  (`workflow-two-handles-containment`, M-T6.90).  Every leg was booted:
 *  - node, python, .NET Dapper: pass (the loads were always two objects).
 *  - .NET EF: passes with M-T6.90; pre-fix the identity map handed both loads
 *    one tracked instance, so `addTwice` resolved instead of 409ing.
 *  - java: passes with M-T6.93; pre-fix the JPA persistence context returned
 *    one managed instance for both loads, so the version CAS in `save` read the
 *    already-bumped version and `addTwice` resolved.  A repeat load now reads a
 *    detached copy through a connection-sharing child Session.
 *  - elixir (`vanilla`): FAILS earlier — a contained-part removal
 *    (`lines -= …`) does not persist even over the single-handle operation
 *    route (`expected 2 to be 1`, M-T6.94); the stale save would then
 *    answer M-T6.92's (now fixed) 409. */
const INDEPENDENT_HANDLES: readonly Backend[] = ["node", "python", "dotnet", "java"];

/** The backends whose in-workflow stale save of a `shape: document` row or a
 *  `persistedAs: eventLog` stream answers the RS-40 409
 *  (`workflow-two-handles-document-eventlog`, M-T6.95 / M-T6.98).
 *
 *  ELIXIR is out.  Its store refuses the stale write (`{:error, :conflict}`)
 *  and the workflows controller maps that term to 409 (M-T6.92), but:
 *   - that term carries no aggregate/id, so the RS-40 `detail` sentence cannot
 *     be built from it;
 *   - elixir persists each op call inside a workflow (the other four save a
 *     handle once at the end), so `hitSameTwice` bumps the document `version`
 *     twice — `$.version` reads one higher than the golden (M-T6.99).
 *  Arm it by adding `"vanilla"` here when those close. */
const WORKFLOW_DOC_ES_CONFLICT: readonly Backend[] = ALL.filter((b) => b !== "vanilla");

/** The backends that compile a hosted `X id[]` whose target aggregate lives in a
 *  sibling context the deployable does NOT host (claims eval D18's list position).
 *
 *  `vanilla` (elixir) is absent, and this is the NAME of that exclusion: the
 *  schema emits `many_to_many :others, <App>.<HostCtx>.Pol, join_through: …` —
 *  an Ecto association to a schema module that exists in no context of this
 *  deployable, so `mix compile --warnings-as-errors` fails with "invalid
 *  association … associated schema … does not exist".  The join-table migration
 *  itself is fine (no FK).  The elixir key returns the day its id-list emitter
 *  stops modelling a NON-hosted target as an Ecto association. */
const FOREIGN_ID_LIST: readonly Backend[] = ALL.filter((b) => b !== "vanilla");

/** `projection-valueobject-row` — a `valueobject` field on a FOLDED PROJECTION's
 *  read model.  The shared `MigrationsIR` spreads it into one column per leaf
 *  (`stamp_at_time` / `stamp_who`) while every response DTO declares it NESTED,
 *  so a read model has to bridge the two halves: the fold writes the leaves, the
 *  read route rebuilds the nest.
 *
 *  **node**, **java** and **elixir** do.  The other two are excluded, and
 *  each key returns with its own fix:
 *
 *  - **java** is IN the row: booted on its behavioural leg it matches the
 *    golden — `@Embedded` + `@AttributeOverride` onto exactly the
 *    migration's flat columns, rebuilt into the nested response records.
 *  - **dotnet**: `OrderBoardRowConfiguration` maps the value object as a SCALAR
 *    property to one column (`builder.Property(x => x.St).HasColumnName("st")`)
 *    that the migration never creates; booted on its behavioural leg the
 *    emitted project does not even pass `dotnet build /warnaserror`.
 *  - **python**: the route returns `{"st": row.st}` against a SQLAlchemy model
 *    whose only attributes are `st_at_time` / `st_who` — `AttributeError`.
 *  - **elixir** (`vanilla`) is IN the row: booted on its behavioural leg it
 *    builds, folds and round-trips the read model.  Its one divergence is the
 *    nested value object's KEY spelling (`at_time` where the golden has
 *    `atTime`, RS-1), a path-scoped wire waiver (#4023).
 *
 *  The excluded keys are booted as tracked expected failures on their legs
 *  (`BEHAVIOURAL_XFAIL`, test/behavioral/registers.mjs, #4023). */
const PROJECTION_VO_ROW: readonly Backend[] = ["node", "java", "vanilla"];

/** The backends that write a provenanced value into its lineage in the
 *  `Codec` fact's lineage encoding — the wire form: money's RS-12 string
 *  (owner ruling on #3527), a decimal's RS-24 number and a datetime's RS-38
 *  instant (owner rulings on #3593).  node, python, dotnet (EF and Dapper) and
 *  java and elixir (`vanilla`) are on the fact — every backend. */
const MONEY_LINEAGE_WIRE: readonly Backend[] = ["node", "python", "dotnet", "java", "vanilla"];

// M-T6.96: .NET EF cannot re-host a part's nested OWNED instances under a new
// owner (they are deleted with the old one), so the rebuild shape is held off
// .NET until that lands — then this becomes ALL.
const PART_REBUILD: readonly Backend[] = ALL.filter((b) => b !== "dotnet");

// #3959: the polymorphic base read (`GET /<bases>/{id}`, a projection `from
// <Base>`) passes on node — both persistence adapters, drizzle and MikroORM
// (`node` is the manifest key of both behavioural legs) — python/SQLAlchemy,
// .NET EF, java and elixir/Ecto.  The other legs boot the case as a tracked expected failure
// (`BEHAVIOURAL_XFAIL`), each fixed by its own sub-issue of #3954
// (#3960–#3965); each fix adds its backend here, and the row becomes ALL when
// the last one lands.
const BASE_READS: readonly Backend[] = ["node", "python", "dotnet", "java", "vanilla"];

export interface CorpusFeature {
  /** Matches `<id>.ddd` in this directory. */
  readonly id: string;
  /** One-line description of the language feature exercised. */
  readonly title: string;
  /** Reference doc under `docs/` (without extension), or undefined. */
  readonly doc?: string;
  /** Backends declared to generate this feature cleanly (enforced by the gate). */
  readonly backends: readonly Backend[];
  /** Notes on any backend exclusions. */
  readonly note?: string;
  /**
   * Emitted project dirs the compile tiers build — one per `deployable` in the
   * `.ddd`.  Defaults to the single `d` (`CORPUS_DEPLOYABLE`) every ordinary
   * fixture declares, so only a MULTI-service fixture needs this key.
   *
   * It is declared here rather than discovered from the file map because the
   * compile harnesses must know what to build BEFORE they generate — and
   * because a fixture that quietly renames its deployable would otherwise turn
   * a compile gate into a no-op.  `corpus-coverage.test.ts` cross-checks this
   * list against the dirs actually emitted, so the two cannot drift.
   */
  readonly deployables?: readonly string[];
  /** How the behavioural legs' fake services behave for this case.
   *  `broker: "after-boot"`: the case's broker refuses connections while the
   *  backend boots and comes up once the backend has tried it — the boot
   *  gate (`test/support/fakes/broker-sidecar.mjs`). */
  readonly fakes?: { readonly broker?: "after-boot" };
  /**
   * The fixture's entries in the api-caller census
   * (`test/ir/api-caller-census.test.ts`), kept beside the fixture so two
   * changes pinning different fixtures never edit one shared map:
   * `uncalled` maps a derived operationId with no `test e2e` caller to its
   * reason class (a key of `R` in `api-caller-census-pins.ts`); `unattributed`
   * lists the `api.*` calls that map to no derived operation (a workflow run,
   * a projection read); `e2eLess` says why the fixture has no `test e2e` block.
   */
  readonly apiCaller?: CorpusApiCaller;
}

export interface CorpusApiCaller {
  readonly uncalled?: Readonly<Record<string, string>>;
  readonly unattributed?: readonly string[];
  readonly e2eLess?: string;
}

/** The named backend sets a sidecar's `backends` may cite instead of a list. */
export const BACKEND_SETS: Readonly<Record<string, readonly Backend[]>> = {
  ALL,
  BASE_READS,
  FOREIGN_ID_LIST,
  INDEPENDENT_HANDLES,
  IN_APP_DOCUMENT_FILTER,
  MONEY_LINEAGE_WIRE,
  PART_REBUILD,
  POST_COMMIT_WORKFLOW_DISPATCH,
  PROJECTION_VO_ROW,
  WORKFLOW_DOC_ES_CONFLICT,
};

const SIDECAR_SUFFIX = ".corpus.json";
const SIDECAR_KEYS = new Set(["//", "title", "doc", "backends", "note", "deployables", "apiCaller", "fakes"]);
const API_CALLER_KEYS = new Set(["//", "uncalled", "unattributed", "e2eLess"]);

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Why a sidecar's `apiCaller` block is malformed (empty when it is not). */
function apiCallerErrors(where: string, v: unknown): string[] {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    return [`${where}: \`apiCaller\` must be an object`];
  const o = v as Record<string, unknown>;
  const errors = Object.keys(o)
    .filter((k) => !API_CALLER_KEYS.has(k))
    .map((k) => `${where}: unknown apiCaller key ${JSON.stringify(k)}`);
  const u = o.uncalled;
  if (
    u !== undefined &&
    (u === null ||
      typeof u !== "object" ||
      Array.isArray(u) ||
      !Object.values(u).every((r) => typeof r === "string"))
  )
    errors.push(`${where}: \`apiCaller.uncalled\` must map operationIds to reason-class names`);
  if (o.unattributed !== undefined && !isStringList(o.unattributed))
    errors.push(`${where}: \`apiCaller.unattributed\` must be a list of strings`);
  if (o.e2eLess !== undefined && typeof o.e2eLess !== "string")
    errors.push(`${where}: \`apiCaller.e2eLess\` must be a string`);
  return errors;
}

/** Parse one sidecar's JSON into a row, or the reasons it is malformed. */
export function parseSidecar(id: string, raw: unknown): { row?: CorpusFeature; errors: string[] } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { errors: [`${id}${SIDECAR_SUFFIX}: not a JSON object`] };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!SIDECAR_KEYS.has(k)) errors.push(`${id}${SIDECAR_SUFFIX}: unknown key ${JSON.stringify(k)}`);
  if (typeof o.title !== "string" || o.title === "")
    errors.push(`${id}${SIDECAR_SUFFIX}: \`title\` must be a non-empty string`);
  for (const k of ["doc", "note"] as const)
    if (o[k] !== undefined && typeof o[k] !== "string")
      errors.push(`${id}${SIDECAR_SUFFIX}: \`${k}\` must be a string`);
  let backends: readonly Backend[] | undefined;
  if (typeof o.backends === "string") {
    backends = BACKEND_SETS[o.backends];
    if (!backends)
      errors.push(`${id}${SIDECAR_SUFFIX}: unknown backend set ${JSON.stringify(o.backends)}`);
  } else if (Array.isArray(o.backends) && o.backends.every((b) => typeof b === "string")) {
    backends = o.backends as Backend[];
  } else {
    errors.push(`${id}${SIDECAR_SUFFIX}: \`backends\` must be a backend-set name or a list of backend keys`);
  }
  const deployables = o.deployables;
  if (
    deployables !== undefined &&
    !(Array.isArray(deployables) && deployables.every((d) => typeof d === "string"))
  )
    errors.push(`${id}${SIDECAR_SUFFIX}: \`deployables\` must be a list of strings`);
  const fakes = o.fakes;
  if (
    fakes !== undefined &&
    !(
      fakes !== null &&
      typeof fakes === "object" &&
      !Array.isArray(fakes) &&
      Object.entries(fakes).every(([k, v]) => k === "broker" && v === "after-boot")
    )
  )
    errors.push(`${id}${SIDECAR_SUFFIX}: \`fakes\` may only be { "broker": "after-boot" }`);
  if (o.apiCaller !== undefined) errors.push(...apiCallerErrors(`${id}${SIDECAR_SUFFIX}`, o.apiCaller));
  if (errors.length > 0 || !backends) return { errors };
  return {
    errors,
    row: {
      id,
      title: o.title as string,
      ...(o.doc !== undefined ? { doc: o.doc as string } : {}),
      backends,
      ...(o.note !== undefined ? { note: o.note as string } : {}),
      ...(deployables !== undefined ? { deployables: deployables as string[] } : {}),
      ...(fakes !== undefined ? { fakes: fakes as { broker?: "after-boot" } } : {}),
      ...(o.apiCaller !== undefined ? { apiCaller: o.apiCaller as CorpusApiCaller } : {}),
    },
  };
}

/** The `.ddd` ids with no sidecar and the sidecars with no `.ddd`. */
export function unpairedFixtures(fileNames: readonly string[]): string[] {
  const ddd = new Set(fileNames.filter((f) => f.endsWith(".ddd")).map((f) => f.slice(0, -4)));
  const rows = new Set(
    fileNames.filter((f) => f.endsWith(SIDECAR_SUFFIX)).map((f) => f.slice(0, -SIDECAR_SUFFIX.length)),
  );
  return [
    ...[...ddd].filter((id) => !rows.has(id)).map((id) => `${id}.ddd has no ${id}${SIDECAR_SUFFIX}`),
    ...[...rows].filter((id) => !ddd.has(id)).map((id) => `${id}${SIDECAR_SUFFIX} has no ${id}.ddd`),
  ].sort();
}

/** This directory.  The behavioural runner bundles this module to a scratch
 *  dir, where `import.meta.url` no longer points here, and names the corpus
 *  dir in `LOOM_CORPUS_DIR` instead. */
function corpusDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (fs.existsSync(path.join(here, "backends.ts"))) return here;
  const named = process.env.LOOM_CORPUS_DIR;
  if (named) return named;
  throw new Error(
    `corpus manifest: ${here} is not the corpus directory and LOOM_CORPUS_DIR is unset`,
  );
}

function loadCorpus(): readonly CorpusFeature[] {
  const dir = corpusDir();
  const names = fs.readdirSync(dir).sort();
  const errors = unpairedFixtures(names);
  const rows: CorpusFeature[] = [];
  for (const f of names) {
    if (!f.endsWith(SIDECAR_SUFFIX)) continue;
    const id = f.slice(0, -SIDECAR_SUFFIX.length);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
      continue;
    }
    const parsed = parseSidecar(id, raw);
    errors.push(...parsed.errors);
    if (parsed.row) rows.push(parsed.row);
  }
  if (errors.length > 0)
    throw new Error(`corpus manifest (${dir}) is malformed:\n  ${errors.join("\n  ")}`);
  return rows;
}

/** Every corpus feature, sorted by id. */
export const CORPUS: readonly CorpusFeature[] = loadCorpus();

/** Lookup by id. */
export function corpusFeature(id: string): CorpusFeature | undefined {
  return CORPUS.find((f) => f.id === id);
}
