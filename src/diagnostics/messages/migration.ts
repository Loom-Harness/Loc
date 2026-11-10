// The `migration` family of the diagnostic-message catalog: schema migrations, backfills, renames and seed data.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "migration",
  "backfill",
  "rename",
  "seed",
  "version",
  "legacy",
  "diff",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/builder-call.ts
  // ----------------------------------------------------------------------
  "loom.legacy-vo-call": (p: { name: unknown }) =>
    `v2 syntax: construct '${p.name}' with builder-call form '${p.name} { ... }', not '${p.name}(...)'.`,
  "loom.legacy-part-call": (p: { name: unknown }) =>
    `v2 syntax: construct entity part '${p.name}' with builder-call form '${p.name} { ... }', not '${p.name}(...)'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/migration.ts
  // ----------------------------------------------------------------------
  "loom.migration-duplicate-name": (p: { name: unknown }) =>
    `Duplicate migration block name ${p.name}.`,
  "loom.rename-to-self#table": (p: { fromTable: unknown; to: unknown }) =>
    `Table step '${p.fromTable} -> ${p.to}' names the same declaration on both sides — a rename must change the name, a move the context.`,
  "loom.rename-to-self#field": (p: { agg: unknown; field: unknown }) =>
    `Rename of '${p.agg}.${p.field}' names the same field on both sides — a rename must change the name.`,
  "loom.rename-duplicate-source#table-is-renamed-more-than": (p: { fromTable: unknown }) =>
    `Table '${p.fromTable}' is renamed or moved more than once — a declaration can be renamed or moved FROM only once (ambiguous origin).`,
  "loom.rename-duplicate-source#field-is-renamed-more-than": (p: { sourceKey: unknown }) =>
    `Field '${p.sourceKey}' is renamed more than once — a column can be renamed FROM only once (ambiguous origin).`,
  "loom.rename-duplicate-target#two-renames-target-aggregate": (p: { to: unknown }) =>
    `Two table steps target '${p.to}' — a declaration can be renamed or moved TO only once (ambiguous destination).`,
  "loom.rename-duplicate-target#two-renames-target-a-column": (p: { targetKey: unknown }) =>
    `Two renames target '${p.targetKey}' — a column can be renamed TO only once (ambiguous destination).`,
  "loom.rename-to-self#enum-value": (p: { enumName: unknown; value: unknown }) =>
    `Rename of '${p.enumName}.${p.value}' names the same value on both sides — a rename must change the value.`,
  "loom.rename-duplicate-source#enum-value": (p: { enumName: unknown; value: unknown }) =>
    `Value '${p.enumName}.${p.value}' is renamed more than once — stored rows holding it can be remapped to only one value (ambiguous origin).`,
  "loom.migration-enum-value-form": (p: { enumName: unknown; value: unknown }) =>
    `'${p.enumName}' is an enum: a migration step on it renames a stored value (\`${p.enumName}.${p.value} -> <NewValue>\`); the \`=\` backfill form applies to aggregate fields only.`,
  "loom.migration-enum-value-unknown": (p: {
    enumName: unknown;
    value: unknown;
    values: unknown;
  }) =>
    `'${p.value}' is not a value of enum '${p.enumName}' (${p.values}) — an enum value rename maps stored rows onto a value the enum declares.`,
  "loom.migration-sql-empty": "Empty sql step — a raw migration statement must not be blank.",
  "loom.migration-sql-placement": (p: { placement: unknown }) =>
    `Unknown sql step placement '${p.placement}' — the only placement is \`before\` (\`sql before "…"\` runs ahead of the generation's structural DDL); omit it to run after.`,
  "loom.backfill-unknown-field": (p: { field: unknown; agg: unknown }) =>
    `'${p.field}' is not a field of aggregate '${p.agg}' — a backfill targets a live field (it names the newly-added column).`,
  "loom.backfill-unknown-field#inherited": (p: { field: unknown; agg: unknown; base: unknown }) =>
    `'${p.field}' is inherited by '${p.agg}' from '${p.base}' — backfill it where it is declared: \`${p.base}.${p.field} = …\` fills it in every table that stores it.`,
  "loom.backfill-duplicate": (p: { key: unknown }) =>
    `Field '${p.key}' is backfilled more than once in this block — one backfill per column per block (ambiguous value).`,

  // ----------------------------------------------------------------------
  // src/language/validators/seed.ts
  // ----------------------------------------------------------------------
  "loom.seed-foreign-aggregate": (p: { name: unknown; aggCtxName: unknown; ownCtxName: unknown }) =>
    `Seed row references aggregate '${p.name}' from context ` +
    `'${p.aggCtxName}', but the seed is declared in context ` +
    `'${p.ownCtxName}'. A seed may only populate aggregates of its ` +
    `own context.`,
  "loom.seed-duplicate-field": (p: { name: unknown; name2: unknown }) =>
    `Duplicate field '${p.name}' in seed row '${p.name2}'.`,
  "loom.seed-id-needs-raw":
    "An explicit `id` requires `seed raw { … }` — the domain create path mints ids. " +
    "Cross-references use explicit ids on the raw path.",
  "loom.seed-raw-column-invalid": (p: { name: unknown }) =>
    `Raw seed column '${p.name}' is a value object / nested record — raw rows ` +
    "support scalar / enum / id columns only; use the domain path for value objects.",
  "loom.seed-dataset-name-collision": (p: { name: unknown; name2: unknown }) =>
    `Seed dataset '${p.name}' collides with '${p.name2}' once cased into a seeder ` +
    "function name (snake on elixir/python, PascalCase on node/java/.NET), so the two " +
    "datasets would emit one duplicated function — a compile error on three backends and " +
    "a silently-dropped dataset on the other two. Rename one, or merge them into a single " +
    "`seed` block (blocks with the SAME name already merge).",
  "loom.seed-raw-document-shape": (p: { name: unknown }) =>
    `Raw seed row on '${p.name}': a \`shape: document\` aggregate is stored as ` +
    "(id, data, version) with the whole tree in one jsonb column, so it has no per-field " +
    "columns for a raw INSERT to target (Postgres answers 42703 at first boot). Use the " +
    "domain path — `seed <dataset> { … }` without `raw` — which writes a document " +
    "aggregate correctly on every backend.",
  "loom.seed-raw-eventsourced": (p: { name: unknown }) =>
    `Raw seed row on event-sourced aggregate '${p.name}': its truth is the append-only ` +
    "`<agg>_events` stream (stream_id, version, type, data, occurred_at), so it has no " +
    "per-field columns for a raw INSERT to target. Use the domain path — " +
    "`seed <dataset> { … }` without `raw` — which appends the creation event correctly " +
    "on every backend.",
  "loom.seed-eventsourced-no-create": (p: { name: unknown }) =>
    `Seed row on event-sourced aggregate '${p.name}': it declares no \`create\` action, ` +
    "so there is no creation event for a seed row to append — it is constructed only " +
    "out-of-band. Add a canonical `create(...)` to seed it, or drop the row.",
  "loom.seed-abstract-aggregate": (p: { name: unknown }) =>
    `Seed row on abstract aggregate '${p.name}': an inheritance base has no create ` +
    "factory and no repository, so every backend drops the row — and elixir still commits " +
    "the dataset's ship-once marker, so it can never be applied later. Seed a concrete " +
    "subtype instead.",
  "loom.seed-tenant-owned-needs-raw": (p: { name: unknown }) =>
    `Seed row on tenant-owned aggregate '${p.name}' uses the domain create path, which ` +
    "stamps `tenantId` FROM THE PRINCIPAL — and a first-boot seeder has none, so " +
    "the row is written with an empty/NULL tenant and no tenant can ever read it. Use " +
    "`seed <dataset> raw { … }` and spell the tenant columns (and the row's `id`) " +
    "explicitly instead.",

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/migration-checks.ts
  // ----------------------------------------------------------------------
  "loom.backfill-target-invalid#backfill-a-aggregate-stores": (p: {
    aggregate: unknown;
    field: unknown;
    persistedAs: unknown;
  }) =>
    `backfill '${p.aggregate}.${p.field}': a ${
      p.persistedAs
    } aggregate stores no scalar columns to backfill — use a raw sql step over its payload instead.`,
  "loom.backfill-target-invalid#backfill-the-field-is-not": (p: {
    aggregate: unknown;
    field: unknown;
  }) =>
    `backfill '${p.aggregate}.${p.field}': the field is not a single scalar column (value-object, collection and entity fields cannot be backfilled — Phoenix stores a value object as one map column, so a leaf UPDATE would not be portable).`,
  "loom.backfill-target-invalid#backfill-collection-needs-none": (p: {
    aggregate: unknown;
    field: unknown;
  }) =>
    `backfill '${p.aggregate}.${p.field}': a collection field needs no backfill — adding it to a populated table fills every existing row with an empty collection. Remove this step.`,
  "loom.migration-step-unknown-context": (p: { step: unknown; context: unknown }) =>
    `migration step '${p.step}' moves into context '${p.context}', which the model does not declare. Name the context the declaration lives in now.`,
  "loom.migration-step-target-missing": (p: { step: unknown; name: unknown }) =>
    `migration step '${p.step}': '${p.name}' is not an aggregate, workflow or projection of the model. The right-hand side names the declaration as it is NOW (after the rename or move).`,
  "loom.migration-step-ambiguous": (p: { step: unknown; name: unknown; candidates: unknown }) =>
    `migration step '${p.step}': '${p.name}' names more than one declaration (${p.candidates}). Qualify both sides with their contexts: migration "…" { <OldContext>.<Old> -> <NewContext>.<New> }`,
  "loom.migration-move-across-databases": (p: {
    step: unknown;
    from: unknown;
    to: unknown;
    deployables: unknown;
  }) =>
    `migration step '${p.step}' moves tables from module '${p.from}' to module '${p.to}', but deployable(s) ${p.deployables} apply '${p.to}' migrations to a database that never held '${p.from}' tables, so there is nothing there to move. Host both modules on deployables that share a database (one \`storage\`), or migrate the data with a raw \`sql\` step.`,
  "loom.migration-expr-unsupported": (p: { aggregate: unknown; field: unknown; reason: unknown }) =>
    `backfill '${p.aggregate}.${p.field}': ${p.reason}.`,
  "loom.backfill-type-mismatch": (p: {
    aggregate: unknown;
    field: unknown;
    got: unknown;
    expected: unknown;
  }) =>
    `backfill '${p.aggregate}.${p.field}': expression type '${p.got}' does not fit the field's type '${p.expected}'.`,
  "loom.backfill-type-mismatch#optional-source": (p: {
    aggregate: unknown;
    field: unknown;
    sources: unknown;
    example: unknown;
  }) =>
    `backfill '${p.aggregate}.${p.field}': the value can be null (it reads the optional field(s) ${p.sources}), but '${p.field}' is required — a row the UPDATE leaves NULL makes the following SET NOT NULL fail. Give it a fallback, e.g. \`${p.aggregate}.${p.field} = ${p.example} ?? <value>\`.`,

  // ----------------------------------------------------------------------
  // src/system/migrations-builder.ts — phase ⑨ (migration derivation)
  // ----------------------------------------------------------------------
  /** A same-table drop+add the rename heuristic could not collapse (a rename
   *  that also changed type, or two renames at once).  The remedy is a
   *  `migration` block, which is a TOP-LEVEL declaration — placed inside
   *  `system { }` it is a parse error — so the text says where it goes. */
  "loom.migration-ambiguous-rename": (p: { module: unknown; renames: unknown }) =>
    `migration for module "${p.module}" drops and adds column(s) on the same table that look like an unannotated rename — emitting them as drop+add would DESTROY the renamed column's data:\n${p.renames}\n` +
    `If this is a rename, declare it explicitly so the data is preserved. Add this block at the TOP LEVEL of the .ddd file — outside \`system { … }\`, as a sibling of it (inside it is a parse error):\n` +
    `  migration "<name>" { <Aggregate>.<oldField> -> <newField> }\n` +
    `(one line per renamed field; this handles both a rename that also changes type and two renames at once.)\n` +
    `If you really mean to drop the old column and add a new empty one — losing the data — record it with \`ddd migrate add <name> <file.ddd> --allow-destructive\`.`,
  /** A declared backfill whose column is arriving in THIS migration, yet no
   *  step consumed it — the silent-discard shape (F-018). A backfill is
   *  legitimately inert once its column is in the baseline; this fires only
   *  when it is NOT, so nothing will ever run the author's declared value. */
  "loom.migration-backfill-discarded": (p: { module: unknown; columns: unknown }) =>
    `migration for module "${p.module}" declares backfill(s) for column(s) that this migration ADDS, but nothing consumed them — the declared value would never run:\n${p.columns}\nThis is an internal inconsistency in the derived migration, not a mistake in the model. Report it: the migration was NOT written.`,
  /** The rename heuristic GUESSED (docs/migrations.md § Rename detection): one
   *  dropped column plus one added column, same type and nullability, with no
   *  backfill and no default, collapsed into a single `renameColumn`.  The
   *  inference is deliberate and load-bearing — a real rename would otherwise
   *  lose its data — but it is structurally unable to tell a rename from two
   *  unrelated columns, since both produce a byte-identical diff.  So it
   *  ANNOUNCES itself: a warning (never an error — an error would break every
   *  model relying on the collapse) so the one case it gets wrong is a line on
   *  stderr instead of a silently misattributed column. */
  "loom.migration-block-applied": (p: { block: unknown }) =>
    `migration "${p.block}" is fully applied: every step is already recorded in the schema snapshot (its renames and backfills are reflected in the schema, its sql steps are in the applied ledger), so it has no further effect. You may remove it from the source; the migration files already emitted keep its SQL.`,
  "loom.migration-rename-inferred": (p: { module: unknown; from: unknown; to: unknown }) =>
    `migration for module "${p.module}": inferred a RENAME of ${p.from} -> ${p.to} (one dropped column, one added column, same type and nullability, no backfill and no default). If these are unrelated columns, the old column's data will land under the new name. Declare the intent either way:\n` +
    `    migration "rename-…" { <Aggregate>.<oldField> -> <newField> }   // yes, a rename\n` +
    `    migration "backfill-…" { <Aggregate>.<newField> = <value> }     // no — a new column, and this is what its existing rows get`,
  /** One line of `loom.migration-destructive` for a NOT NULL column a built-in
   *  CAPABILITY adds to an existing table, when Loom cannot know what the rows
   *  already there should hold (`tenantOwned`'s tenant, `auditable`'s
   *  creation stamps).  The author never spelled the column, so the line names
   *  the capability and the field and says why there is no automatic backfill
   *  (`softDeletable`'s flag has one and never reaches this). */
  "loom.migration-destructive#capability-column": (p: {
    column: unknown;
    capability: unknown;
    why: unknown;
  }) =>
    `ADD COLUMN ${p.column} NOT NULL (no default) — contributed by \`with ${p.capability}\`. ${p.why} Declare what the existing rows hold in a migration block (\`migration "…" { <Agg>.<field> = <value> }\`), or add the capability before the table holds data.`,
  /** One line of `loom.migration-destructive` when a TABLE is dropped: a
   *  rename, or a move of the declaration to another context, reads as a
   *  drop + create to the diff, and the table step keeps the rows. */
  "loom.migration-destructive#table-dropped":
    'A dropped table whose aggregate, workflow or projection was renamed or moved to another context keeps its rows with a migration-block table step: migration "…" { <Old> -> <New> } for a rename, migration "…" { <OldContext>.<Old> -> <NewContext>.<New> } for a move.',
  "loom.migration-destructive#capability-tenant-owned":
    "Loom cannot infer which tenant owns a row written before tenancy, and a wrong guess hands it to another tenant, so there is no automatic backfill.",
  "loom.migration-destructive#capability-auditable":
    "The real creation time and author of a row written before auditing are unknown, so there is no automatic backfill.",
  /** B-20b — a `unique (…)` index added to a table the baseline already has.
   *  Rows may already violate it, which fails the migration at boot and
   *  queues every later generation behind it.  Silenced by declaring a
   *  `sql before` step for the module in the same generation. */
  "loom.migration-unique-on-existing-table": (p: {
    module: unknown;
    table: unknown;
    columns: unknown;
    index: unknown;
    partial: unknown;
  }) =>
    `migration for module "${p.module}": adds unique index ${p.index} on existing table ${p.table} (${p.columns})${p.partial}. Rows already stored may violate it — a duplicate fails CREATE UNIQUE INDEX at boot, the migration rolls back, and later generations queue behind it. If the table can hold duplicates, dedupe them AHEAD of the index in this same generation (declaring one silences this warning):\n` +
    `    migration "dedupe-…" { sql before "UPDATE <schema>.<table> SET … WHERE …" }`,
  /** An enum CHECK on an existing table lost a member (deleted or renamed in
   *  the `enum`) and no migration step accounts for it.  The constraint lands
   *  NOT VALID, so the deploy would succeed, but rows still holding a removed
   *  value fail to load on every backend and cannot be updated — so `ddd
   *  migrate add` refuses it (breaking-for-data) until a declared rename, a
   *  `sql` step or `--allow-destructive` accounts for it. */
  "loom.migration-enum-narrowed": (p: {
    module: unknown;
    enumName: unknown;
    table: unknown;
    column: unknown;
    check: unknown;
    removed: unknown;
    kept: unknown;
    firstRemoved: unknown;
  }) =>
    `migration for module "${p.module}": enum check ${p.check} on existing table ${p.table} no longer admits ${p.removed} in column ${p.column}. Rows already stored may still hold a removed value: such a row fails to load on every backend except node (python/java/.NET/elixir map the stored string onto the enum; a list route that reads it fails as a whole), node serves it off-contract, and any UPDATE of it is refused by the new check. Declare what the stored values become — a value rename updates every column that stores the enum:\n` +
    `    migration "rename-…" { ${p.enumName}.${p.firstRemoved} -> <one of ${p.kept}> }\n` +
    `or remap them yourself with a \`sql\` step in the same generation, or — when no row can hold a removed value — record it with --allow-destructive.`,
  /** A declared enum value rename whose enum is also stored where the
   *  generated UPDATEs cannot reach — inside a JSON column (a document-shaped
   *  aggregate's `data`, an embedded containment, a value object collapsed to
   *  one column) or an event-sourced stream's event payloads.  The relational
   *  columns are migrated; these are named so the author remaps them. */
  "loom.migration-enum-value-unmigrated": (p: {
    module: unknown;
    enumName: unknown;
    from: unknown;
    to: unknown;
    where: unknown;
  }) =>
    `migration for module "${p.module}": the rename ${p.enumName}.${p.from} -> ${p.to} updates every column that stores the enum, but ${p.enumName} is also stored inside JSON the generated UPDATEs do not rewrite:\n${p.where}\nA stored '${p.from}' there still fails to load. Remap it with a \`sql\` step in the same migration block (for example \`UPDATE … SET data = jsonb_set(data, '{<path>}', '"${p.to}"') WHERE data #>> '{<path>}' = '${p.from}'\`), or upcast the old value where the event is read.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/query-checks.ts
  // ----------------------------------------------------------------------
  "loom.seed-raw-non-literal-column": (p: { aggregate: unknown; name: unknown; value: unknown }) =>
    `seed raw '${p.aggregate}.${p.name}': a raw-seed column must be a scalar / enum / id ` +
    `literal (or 'now()'); the value '${p.value}' is computed at ` +
    `generate time, which the direct-INSERT seed path can't render. ` +
    `Use a literal value, or the domain seed path ('seed { … }' without 'raw').`,

  // ----------------------------------------------------------------------
  // src/macros/expander.ts
  // ----------------------------------------------------------------------
  "loom.version-field-collision": (p: { field: unknown; name: unknown }) =>
    `field '${p.field}' on aggregate '${p.name}' collides with Loom's optimistic-concurrency counter 'rowVersion' ` +
    `(column 'row_version'), an 'int' every save rewrites. Rename this field — 'version' is an ordinary field ` +
    `name — or declare it 'rowVersion: int' if you meant the concurrency counter.`,

  // ----------------------------------------------------------------------
  // src/api/evolve.ts
  // ----------------------------------------------------------------------
  "loom.diff-baseline-invalid": (p: { detail: unknown }) =>
    `The baseline source does not load (${p.detail}), so there is nothing to diff against. Pass the previous model as it was, or omit \`baseline\` for a first-run diff.`,
  "loom.migration-chain-invalid": (p: { detail: unknown }) =>
    `The migration chain does not read as one list: ${p.detail}`,

  // ----------------------------------------------------------------------
  // src/api/migrate.ts
  // ----------------------------------------------------------------------
  /** `loom_migration_record`'s name refusal: the name is not kebab-case, or
   *  the module already has a migration by that name.  The CLI prints the
   *  same detail for `ddd migrate add`. */
  "loom.migration-name-invalid": (p: { detail: unknown }) =>
    `The migration cannot be recorded under that name: ${p.detail}`,
} satisfies Record<string, MessageEntry>;
