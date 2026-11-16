// The record a page loads, read off an entity's response: its stored fields
// and the parts it contains.  Shared by both walker-model adapters, so the
// enriched and the contract-built model describe the same record.

import type { TypeIR } from "../../ir/types/loom-ir.js";
import type { ContractResponse } from "../../ir/util/declared-response.js";
import type { WalkerField } from "./walker-model.js";

/** The stored fields of `entity` as its response record carries them: the
 *  record also carries the identity, the derived members and the contained
 *  parts (`partNames`), none of them a field declaration. */
export function recordFields(
  responses: readonly ContractResponse[],
  entity: string,
  partNames: ReadonlySet<string>,
): WalkerField[] {
  return (responses.find((r) => r.entity === entity)?.fields ?? [])
    .filter((f) => f.name !== "id" && !f.derived && !containedPart(f.type, partNames))
    .map((f) => ({
      name: f.name,
      type: f.type,
      optional: f.optional,
      ...(f.provenanced ? { provenanced: true } : {}),
    }));
}

/** The part a response field of type `t` contains, when `t` carries one of
 *  `partNames`' own response records. */
export function containedPart(
  t: TypeIR,
  partNames: ReadonlySet<string>,
): { part: string; collection: boolean } | undefined {
  const collection = t.kind === "array";
  const el = t.kind === "array" ? t.element : t.kind === "optional" ? t.inner : t;
  if (el.kind !== "entity" || !el.name.endsWith("Response")) return undefined;
  const part = el.name.slice(0, -"Response".length);
  return partNames.has(part) ? { part, collection } : undefined;
}
