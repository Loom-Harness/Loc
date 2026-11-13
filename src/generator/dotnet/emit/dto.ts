import { plural } from "../../../util/naming.js";
import { csUsing } from "../../_imports/dotnet.js";
import { csSchemaRequiredAttr, noNulCharUsing } from "../dto-mapping.js";

// Request + response DTO records.  Both are flat record-types in the
// `Application.<Aggregates>.Requests` / `.Responses` namespaces.
// Params are rendered upstream — we just splice them into the record
// header.

export function renderRequestDtos(args: {
  ns: string;
  aggName: string;
  /** `decl`, when present, is the whole type declaration (a merge-patch
   *  request class) and replaces the positional record. */
  records: Array<{ name: string; params: string; decl?: string }>;
  /** Extra `using` namespaces — e.g. `Domain.Common` when a request carries a
   *  `File` field's `FileRef` create-input param (M-T1.2). */
  extraUsings?: string[];
}): string {
  return renderDtoFile(args, "Requests");
}

export function renderResponseDtos(args: {
  ns: string;
  aggName: string;
  records: Array<{ name: string; params: string }>;
  /** Extra `using` namespaces — e.g. `Domain.Common` when a response carries a
   *  provenanced field's `ProvLineage?` lineage param (provenance.md). */
  extraUsings?: string[];
}): string {
  return renderDtoFile(args, "Responses");
}

function renderDtoFile(
  args: {
    ns: string;
    aggName: string;
    records: Array<{ name: string; params: string; decl?: string }>;
    extraUsings?: string[];
  },
  group: "Requests" | "Responses",
): string {
  const recs = args.records
    .map(
      (r) =>
        `${r.decl ?? `${group === "Requests" ? csSchemaRequiredAttr(r.params) : ""}public sealed record ${r.name}(${r.params});`}\n\n`,
    )
    .join("");
  const extra = (args.extraUsings ?? []).map((u) => `using ${u};\n`).join("");
  // `using …Domain.Enums` lets a DTO field carry the enum TYPE (paired
  // with a global JsonStringEnumConverter for string-on-the-wire) so
  // Swashbuckle emits a named enum schema.  The `Domain/Enums/_namespace.cs`
  // marker guarantees the namespace always resolves, even with no enums.
  return `// Auto-generated.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
${csUsing("System.Text.Json.Serialization")}
using ${args.ns}.Domain.Enums;
${noNulCharUsing(args.ns, ...args.records.map((r) => r.params))}
${extra}
namespace ${args.ns}.Application.${plural(args.aggName)}.${group};

${recs}`;
}
