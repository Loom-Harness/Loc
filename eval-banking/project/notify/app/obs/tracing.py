"""OpenTelemetry tracing (observability.md).  Auto-generated.

A SERVER span opens on every request so its trace_id / span_id ride the log
envelope (log<->trace correlation); spans are EXPORTED via OTLP/HTTP only when
OTEL_EXPORTER_OTLP_ENDPOINT is set.
"""

import os

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
_provider = TracerProvider(
    resource=Resource.create(
        {"service.name": os.environ.get("OTEL_SERVICE_NAME", "notify")}
    )
)
if _endpoint:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

    _provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{_endpoint.rstrip('/')}/v1/traces"))
    )
trace.set_tracer_provider(_provider)

#: The tracer every request seam opens its SERVER span from.
tracer = trace.get_tracer("loom")


def format_trace_id(trace_id: int) -> str:
    """OTel trace id (128-bit int) -> the canonical 32-char lowercase hex."""
    return format(trace_id, "032x")


def format_span_id(span_id: int) -> str:
    """OTel span id (64-bit int) -> the canonical 16-char lowercase hex."""
    return format(span_id, "016x")


def shutdown_tracing() -> None:
    """Flush + shut down the span exporter on drain (no-op without export)."""
    _provider.shutdown()
