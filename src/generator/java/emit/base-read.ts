// ---------------------------------------------------------------------------
// Java polymorphic base read — `GET /api/<bases>` (paged) and, under TPH,
// `GET /api/<bases>/{id}`: every row as its real subtype, tagged with the
// concrete's name as the wire `type`, one global `id` order, paged globally
// (the `polymorphicReadFor` fact, src/ir/enrich/read-scope.ts).
//
//   - TPH (`sharedTable`): ONE JPQL query over the root entity.  Every
//     restriction of the hierarchy is hosted on the root, kind-guarded
//     (capability-filter.ts `restrictionHostFor`), so `from <Base>` applies
//     the base's restrictions and each row's own subtype's — and never a
//     sibling's.  Hibernate hydrates each row as its `@DiscriminatorValue`
//     subclass.  By id is a query too, so a row the session already holds is
//     re-checked in SQL.
//   - TPC (`ownTable`): the base is a `@MappedSuperclass`, which JPQL cannot
//     select from.  Each concrete's own scoped `findAll()` is read and the rows
//     merged in `id` order, then paged.
//
// Each tagged item is the concrete's own GET-by-id body plus `type`, built
// through the application's `JsonMapper` so the body carries exactly the
// codecs that body carries on the concrete's own route.
// ---------------------------------------------------------------------------

import { type PolymorphicRead, polymorphicReadFor } from "../../../ir/enrich/read-scope.js";
import type { EnrichedAggregateIR, EnrichedBoundedContextIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { plural, snake } from "../../../util/naming.js";
import { javaRef } from "../../_imports/java.js";
import { javaPagedQueryParams } from "./common.js";
import { javaIdValueType } from "./wire.js";

/** The polymorphic read of `base` when java routes it, else undefined.
 *
 *  The route answers every subtype's rows, so it exists only where each
 *  subtype's own list read is open to the same caller: a concrete whose `all`
 *  carries a `requires` gate, or whose wire masks a field, would have that
 *  gate or mask bypassed by the base route.  Tenancy needs no gate: its
 *  restriction is a filter on the root entity (TPH) or on each concrete's
 *  (TPC), so the base read applies it like every other read. */
export function routedJavaPolymorphicRead(
  base: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
): PolymorphicRead | undefined {
  const read = polymorphicReadFor(base, ctx.aggregates);
  if (!read) return undefined;
  const open = read.variants.every((v) => {
    const concrete = ctx.aggregates.find((a) => a.name === v.aggregate);
    const all = ctx.repositories
      .find((r) => r.aggregateName === v.aggregate)
      ?.finds.find((f) => f.name === "all");
    return !!concrete && !!all && !all.requires && !concrete.fields.some((f) => f.maskUnless);
  });
  return open ? read : undefined;
}

export interface JavaBaseReadCtx {
  basePkg: string;
  pkg: string;
  routePrefix?: string;
  /** The package each named artifact of an aggregate lands in. */
  entityPkg: (agg: string) => string;
  responsePkg: (agg: string) => string;
  repositoryPkg: (agg: string) => string;
}

const JSON_MAPPER = javaRef("tools.jackson.databind.json", "JsonMapper");
const OBJECT_NODE = javaRef("tools.jackson.databind.node", "ObjectNode");
const ENTITY_MANAGER = javaRef("jakarta.persistence", "EntityManager");
const PERSISTENCE_CONTEXT = javaRef("jakarta.persistence", "PersistenceContext");

export function renderJavaBaseReadController(
  base: EnrichedAggregateIR,
  read: PolymorphicRead,
  idValueType: string,
  ctx: JavaBaseReadCtx,
): string {
  const tph = read.layout === "sharedTable";
  const cls = `${plural(base.name)}Controller`;
  const route = `${ctx.routePrefix ?? ""}/${snake(plural(base.name))}`;
  const paged = javaRef(`${ctx.basePkg}.domain.common`, "Paged");
  const notFound = javaRef(`${ctx.basePkg}.domain.common`, "AggregateNotFoundException");
  const [pageParam, pageSizeParam] = javaPagedQueryParams();
  const baseEntity = javaRef(ctx.entityPkg(base.name), base.name);
  const variantArms = read.variants.map((v) => {
    const entity = javaRef(ctx.entityPkg(v.aggregate), v.aggregate);
    const response = javaRef(ctx.responsePkg(v.aggregate), `${v.aggregate}Response`);
    return { v, entity, response };
  });
  const tagged = (subject: string): string[] => [
    ...variantArms.map(
      ({ v, entity, response }) =>
        `        if (${subject} instanceof ${entity} __row) return tag(${JSON.stringify(v.tag)}, ${response}.from(__row));`,
    ),
    `        throw new IllegalStateException("unmapped ${base.name} subtype " + ${subject}.getClass().getName());`,
  ];
  const idType = javaIdValueType(idValueType);
  const idClass = javaRef(`${ctx.basePkg}.domain.ids`, `${base.name}Id`);
  const tphBody = [
    `    @${PERSISTENCE_CONTEXT}`,
    `    private ${ENTITY_MANAGER} em;`,
    `    private final ${JSON_MAPPER} json;`,
    ``,
    `    public ${cls}(${JSON_MAPPER} json) {`,
    `        this.json = json;`,
    `    }`,
    ``,
    `    @GetMapping`,
    `    @Transactional(readOnly = true)`,
    `    public ${paged}<${OBJECT_NODE}> all${base.name}(${pageParam}, ${pageSizeParam}) {`,
    `        long total = em.createQuery("select count(e) from ${base.name} e", Long.class).getSingleResult();`,
    `        var rows = em.createQuery("select e from ${base.name} e order by e.id", ${baseEntity}.class)`,
    `            .setFirstResult((page - 1) * pageSize)`,
    `            .setMaxResults(pageSize)`,
    `            .getResultList();`,
    `        var items = rows.stream().map(this::tagged).toList();`,
    `        return new ${paged}<>(items, page, pageSize, Math.toIntExact(total), Math.toIntExact((total + pageSize - 1) / pageSize));`,
    `    }`,
    ``,
    `    @GetMapping("/{id}")`,
    `    @Transactional(readOnly = true)`,
    `    public ${OBJECT_NODE} get${base.name}ById(@PathVariable ${idType} id) {`,
    `        var key = new ${idClass}(id);`,
    `        return em.createQuery("select e from ${base.name} e where e.id = :id", ${baseEntity}.class)`,
    `            .setParameter("id", key)`,
    `            .getResultStream()`,
    `            .findFirst()`,
    `            .map(this::tagged)`,
    `            .orElseThrow(() -> new ${notFound}("${base.name} " + key + " not found"));`,
    `    }`,
    ``,
    `    private ${OBJECT_NODE} tagged(${baseEntity} row) {`,
    ...tagged("row"),
    `    }`,
  ];
  const repoField = (agg: string): string => `${agg.charAt(0).toLowerCase()}${agg.slice(1)}s`;
  const repos = read.variants.map((v) => ({
    field: repoField(v.aggregate),
    type: javaRef(ctx.repositoryPkg(v.aggregate), `${v.aggregate}Repository`),
    arm: variantArms.find((a) => a.v === v)!,
  }));
  const tpcBody = [
    ...repos.map((r) => `    private final ${r.type} ${r.field};`),
    `    private final ${JSON_MAPPER} json;`,
    ``,
    `    public ${cls}(${[...repos.map((r) => `${r.type} ${r.field}`), `${JSON_MAPPER} json`].join(", ")}) {`,
    ...repos.map((r) => `        this.${r.field} = ${r.field};`),
    `        this.json = json;`,
    `    }`,
    ``,
    `    @GetMapping`,
    `    @Transactional(readOnly = true)`,
    `    public ${paged}<${OBJECT_NODE}> all${base.name}(${pageParam}, ${pageSizeParam}) {`,
    `        var merged = new java.util.ArrayList<java.util.Map.Entry<String, ${OBJECT_NODE}>>();`,
    ...repos.map(
      (r) =>
        `        for (var __row : ${r.field}.findAll()) merged.add(java.util.Map.entry(String.valueOf(__row.id().value()), tag(${JSON.stringify(r.arm.v.tag)}, ${r.arm.response}.from(__row))));`,
    ),
    // Postgres orders a uuid by its bytes, unsigned — which is the order of
    // its canonical lowercase hex text, not `UUID.compareTo` (signed).
    `        merged.sort(java.util.Map.Entry.comparingByKey(${idComparator(idValueType)}));`,
    `        int total = merged.size();`,
    `        var items = merged.stream().skip((long) (page - 1) * pageSize).limit(pageSize).map(java.util.Map.Entry::getValue).toList();`,
    `        return new ${paged}<>(items, page, pageSize, total, (total + pageSize - 1) / pageSize);`,
    `    }`,
  ];
  return lines(
    `package ${ctx.pkg};`,
    ``,
    `import org.springframework.transaction.annotation.Transactional;`,
    `import org.springframework.web.bind.annotation.*;`,
    ``,
    `/** Polymorphic ${base.name} read: every row as its own subtype, tagged by \`type\`. */`,
    `@RestController`,
    `@RequestMapping("${route}")`,
    `public class ${cls} {`,
    ...(tph ? tphBody : tpcBody),
    ``,
    `    private ${OBJECT_NODE} tag(String type, Object body) {`,
    `        ${OBJECT_NODE} node = json.valueToTree(body);`,
    `        node.put("type", type);`,
    `        return node;`,
    `    }`,
    `}`,
    ``,
  );
}

/** The `String` key comparator matching Postgres' `ORDER BY id` for the id's
 *  value type: text order for uuid / string ids, numeric for int / long. */
function idComparator(idValueType: string): string {
  return idValueType === "int" || idValueType === "long"
    ? "java.util.Comparator.comparingLong(Long::parseLong)"
    : "java.util.Comparator.naturalOrder()";
}
