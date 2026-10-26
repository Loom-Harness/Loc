import type { EnrichedBoundedContextIR, FieldIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { provenancedTypeMembers } from "../../_payload/provenanced-wire.js";
import { jid } from "../java-ident.js";

// ---------------------------------------------------------------------------
// Provenance runtime — the Java / Spring counterpart of the Hono
// `domain/provenance.ts` SDK, the .NET `Domain/Common/ProvLineage.cs` +
// `provenance_records` history table, and the elixir-vanilla `<App>.Provenance`
// module.  Emitted only when a context declares at least one `provenanced`
// field (gated on `agg.fields.some(f => f.provenanced)`, never on a backend
// allowlist).
//
//   - `ProvLineage` / `ProvTarget` / `ProvInput` (domain.common) — the
//     immutable lineage value every provenanced write-site builds.  Same jsonb
//     shape as the Hono/.NET lineages (`{ snapshotId, target: { type, field },
//     inputs: [{ path, value }], computedValue }`); persisted co-located on the
//     row's `<field>_provenance` jsonb column (Hibernate's JSON FormatMapper)
//     and appended to the `provenance_records` history table.
//   - `ProvenanceRecord` (infrastructure.persistence) — the append-only JPA
//     `@Entity` for the `provenance_records` table, one row per write,
//     flushed in the aggregate's `@Transactional` save (governance stamps
//     included).
//   - `ProvenanceRecordRepository` (infrastructure.persistence) — the Spring
//     Data interface the repository impl `saveAll`s the drained lineage into.
//
// The per-write capture (the `_provTraces` buffer + the co-located
// `<field>Provenance` field + `drainProv()`) is emitted by entity.ts /
// render-stmt.ts; the flush is wired by repository.ts.  The `<field>_provenance`
// column and the history table are ordinary MigrationsIR DDL
// (`withLineageColumns` / `provenanceTableShape` in migrations-builder.ts).
// ---------------------------------------------------------------------------

/** A field carrying the `provenanced` modifier (root field). */
export function provenancedFieldsOf(entity: { fields: FieldIR[] }): FieldIR[] {
  return entity.fields.filter((f) => f.provenanced);
}

/** True iff any aggregate root in the given contexts declares a `provenanced`
 *  field — gates the shared runtime files + repository flush wiring.
 *  Operations (the write sites) live on the root, so a containment carries no
 *  co-located lineage slot — root fields only, matching the .NET emitter. */
export function contextsHaveProvenance(contexts: EnrichedBoundedContextIR[]): boolean {
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      if (provenancedFieldsOf(agg).length > 0) return true;
    }
  }
  return false;
}

/** The shared `ProvLineage` value (domain.common).  Java records → Jackson
 *  round-trips them through Hibernate's JSON FormatMapper with no surface
 *  ceremony, keeping the jsonb column shape identical to the Hono lineage. */
export function renderProvLineage(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** Resolved aggregate type + field name a provenanced write targets. */`,
    `public record ProvTarget(String type, String field) {`,
    `}`,
    ``,
  );
}

/** One leaf input — emitted as its own file (Java's one-public-type rule). */
export function renderProvInput(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** One leaf input feeding a provenanced write — the source-side path and`,
    ` *  the value it held when the write ran.  Value is opaque (Object) so any`,
    ` *  scalar / value object round-trips through Jackson verbatim. */`,
    `public record ProvInput(String path, Object value) {`,
    `}`,
    ``,
  );
}

/** The lineage record itself. */
export function renderProvLineageRecord(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `import java.util.List;`,
    ``,
    `/** The lineage of one provenanced write: the rule snapshot it came from,`,
    ` *  the field it targeted, the inputs that fed it, and the value it`,
    ` *  produced.  Persisted co-located on the row (current) and appended to`,
    ` *  the provenance_records history table (every write). */`,
    `public record ProvLineage(`,
    `    String snapshotId,`,
    `    ProvTarget target,`,
    `    List<ProvInput> inputs,`,
    `    Object computedValue) {`,
    `}`,
    ``,
  );
}

/** The generic wire-carrier record's Java name. */
export const JAVA_PROVENANCED_RECORD = "Provenanced";

/** The DOMAIN-side lineage member beside a provenanced field's value — `total`
 *  → `totalProvenance` (declared by `entity.ts`).  In memory and in storage the
 *  pair stays split; only the wire folds it into `Provenanced<T>`, and the
 *  folding DTO mapper has to name the member the entity named it. */
export function javaProvSibling(fieldName: string): string {
  return `${jid(fieldName)}Provenance`;
}

/** `Provenanced<T>` — the value + lineage wire carrier a `provenanced` field
 *  ships as (M-T6.12).  A generic record so the value keeps its type in both
 *  the Java DTO and the springdoc-published schema; the component NAMES come
 *  from the shared carrier shape, so the JSON keys match every other target's
 *  without a `@JsonProperty` rename. */
export function renderProvenancedCarrier(basePkg: string): string {
  const members = provenancedTypeMembers({ kind: "none" })
    .map((m) => (m.type ? `    T ${m.name}` : `    ProvLineage ${m.name}`))
    .join(",\n");
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** A provenanced field's value together with the lineage of the write that`,
    ` *  produced it — the same { value, lineage } JSON object every other Loom`,
    ` *  backend serves (docs/provenance.md).  Storage keeps the two apart (a`,
    ` *  typed value column plus a jsonb lineage column); only the wire folds`,
    ` *  them.  \`lineage\` is null for a field that has never been written. */`,
    `public record ${JAVA_PROVENANCED_RECORD}<T>(`,
    members + ") {",
    `}`,
    ``,
  );
}

/** The append-only history JPA `@Entity` (infrastructure.persistence).
 *  Mirrors the Hono `provenance_records` Drizzle table / the .NET
 *  `ProvenanceRecord` EF entity column-for-column (governance stamps
 *  included). */
export function renderProvenanceRecordEntity(basePkg: string): string {
  return lines(
    `package ${basePkg}.infrastructure.persistence;`,
    ``,
    `import java.time.Instant;`,
    `import java.util.List;`,
    ``,
    `import org.hibernate.annotations.JdbcTypeCode;`,
    `import org.hibernate.type.SqlTypes;`,
    ``,
    `import jakarta.persistence.Column;`,
    `import jakarta.persistence.Entity;`,
    `import jakarta.persistence.Id;`,
    `import jakarta.persistence.Table;`,
    ``,
    `import ${basePkg}.domain.common.ProvInput;`,
    ``,
    `/** One append-only row per provenanced write, inserted in the same`,
    ` *  transaction as the aggregate save (atomic).  The current lineage is`,
    ` *  also stored co-located on the aggregate row's <field>_provenance jsonb`,
    ` *  column; this table is the full per-write history. */`,
    `@Entity`,
    `@Table(name = "provenance_records")`,
    `public class ProvenanceRecord {`,
    `    @Id`,
    `    @Column(name = "trace_id")`,
    `    String traceId;`,
    ``,
    `    @Column(name = "snapshot_id")`,
    `    String snapshotId;`,
    ``,
    `    @Column(name = "target_type")`,
    `    String targetType;`,
    ``,
    `    @Column(name = "field")`,
    `    String field;`,
    ``,
    `    @JdbcTypeCode(SqlTypes.JSON)`,
    `    @Column(name = "inputs")`,
    `    List<ProvInput> inputs;`,
    ``,
    `    @JdbcTypeCode(SqlTypes.JSON)`,
    `    @Column(name = "computed_value")`,
    `    Object computedValue;`,
    ``,
    `    @Column(name = "at")`,
    `    Instant at;`,
    ``,
    `    @Column(name = "correlation_id")`,
    `    String correlationId;`,
    ``,
    `    @Column(name = "scope_id")`,
    `    String scopeId;`,
    ``,
    `    @Column(name = "actor_id")`,
    `    String actorId;`,
    ``,
    `    @Column(name = "parent_id")`,
    `    String parentId;`,
    ``,
    `    ProvenanceRecord() {`,
    `    }`,
    ``,
    `    public ProvenanceRecord(String traceId, String snapshotId, String targetType, String field,`,
    `            List<ProvInput> inputs, Object computedValue, Instant at, String correlationId,`,
    `            String scopeId, String actorId, String parentId) {`,
    `        this.traceId = traceId;`,
    `        this.snapshotId = snapshotId;`,
    `        this.targetType = targetType;`,
    `        this.field = field;`,
    `        this.inputs = inputs;`,
    `        this.computedValue = computedValue;`,
    `        this.at = at;`,
    `        this.correlationId = correlationId;`,
    `        this.scopeId = scopeId;`,
    `        this.actorId = actorId;`,
    `        this.parentId = parentId;`,
    `    }`,
    `}`,
    ``,
  );
}

/** The Spring Data interface the repository impl drains the lineage into. */
export function renderProvenanceRecordRepository(basePkg: string): string {
  return lines(
    `package ${basePkg}.infrastructure.persistence;`,
    ``,
    `import org.springframework.data.jpa.repository.JpaRepository;`,
    ``,
    `public interface ProvenanceRecordRepository extends JpaRepository<ProvenanceRecord, String> {`,
    `}`,
    ``,
  );
}
