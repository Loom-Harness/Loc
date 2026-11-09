import type { AssociationIR, FieldIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { valueCollectionsFor } from "../../../ir/util/value-collections.js";
import { snake } from "../../../util/naming.js";
import { javaOnDemandRef, javaRef } from "../../_imports/java.js";
import { jid } from "../java-ident.js";
import { hbIdent } from "../sql-ident.js";

const JPA = (name: string): string => javaOnDemandRef("jakarta.persistence", name);
const JDBC_TYPE_CODE = javaRef("org.hibernate.annotations", "JdbcTypeCode");
const SQL_TYPES = javaRef("org.hibernate.type", "SqlTypes");

// ---------------------------------------------------------------------------
// JPA annotation lines for the generated domain classes.  The mapping is
// the mirror image of `schemaFromModule` (src/system/migrations-builder.ts)
// — table names `plural(snake(name))`, snake_case columns, flattened
// value-object columns `<field>_<vofield>`, join tables from
// `AssociationIR`, value-collection child tables from `ValueCollectionIR`.
// DDL is owned by the Flyway migrations (ddl-auto: none); these
// annotations only bind the ORM to that schema, so every name is
// explicit rather than relying on a naming strategy.
//
// Typed ids ride JPA embeddables: `@EmbeddedId` / `@Embedded` +
// `@AttributeOverride(name = "value", …)` (Hibernate 6.2+ instantiates
// records natively; converters are off the table because JPA's
// autoApply skips @Id attributes).
// ---------------------------------------------------------------------------

export interface JpaOpts {
  /** Postgres schema the aggregate's tables live in (binding-resolved);
   *  undefined when no binding sets one → unqualified. */
  schema?: string;
  /** VO name → field list, for flattening attribute overrides. */
  voLookup: ReadonlyMap<string, readonly FieldIR[]>;
  /** `shape: embedded`: reference collections (and containments — see
   *  the entity emitter) fold into jsonb columns instead of join /
   *  part tables (the EF owned-types `.ToJson()` analog). */
  embedded?: boolean;
  /** A projection / workflow STATE row (one table row, no join or child
   *  tables): a reference collection is one jsonb id-array column, exactly as
   *  under `shape: embedded` (the shared migration's `JSONB` column). */
  stateRow?: boolean;
  /** M-T6.36 — enums with at least one Java-reserved-word VALUE, whose java
   *  constants are therefore mangled.  Their columns map through the generated
   *  `<Enum>.Codec` `AttributeConverter` instead of `@Enumerated(STRING)`, so
   *  the stored value keeps the `.ddd` spelling.  Absent/empty ⇒ every enum
   *  column stays `@Enumerated`, byte-identical. */
  mangledEnums?: ReadonlySet<string>;
}

const schemaAttr = (schema: string | undefined): string => (schema ? `, schema = "${schema}"` : "");

export function jpaClassAnnotations(tableName: string, opts: JpaOpts): string[] {
  return [
    `@${JPA("Entity")}`,
    `@${JPA("Table")}(name = "${hbIdent(tableName)}"${schemaAttr(opts.schema)})`,
  ];
}

/** `@EmbeddedId` mapping the id record's `value` onto the `id` column. */
export function jpaIdAnnotations(): string[] {
  return [
    `    @${JPA("EmbeddedId")}`,
    `    @${JPA("AttributeOverride")}(name = "value", column = @${JPA("Column")}(name = "id"))`,
  ];
}

/** A part's parentId mirrors the FK column the containment association
 *  owns — read-only so the two mappings don't fight over writes. */
export function jpaParentIdAnnotations(parentFkColumn: string): string[] {
  return [
    `    @${JPA("Embedded")}`,
    `    @${JPA("AttributeOverride")}(name = "value", column = @${JPA("Column")}(name = "${parentFkColumn}", insertable = false, updatable = false))`,
  ];
}

/** Containment collection — unidirectional one-to-many owning the part
 *  table's parent-FK column (`<snake(owner)>_id`).  `nullable = false`
 *  is load-bearing: it makes Hibernate write the FK in the child INSERT
 *  instead of the insert-then-update dance, which the Flyway DDL's
 *  NOT NULL constraint would reject. */
export function jpaContainmentAnnotations(ownerName: string): string[] {
  return [
    `    @${JPA("OneToMany")}(cascade = ${JPA("CascadeType")}.ALL, orphanRemoval = true, fetch = ${JPA("FetchType")}.EAGER)`,
    `    @${JPA("JoinColumn")}(name = "${snake(ownerName)}_id", nullable = false)`,
  ];
}

/** Single containment, parent side — JPA has no unidirectional
 *  one-to-one with the FK on the part table, so the part carries a
 *  hidden owning `_parent` relation and the root maps the inverse. */
export function jpaSingleContainmentAnnotations(): string[] {
  return [
    `    @${JPA("OneToOne")}(mappedBy = "_parent", cascade = ${JPA("CascadeType")}.ALL, orphanRemoval = true, fetch = ${JPA("FetchType")}.EAGER)`,
  ];
}

/** Single containment, part side — the hidden owning relation writing
 *  the parent-FK column (the part's read-only `parentId` mirrors it). */
export function jpaSingleContainmentParentAnnotations(parentFkColumn: string): string[] {
  return [
    `    @${JPA("OneToOne")}(fetch = ${JPA("FetchType")}.LAZY)`,
    `    @${JPA("JoinColumn")}(name = "${parentFkColumn}", nullable = false)`,
  ];
}

/** Recursively flatten a value object into attribute overrides:
 *  property path `city` / `inner.zip` → column `<prefix>_city` /
 *  `<prefix>_inner_zip` (matching `flattenValueObject` in the
 *  migrations builder). */
function voOverrides(
  pathPrefix: string,
  columnPrefix: string,
  voName: string,
  voLookup: JpaOpts["voLookup"],
): string[] {
  const fields = voLookup.get(voName) ?? [];
  return fields.flatMap((vf) => {
    const path = pathPrefix ? `${pathPrefix}.${jid(vf.name)}` : jid(vf.name);
    const column = `${columnPrefix}_${snake(vf.name)}`;
    const base = vf.type.kind === "optional" ? vf.type.inner : vf.type;
    if (base.kind === "valueobject") {
      return voOverrides(path, column, base.name, voLookup);
    }
    return [
      `    @${JPA("AttributeOverride")}(name = "${idLeafPath(path, base)}", column = @${JPA("Column")}(name = "${column}"))`,
    ];
  });
}

/** Top-level (unprefixed) overrides for a value-collection's element —
 *  the child table's columns are the VO's bare flattened names. */
function voElementOverrides(voName: string, voLookup: JpaOpts["voLookup"]): string[] {
  const fields = voLookup.get(voName) ?? [];
  return fields.flatMap((vf) => {
    const base = vf.type.kind === "optional" ? vf.type.inner : vf.type;
    if (base.kind === "valueobject") {
      return voOverrides(jid(vf.name), snake(vf.name), base.name, voLookup);
    }
    return [
      `    @${JPA("AttributeOverride")}(name = "${idLeafPath(jid(vf.name), base)}", column = @${JPA("Column")}(name = "${hbIdent(snake(vf.name))}"))`,
    ];
  });
}

/** The override path of a VO sub-field's COLUMN.  An `X id` sub-field is itself
 *  an `@Embeddable` record whose one component is `value`, so the column lives
 *  one level down: overriding `ship` left Hibernate selecting the id record's
 *  own default `value` column, which no migration created (`column d1_0.value
 *  does not exist` on the first request, wave C3 D4). */
function idLeafPath(path: string, t: TypeIR): string {
  return t.kind === "id" ? `${path}.value` : path;
}

function unwrap(t: TypeIR): TypeIR {
  return t.kind === "optional" ? t.inner : t;
}

/** What `jpaFieldAnnotations` reads off the field's owner: its name (for the
 *  value-collection table and error text), its fields (value collections) and,
 *  on an aggregate, its reference-collection associations. */
export interface JpaFieldOwner {
  name: string;
  fields: readonly FieldIR[];
  associations?: readonly AssociationIR[];
}

/** Annotation lines for one stored field.  `owner` resolves reference
 *  collections (associations) and value collections by field name. */
export function jpaFieldAnnotations(f: FieldIR, owner: JpaFieldOwner, opts: JpaOpts): string[] {
  const t = unwrap(f.type);
  const col = snake(f.name);

  // The `versioned` counter is written by the repository's guarded
  // `where version = :expected` bump alone.  Were it an ordinary updatable
  // column, the entity flush that precedes the bump would re-write the HANDLE's
  // (possibly stale) value, undoing a concurrent writer's bump — and the
  // second writer's own bump would then match, so both writers land.
  if (f.access === "token") {
    return [`    @${JPA("Column")}(name = "${hbIdent(col)}", updatable = false)`];
  }

  // Reference collection (`Target id[]`) → the association's join table
  // (relational), or a jsonb id-array column under `shape: embedded`.
  if (t.kind === "array" && t.element.kind === "id") {
    if (opts.embedded || opts.stateRow) {
      // The `List<TargetId>` can't ride `@JdbcTypeCode(JSON)` alone — the
      // @Embeddable id triggers Hibernate's structured-JSON aggregate path,
      // which bypasses the FormatMapper.  A per-target `AttributeConverter`
      // (emitted in domain.ids) unwraps the list to bare `value`s so the
      // FormatMapper serialises `["v1","v2"]` — the cross-backend jsonb shape.
      return [
        `    @${JPA("Convert")}(converter = ${t.element.targetName}IdJsonListConverter.class)`,
        `    @${JDBC_TYPE_CODE}(${SQL_TYPES}.JSON)`,
        `    @${JPA("Column")}(name = "${hbIdent(col)}"${f.optional ? "" : ", nullable = false"})`,
      ];
    }
    // `Target id[]` is contractually a set (membership only, no order), so
    // the join table carries no `ordinal` column — the composite (owner,
    // target) PK is the whole row.  Deterministic read-back order is a
    // read-time projection: `@OrderBy` (no argument) sorts by the element
    // value, i.e. the target FK id — matching every other backend.
    // `loom.collection-field-unpersisted` refuses every `X id[]` that is not an
    // aggregate root's own non-optional field, and enrichment derives one
    // association per such field.
    const assoc = associationFor(owner, f.name);
    if (!assoc) {
      throw new Error(
        `java jpa: no AssociationIR for reference collection '${owner.name}.${f.name}' — enrichment derives one per aggregate-level Id[] field.`,
      );
    }
    return [
      `    @${JPA("ElementCollection")}(fetch = ${JPA("FetchType")}.EAGER)`,
      `    @${JPA("CollectionTable")}(name = "${assoc.joinTable}"${schemaAttr(opts.schema)}, joinColumns = @${JPA("JoinColumn")}(name = "${assoc.ownerFk}"))`,
      `    @${JPA("OrderBy")}`,
      `    @${JPA("AttributeOverride")}(name = "value", column = @${JPA("Column")}(name = "${assoc.targetFk}"))`,
    ];
  }

  // Value-object array (`charges: Money[]`) → the id-less child table.
  if (t.kind === "array" && t.element.kind === "valueobject") {
    const vc = valueCollectionsFor(owner).find((v) => v.fieldName === f.name);
    if (!vc) {
      throw new Error(`java jpa: no ValueCollectionIR for '${owner.name}.${f.name}'.`);
    }
    return [
      `    @${JPA("ElementCollection")}(fetch = ${JPA("FetchType")}.EAGER)`,
      `    @${JPA("CollectionTable")}(name = "${vc.childTable}"${schemaAttr(opts.schema)}, joinColumns = @${JPA("JoinColumn")}(name = "${vc.parentFk}"))`,
      `    @${JPA("OrderColumn")}(name = "ordinal")`,
      ...voElementOverrides(t.element.name, opts.voLookup),
    ];
  }

  // Primitive / enum array → a native Postgres array column.
  // An ENUM element is stored by NAME in the `text[]` column, exactly like the
  // scalar enum arm below: without `@Enumerated(STRING)` Hibernate wrote
  // ORDINALS and could not read them back (`No enum constant …Skill.2`, wave
  // C3 D3).  A reserved-word enum's codec is a scalar `AttributeConverter` that
  // cannot convert a list, so that crossing keeps the plain array mapping.
  if (t.kind === "array") {
    const byName =
      t.element.kind === "enum" && !opts.mangledEnums?.has(t.element.name)
        ? [`    @${JPA("Enumerated")}(${JPA("EnumType")}.STRING)`]
        : [];
    return [
      ...byName,
      `    @${JDBC_TYPE_CODE}(${SQL_TYPES}.ARRAY)`,
      `    @${JPA("Column")}(name = "${hbIdent(col)}")`,
    ];
  }

  // `X id` reference → embedded id record over one column.
  if (t.kind === "id") {
    return [
      `    @${JPA("Embedded")}`,
      `    @${JPA("AttributeOverride")}(name = "value", column = @${JPA("Column")}(name = "${hbIdent(col)}"))`,
    ];
  }

  // Value object → embedded record over flattened `<field>_<vf>` columns.
  if (t.kind === "valueobject") {
    return [`    @${JPA("Embedded")}`, ...voOverrides("", col, t.name, opts.voLookup)];
  }

  if (t.kind === "enum") {
    // `@Enumerated(STRING)` writes `Enum.name()`, which is the MANGLED constant
    // when a `.ddd` value is a Java reserved word — so those enums persist
    // through their generated codec instead (M-T6.36).
    if (opts.mangledEnums?.has(t.name)) {
      return [
        `    @${JPA("Convert")}(converter = ${t.name}.Codec.class)`,
        `    @${JPA("Column")}(name = "${hbIdent(col)}")`,
      ];
    }
    return [
      `    @${JPA("Enumerated")}(${JPA("EnumType")}.STRING)`,
      `    @${JPA("Column")}(name = "${hbIdent(col)}")`,
    ];
  }

  if (t.kind === "primitive" && (t.name === "json" || t.name === "File")) {
    // A `File` field's FileRef persists as jsonb, exactly like `json` (M-T1.2);
    // Hibernate maps the `FileRef` record ⇄ JSON via @JdbcTypeCode.
    return [
      `    @${JDBC_TYPE_CODE}(${SQL_TYPES}.JSON)`,
      `    @${JPA("Column")}(name = "${hbIdent(col)}")`,
    ];
  }

  // Scalars (string / int / long / decimal / money / bool / datetime / guid).
  return [`    @${JPA("Column")}(name = "${hbIdent(col)}")`];
}

function associationFor(owner: JpaFieldOwner, fieldName: string): AssociationIR | undefined {
  return owner.associations?.find((a) => a.fieldName === fieldName);
}
