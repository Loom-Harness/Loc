import type { PolymorphicRead } from "../../../ir/enrich/read-scope.js";
import type { PolymorphicReadGate } from "../../../ir/plan/index.js";
import { type EnrichedAggregateIR, exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { plural } from "../../../util/naming.js";
import { routeSegmentFor } from "../../../util/storage-names.js";
import { javaRef } from "../../_imports/java.js";
import { renderJavaExpr } from "../render-expr.js";
import { javaSentence } from "../wire-policy-java.js";
import { javaPagedQueryParams } from "./common.js";
import { javaIdValueType } from "./wire.js";
export interface JavaBaseReadCtx {
  basePkg: string;
  pkg: string;
  routePrefix?: string;
  /** The package each named artifact of an aggregate lands in. */
  entityPkg: (agg: string) => string;
  responsePkg: (agg: string) => string;
  repositoryPkg: (agg: string) => string;
  /** Every concrete's list-read gate, checked before the load. */
  gates?: readonly PolymorphicReadGate[];
  /** The concretes whose rows serialize through their masked mapper. */
  masked?: ReadonlySet<string>;
}

const JSON_MAPPER = javaRef("tools.jackson.databind.json", "JsonMapper");
const OBJECT_NODE = javaRef("tools.jackson.databind.node", "ObjectNode");
const ENTITY_MANAGER = javaRef("jakarta.persistence", "EntityManager");
const PERSISTENCE_CONTEXT = javaRef("jakarta.persistence", "PersistenceContext");

export function renderJavaBaseReadController(
  base: EnrichedAggregateIR,
  read: PolymorphicRead,
  ctx: JavaBaseReadCtx,
): string {
  const tph = read.layout === "sharedTable";
  const cls = `${plural(base.name)}Controller`;
  const route = `${ctx.routePrefix ?? ""}/${routeSegmentFor(base.name)}`;
  const paged = javaRef(`${ctx.basePkg}.domain.common`, "Paged");
  const notFound = javaRef(`${ctx.basePkg}.domain.common`, "AggregateNotFoundException");
  const [pageParam, pageSizeParam] = javaPagedQueryParams();
  const baseEntity = javaRef(ctx.entityPkg(base.name), base.name);
  const gates = ctx.gates ?? [];
  const masked = ctx.masked ?? new Set<string>();
  const forbidden = javaRef(`${ctx.basePkg}.domain.common`, "ForbiddenException");
  const accessorType = javaRef(`${ctx.basePkg}.auth`, "CurrentUserAccessor");
  const usesUser = gates.some((g) => exprUsesCurrentUser(g.find.requires));
  // Every concrete's list-read gate, before the load: a caller failing any of
  // them gets that concrete's own pre-load 403.
  const gateLines: string[] = [
    ...(usesUser ? [`        var currentUser = currentUserAccessor.user();`] : []),
    ...gates.map(
      (g) =>
        `        if (!(${renderJavaExpr(g.find.requires, { thisName: "this" })})) throw new ${forbidden}(${JSON.stringify(`Forbidden: find ${g.find.name}`)});`,
    ),
  ];
  const accessorField = usesUser ? [`    private final ${accessorType} currentUserAccessor;`] : [];
  const accessorParam = usesUser ? [`${accessorType} currentUserAccessor`] : [];
  const accessorAssign = usesUser
    ? [`        this.currentUserAccessor = currentUserAccessor;`]
    : [];
  const variantArms = read.variants.map((v) => {
    const entity = javaRef(ctx.entityPkg(v.aggregate), v.aggregate);
    const response = javaRef(ctx.responsePkg(v.aggregate), `${v.aggregate}Response`);
    const from = masked.has(v.aggregate) ? "fromMasked" : "from";
    return { v, entity, response, from };
  });
  const tagged = (subject: string): string[] => [
    ...variantArms.map(
      ({ v, entity, response, from }) =>
        `        if (${subject} instanceof ${entity} __row) return tag(${JSON.stringify(v.tag)}, ${response}.${from}(__row));`,
    ),
    `        throw new IllegalStateException("unmapped ${base.name} subtype " + ${subject}.getClass().getName());`,
  ];
  const idType = javaIdValueType();
  const idClass = javaRef(`${ctx.basePkg}.domain.ids`, `${base.name}Id`);
  const tphBody = [
    `    @${PERSISTENCE_CONTEXT}`,
    `    private ${ENTITY_MANAGER} em;`,
    `    private final ${JSON_MAPPER} json;`,
    ...accessorField,
    ``,
    `    public ${cls}(${[`${JSON_MAPPER} json`, ...accessorParam].join(", ")}) {`,
    `        this.json = json;`,
    ...accessorAssign,
    `    }`,
    ``,
    `    @GetMapping`,
    `    @Transactional(readOnly = true)`,
    `    public ${paged}<${OBJECT_NODE}> all${base.name}(${pageParam}, ${pageSizeParam}) {`,
    ...gateLines,
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
    ...gateLines,
    `        var key = new ${idClass}(id);`,
    `        return em.createQuery("select e from ${base.name} e where e.id = :id", ${baseEntity}.class)`,
    `            .setParameter("id", key)`,
    `            .getResultStream()`,
    `            .findFirst()`,
    `            .map(this::tagged)`,
    `            .orElseThrow(() -> new ${notFound}(${javaSentence("not-found", `"${base.name} " + key`)}));`,
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
    ...accessorField,
    ``,
    `    public ${cls}(${[...repos.map((r) => `${r.type} ${r.field}`), `${JSON_MAPPER} json`, ...accessorParam].join(", ")}) {`,
    ...repos.map((r) => `        this.${r.field} = ${r.field};`),
    `        this.json = json;`,
    ...accessorAssign,
    `    }`,
    ``,
    `    @GetMapping`,
    `    @Transactional(readOnly = true)`,
    `    public ${paged}<${OBJECT_NODE}> all${base.name}(${pageParam}, ${pageSizeParam}) {`,
    ...gateLines,
    `        var merged = new java.util.ArrayList<java.util.Map.Entry<String, ${OBJECT_NODE}>>();`,
    ...repos.map(
      (r) =>
        `        for (var __row : ${r.field}.findAll()) merged.add(java.util.Map.entry(String.valueOf(__row.id().value()), tag(${JSON.stringify(r.arm.v.tag)}, ${r.arm.response}.${r.arm.from}(__row))));`,
    ),
    // Postgres orders a uuid by its bytes, unsigned — which is the order of
    // its canonical lowercase hex text, not `UUID.compareTo` (signed).
    `        merged.sort(java.util.Map.Entry.comparingByKey(${idComparator()}));`,
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

/** The `String` key comparator matching Postgres' `ORDER BY id` over a
 *  uuid key: text order. */
function idComparator(): string {
  return "java.util.Comparator.naturalOrder()";
}
