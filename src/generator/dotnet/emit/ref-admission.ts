// Write-time reference admission on the .NET repository save
// (docs/tenancy.md → "Reference admission"; the decision lives in
// `src/ir/plan/ref-scope.ts`).
//
// Before the row is written, every reference the plan marks `row-tenant` is
// probed against its target under the target's read scope (the query
// filters / scope SQL its reads carry), so the probe and
// the target's reads agree on the caller's operating tenant.  A reference that
// does not resolve throws the Npgsql `foreign_key_violation` the database
// itself raises for a reference to a missing row, so the app-wide exception
// filter answers both identically (the dangling-reference refusal): a foreign
// tenant's row is indistinguishable from a missing one, on every route that
// saves — aggregate, workflow, handler.  The bare `PostgresException` is the
// arm both adapters read (EF's `DbUpdateException` wrapper is only the
// database-raised form).

import { admittedReferences, type ScopedReference } from "../../../ir/plan/ref-scope.js";
import type { AggregateIR } from "../../../ir/types/loom-ir.js";
import { type AggPool, isTphConcrete, rootBaseOf } from "../../../ir/util/inheritance.js";
import { upperFirst } from "../../../util/naming.js";
import { PG_FOREIGN_KEY_VIOLATION } from "../../_persistence/pg-sqlstate.js";
import { efReadSource } from "../ef-read-source.js";

/** The refusal a probe miss throws: Postgres' `foreign_key_violation`. */
const REFUSAL = `throw new Npgsql.PostgresException("The request references a record that does not exist.", "ERROR", "ERROR", ${JSON.stringify(PG_FOREIGN_KEY_VIOLATION)});`;

/** The EF Core probe lines at the head of `SaveAsync` (8-space indent).  The
 *  probe reads the target's own `DbSet`, so its named query filters — the
 *  `tenantOwned` floor and any row rules — decide which rows the
 *  caller can see, exactly as every read of that target does.  Empty when the
 *  aggregate admits no reference. */
export function efRefAdmissionLines(agg: AggregateIR, pool: AggPool): string[] {
  const out: string[] = [];
  admittedReferences(agg, pool).forEach((r, i) => {
    out.push(...collectLines(r, i));
    const target = pool.find((a) => a.name === r.target)!;
    const keyId = `${isTphConcrete(target, pool) ? rootBaseOf(target, pool).name : target.name}Id`;
    out.push(
      `        if (__admit${i}.Count > 0)`,
      "        {",
      `            var __admit${i}Keys = __admit${i}.Select(__g => new ${keyId}(__g)).ToList();`,
      `            var __admit${i}Found = await _db.${efReadSource(target, pool)}.CountAsync(x => __admit${i}Keys.Contains(x.Id), cancellationToken);`,
      `            if (__admit${i}Found != __admit${i}.Count) ${REFUSAL}`,
      "        }",
    );
  });
  return out;
}

/** How a Dapper probe reads one target: the C# expression of its count
 *  statement (spliced with the target's `<Target>Scope`, so the probe carries
 *  the restrictions its reads do) and the principal parameter bindings that
 *  scope reads. */
export interface DapperProbe {
  sqlExpr: string;
  /** `name = value` fields of the parameter object. */
  fields: string[];
}

/** The Dapper probe lines inside `SaveAsync`, after the transaction opens
 *  (`conn` and `__tx` in scope; 8-space indent).  Empty when the aggregate
 *  admits no reference. */
export function dapperRefAdmissionLines(
  agg: AggregateIR,
  pool: AggPool,
  probeOf: (ref: ScopedReference, target: AggregateIR) => DapperProbe,
): string[] {
  const out: string[] = [];
  admittedReferences(agg, pool).forEach((r, i) => {
    out.push(...collectLines(r, i));
    const p = probeOf(r, pool.find((a) => a.name === r.target)!);
    out.push(
      `        if (__admit${i}.Count > 0)`,
      "        {",
      `            var __admit${i}Found = await conn.ExecuteScalarAsync<long>(new CommandDefinition(${p.sqlExpr}, new { ids = __admit${i}.ToArray()${p.fields.map((f) => `, ${f}`).join("")} }, transaction: __tx, cancellationToken: cancellationToken));`,
      `            if (__admit${i}Found != __admit${i}.Count) ${REFUSAL}`,
      "        }",
    );
  });
  return out;
}

/** `var __admitN = new HashSet<Guid>();` plus the adds for every value the row
 *  holds in the reference field (absent ones skipped, duplicates collapsed). */
function collectLines(r: ScopedReference, i: number): string[] {
  const set = `__admit${i}`;
  const out = [`        var ${set} = new HashSet<Guid>();`, "        {"];
  let indent = "            ";
  let owner = "aggregate";
  r.via.forEach((step, depth) => {
    const member = `${owner}.${upperFirst(step.contain)}`;
    const v = `__o${depth}`;
    out.push(
      step.collection
        ? `${indent}foreach (var ${v} in ${member})`
        : `${indent}if (${member} is { } ${v})`,
    );
    out.push(`${indent}{`);
    indent += "    ";
    owner = v;
  });
  const field = `${owner}.${upperFirst(r.field)}`;
  if (r.collection) {
    out.push(`${indent}foreach (var __r in ${field}) ${set}.Add(__r.Value);`);
  } else if (r.optional) {
    out.push(`${indent}if (${field} is { } __r) ${set}.Add(__r.Value);`);
  } else {
    out.push(`${indent}${set}.Add(${field}.Value);`);
  }
  for (let d = 0; d < r.via.length; d++) {
    indent = indent.slice(4);
    out.push(`${indent}}`);
  }
  out.push("        }");
  return out;
}
