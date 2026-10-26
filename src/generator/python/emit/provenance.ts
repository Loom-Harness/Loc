import type { AggregateIR, BoundedContextIR, FieldIR } from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";

// ---------------------------------------------------------------------------
// Python provenance runtime — the FastAPI / SQLAlchemy counterpart of the
// Hono `domain/provenance.ts` SDK + the .NET `ProvLineage` / `ProvenanceRecord`
// + the elixir-vanilla `<App>.Provenance` process-buffer SDK.  Emitted only
// when the project declares at least one `provenanced` field on a python
// deployable.
//
//   - `app/domain/provenance.py` — the `ProvLineage` dataclass + a
//     **`contextvars.ContextVar`** trace buffer (`record/1` push, `drain/0`
//     clear).  The FastAPI session is request-scoped, so the buffer rides a
//     per-request ContextVar exactly as the BEAM buffer rides the process
//     dictionary; the named-operation save drains it inside the request's
//     single transaction.
//   - `app/db/provenance.py` — the `ProvenanceRecord` SQLAlchemy model (the
//     append-only history table), mirroring the Hono `provenance_records`
//     Drizzle table / the .NET `ProvenanceRecord` EF entity column-for-column
//     (governance stamps included).
//
// The co-located `<field>_provenance` jsonb column + the `provenance_records`
// table are ordinary MigrationsIR DDL (`withLineageColumns` /
// `provenanceTableShape` in migrations-builder.ts), rendered by
// `emit/migrations.ts` with every other step.  The per-write capture
// (ContextVar push + co-located backing field) is wired by `render-stmt.ts`;
// the flush is wired by `repository-builder.ts` (drain → insert before the
// save `flush()`).
// ---------------------------------------------------------------------------

/** The provenanced fields declared on an aggregate (root fields only — the
 *  python backend captures named-operation write sites, which target root
 *  columns). */
export function provenancedFieldsOf(agg: AggregateIR): FieldIR[] {
  return agg.fields.filter((f) => f.provenanced);
}

/** True iff any aggregate in the given contexts declares a `provenanced`
 *  field — gates the whole runtime (SDK modules + capture). */
export function contextsHaveProvenanced(contexts: BoundedContextIR[]): boolean {
  return contexts.some((ctx) => ctx.aggregates.some((agg) => provenancedFieldsOf(agg).length > 0));
}

/** Snake-cased name of the co-located backing column for a provenanced field
 *  (`total` → `total_provenance`).  Shared by the Response DTO, the op-body
 *  capture, the save persist and the hydrate restore, so all agree with the
 *  column `withLineageColumns` derives. */
export function provColumn(fieldName: string): string {
  return `${snake(fieldName)}${PY_PROV_SUFFIX}`;
}

/** The suffix `provColumn` appends.  Exported so a serializer holding an
 *  ATTRIBUTE EXPRESSION rather than a field name (`root.total` →
 *  `root.total_provenance`) derives the sibling by the same rule instead of
 *  re-spelling it. */
export const PY_PROV_SUFFIX = "_provenance";

/** `app/domain/provenance.py` — the `ProvLineage` dataclass + ContextVar
 *  trace buffer.  Pure (no db imports), so it stays in the domain layer. */
export const PROVENANCE_DOMAIN_PY = `"""Provenance lineage + per-request trace buffer.  Auto-generated.

Every \`provenanced\` write-site builds a \`ProvLineage\` (rule snapshot id +
leaf inputs + post-write computed value) and pushes it onto a per-request
\`contextvars.ContextVar\` buffer via \`record(...)\`; the named-operation save
drains it (\`drain()\`) into the \`provenance_records\` table inside the
request's single transaction.  The FastAPI session is request-scoped, so the
ContextVar buffer is request-scoped too — the Python analogue of the BEAM
process-dictionary buffer the elixir-vanilla foundation uses.
"""

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProvTarget:
    """Resolved aggregate type + field name a provenanced write targets."""

    type: str
    field: str


@dataclass
class ProvInput:
    """One leaf input snapshotted *before* the write (path + pre-write value)."""

    path: str
    value: Any


@dataclass
class ProvLineage:
    """The lineage of a single provenanced write — points back at the
    compile-time rule snapshot in \`.loom/snapshots/*.loomsnap.json\`."""

    snapshot_id: str
    target: ProvTarget
    inputs: list[ProvInput] = field(default_factory=list)
    computed_value: Any = None

    def to_wire(self) -> dict[str, Any]:
        """The camelCase jsonb shape shared with the Hono / .NET / elixir
        lineages — co-located column AND \`provenance_records\` history row."""
        return {
            "snapshotId": self.snapshot_id,
            "target": {"type": self.target.type, "field": self.target.field},
            "inputs": [{"path": i.path, "value": i.value} for i in self.inputs],
            "computedValue": self.computed_value,
        }

    @classmethod
    def from_wire(cls, data: Any) -> "ProvLineage":
        """Rehydrate a lineage from its persisted jsonb shape (an opaque
        \`object\`-typed jsonb column on the row)."""
        target = data["target"]
        return cls(
            snapshot_id=data["snapshotId"],
            target=ProvTarget(type=target["type"], field=target["field"]),
            inputs=[ProvInput(path=i["path"], value=i["value"]) for i in data["inputs"]],
            computed_value=data["computedValue"],
        )


_trace_buffer: ContextVar[list[ProvLineage]] = ContextVar("loom_prov_traces")


def record(lineage: ProvLineage) -> ProvLineage:
    """Push one lineage onto the per-request trace buffer; returns it unchanged."""
    try:
        buf = _trace_buffer.get()
    except LookupError:
        buf = []
        _trace_buffer.set(buf)
    buf.append(lineage)
    return lineage


def drain() -> list[ProvLineage]:
    """Drain + clear the per-request trace buffer (source order preserved)."""
    try:
        buf = _trace_buffer.get()
    except LookupError:
        return []
    _trace_buffer.set([])
    return buf
`;

/** `app/db/provenance.py` — the append-only `provenance_records` history
 *  table (SQLAlchemy model).  Lives in the db layer (it needs `Base`), so the
 *  repository imports `ProvenanceRecord` from here.  Column-for-column parity
 *  with the Hono Drizzle table / the .NET EF entity (governance stamps). */
export const PROVENANCE_DB_PY = `"""Append-only provenance_records history table.  Auto-generated.

One row per provenanced write, drained from the per-request trace buffer into
this table inside the save transaction so the history commits atomically with
the aggregate.  Column-for-column parity with the Hono / .NET / elixir-vanilla
provenance tables (governance stamps included)."""

from datetime import datetime

from sqlalchemy import DateTime, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.schema import Base


class ProvenanceRecord(Base):
    __tablename__ = "provenance_records"
    __table_args__ = (
        Index("provenance_records_target_idx", "target_type", "field"),
        Index("provenance_records_correlation_idx", "correlation_id"),
    )

    trace_id: Mapped[str] = mapped_column(Text, primary_key=True)
    snapshot_id: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(Text)
    field: Mapped[str] = mapped_column(Text)
    inputs: Mapped[object] = mapped_column(JSONB)
    computed_value: Mapped[object | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    correlation_id: Mapped[str | None] = mapped_column(Text)
    scope_id: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[str | None] = mapped_column(Text)
`;

/** Emit the provenance SDK modules when any provenanced field exists.  No-op
 *  otherwise (keeps non-provenance projects byte-identical). */
export function emitPyProvenance(contexts: BoundedContextIR[], out: Map<string, string>): void {
  if (!contextsHaveProvenanced(contexts)) return;
  out.set("app/domain/provenance.py", PROVENANCE_DOMAIN_PY);
  out.set("app/db/provenance.py", PROVENANCE_DB_PY);
}
