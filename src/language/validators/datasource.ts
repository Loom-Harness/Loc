// DataSource declaration checks — kind ↔ storage.type compatibility
// and config-knob ↔ (kind, storage.type) compatibility.  See the
// DataSourceIR fields documented in `src/ir/types/loom-ir.ts`.
//
// Layering note: these are AST-layer (Langium-resolved cross-refs)
// because the storage cross-reference is already wired by the
// scope provider; no IR-level lookup is needed.

import type { ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { DataSourceKind } from "../../ir/types/loom-ir.js";
import {
  isCacheStore,
  isRelational,
  sourceTypesForSurfaceKind,
  supportsSurfaceKind,
} from "../../util/source-types.js";
import { type Api, isApi, isStorage, type Resource, type Storage } from "../generated/ast.js";

// Kind↔storage-type and knob↔storage-type compatibility is sourced from
// the platform-internal sourceType registry (`src/util/source-types.ts`),
// the single source of truth.  This validator keeps the check at the AST
// layer so mismatches surface as in-editor squiggles on the offending
// node/property; it merely consults the registry instead of hardcoding
// the matrix.

/** Validate one DataSource declaration in place.  Emits diagnostics
 *  against the dataSource node itself; mismatch on a referenced
 *  storage points at the `use:` property so the squiggle is local. */
export function checkDataSource(ds: Resource, accept: ValidationAcceptor): void {
  const kind = ds.kind;
  // `use:` binds either a physical `storage` or an in-system `api`
  // (M-T4.8).  NARROW it — the old `as Storage` cast silently mistyped an
  // api target as a storage, so every `storage.type` read below would have
  // been `undefined` at runtime with no diagnostic.
  const target = ds.use?.ref;
  const storage: Storage | undefined = target && isStorage(target) ? target : undefined;
  const api: Api | undefined = target && isApi(target) ? target : undefined;

  // (0) An `api` target is only meaningful on `kind: api` — every other kind
  // names a persistence/infra role a sibling deployable's HTTP surface can't
  // realise.  Checked before (1) so the message names the real mismatch
  // rather than falling through to the storage-type branch.
  if (api && kind && kind !== "api") {
    accept(
      "error",
      diagMessage("loom.resource-api-target-kind", { name: ds.name, apiName: api.name, kind }),
      { node: ds, property: "use", code: "loom.resource-api-target-kind" },
    );
  }

  // (1) kind ↔ storage.type compatibility — only when both are
  // present.  Missing-required-field diagnostics live elsewhere
  // (a separate "every dataSource needs for/kind/use" pass would
  // be a sibling slice; for now we soft-skip).
  if (kind && storage?.type) {
    if (!supportsSurfaceKind(storage.type, kind as DataSourceKind)) {
      accept(
        "error",
        diagMessage("loom.resource-kind-storage-mismatch", {
          name: ds.name,
          kind,
          storageName: storage.name,
          storageType: storage.type,
          requires: formatList(sourceTypesForSurfaceKind(kind as DataSourceKind)),
        }),
        { node: ds, property: "use", code: "loom.resource-kind-storage-mismatch" },
      );
    }
  }

  // (2) kind ↔ knob compatibility.
  if (ds.ttl != null && kind && kind !== "cache") {
    accept("error", diagMessage("loom.resource-knob-kind-mismatch#ttl", { name: ds.name, kind }), {
      node: ds,
      property: "ttl",
      code: "loom.resource-knob-kind-mismatch",
    });
  }
  if (ds.every != null && kind && kind !== "eventLog" && kind !== "snapshot") {
    accept(
      "error",
      diagMessage("loom.resource-knob-kind-mismatch#every", { name: ds.name, kind }),
      { node: ds, property: "every", code: "loom.resource-knob-kind-mismatch" },
    );
  }
  if (ds.retain != null && kind && kind !== "eventLog" && kind !== "snapshot") {
    accept(
      "error",
      diagMessage("loom.resource-knob-kind-mismatch#retain", { name: ds.name, kind }),
      { node: ds, property: "retain", code: "loom.resource-knob-kind-mismatch" },
    );
  }
  if (ds.isolationLevel && kind === "cache") {
    accept(
      "error",
      diagMessage("loom.resource-knob-kind-mismatch#isolation-on-cache", { name: ds.name }),
      { node: ds, property: "isolationLevel", code: "loom.resource-knob-kind-mismatch" },
    );
  }

  // (3) storage.type ↔ knob compatibility — only enforced when
  // storage resolves; otherwise the cross-ref error already points
  // the user there.
  if (storage?.type) {
    if (ds.schema != null && !isRelational(storage.type)) {
      accept(
        "error",
        diagMessage("loom.resource-knob-storage-mismatch#schema", {
          name: ds.name,
          storageType: storage.type,
        }),
        { node: ds, property: "schema", code: "loom.resource-knob-storage-mismatch" },
      );
    }
    if (ds.tablePrefix != null && !isRelational(storage.type)) {
      accept(
        "error",
        diagMessage("loom.resource-knob-storage-mismatch#table-prefix", {
          name: ds.name,
          storageType: storage.type,
        }),
        { node: ds, property: "tablePrefix", code: "loom.resource-knob-storage-mismatch" },
      );
    }
    if (ds.keyPrefix != null && !isCacheStore(storage.type)) {
      accept(
        "error",
        diagMessage("loom.resource-knob-storage-mismatch#key-prefix", {
          name: ds.name,
          storageType: storage.type,
        }),
        { node: ds, property: "keyPrefix", code: "loom.resource-knob-storage-mismatch" },
      );
    }
    if (ds.isolationLevel && !isRelational(storage.type)) {
      accept(
        "error",
        diagMessage("loom.resource-knob-storage-mismatch#isolation", {
          name: ds.name,
          storageType: storage.type,
        }),
        { node: ds, property: "isolationLevel", code: "loom.resource-knob-storage-mismatch" },
      );
    }
  }
}

function formatList(xs: readonly string[]): string {
  if (xs.length === 0) return "<none>";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} or ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, or ${xs[xs.length - 1]}`;
}
