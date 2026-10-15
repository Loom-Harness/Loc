# Auto-generated.
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

# prometheus_client registers the process, platform, and GC collectors
# on the default REGISTRY at import time (process_cpu_seconds_total,
# process_resident_memory_bytes, python_gc_*, python_info) — the runtime
# baseline every dashboard wants before any app-specific metric.

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests handled, by method, route template, and status code.",
    ["method", "route", "status"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds, by method, route template, and status code.",
    ["method", "route", "status"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)


def record_http_request(method: str, route: str, status: int, duration_ms: float) -> None:
    """Record one finished request against both HTTP metrics.  Called from
    the observability middleware at the same seam as the request_end log
    line.  `route` is the matched route TEMPLATE (`/api/carts/{cart_id}`),
    never the raw path — labelling by raw path would explode cardinality
    on every id."""
    labels = (method, route, str(status))
    HTTP_REQUESTS_TOTAL.labels(*labels).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(*labels).observe(duration_ms / 1000.0)


DOMAIN_OPERATIONS_TOTAL = Counter(
    "domain_operations_total",
    "Total domain operations invoked, by aggregate and operation.",
    ["aggregate", "op"],
)

DOMAIN_FAULTS_TOTAL = Counter(
    "domain_faults_total",
    "Total recoverable domain faults, by kind.",
    ["kind"],
)


def record_domain_operation(aggregate: str, op: str) -> None:
    """Count one invoked domain operation (a named operation, or an
    aggregate constructor as op="create"), at the operation_invoked /
    aggregate_created seam."""
    DOMAIN_OPERATIONS_TOTAL.labels(aggregate, op).inc()


def record_domain_fault(kind: str) -> None:
    """Count one recoverable domain fault by kind, at the app-wide error
    handlers alongside the matching fault log line."""
    DOMAIN_FAULTS_TOTAL.labels(kind).inc()


def render_metrics() -> tuple[bytes, str]:
    """The Prometheus text exposition + its content type, for GET /metrics."""
    return generate_latest(), CONTENT_TYPE_LATEST
