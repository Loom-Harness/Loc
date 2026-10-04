"""Wire-format helpers shared by repositories.  Auto-generated."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import TypeVar

_T = TypeVar("_T")


def required(value: _T | None) -> _T:
    """Unwrap a flattened value-object leaf that the guard above already
    proved present.  An OPTIONAL value-object field makes EVERY one of its
    leaf columns nullable, but the `is not None` probe narrows only the ONE
    column it reads — the rest stay `X | None` against a constructor wanting
    `X`.  This is the python spelling of the node backend's `!`, with a
    runtime guard rather than a bare type assertion: reaching `None` here
    means the leaf group is half-written, which is a corrupt row, not a
    representable state."""
    if value is None:
        raise ValueError("value-object leaf is unexpectedly NULL")
    return value


def iso(dt: datetime) -> str:
    """ISO-8601 UTC in MILLISECONDS with a Z suffix (RS-4 + RS-38) — exactly
    three fractional digits when the instant has a sub-second part, none on a
    whole second, the form every backend ships.  `isoformat` alone printed
    six digits (`.120000Z`); `timespec="milliseconds"` TRUNCATES, so
    `.9996` cannot carry into the next second."""
    utc = dt.astimezone(UTC)
    if utc.microsecond < 1000:
        return utc.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def money_str(amount: Decimal) -> str:
    """Money → wire string at the FIXED NUMERIC(19,4) scale: the same
    canonical scale every backend serializes money at (node `.toFixed(4)`,
    .NET `ToString("F4")`, Java `setScale(4)`, Elixir `Decimal.round(_, 4)`).
    `quantize` pins the scale (a value/derived money carries its own scale
    otherwise); `format(d, "f")` then avoids the scientific notation bare
    `str(Decimal)` can emit (e.g. `1E+2`)."""
    return format(amount.quantize(Decimal("1e-4"), rounding="ROUND_HALF_UP"), "f")
