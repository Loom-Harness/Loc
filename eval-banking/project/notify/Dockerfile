# syntax=docker/dockerfile:1
# Auto-generated.

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
WORKDIR /app
# wget backs the compose healthcheck (debian-slim ships neither wget
# nor curl); ca-certificates backs the proxy-CA escape hatch below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Optional proxy CAs — drop *.crt files into ./certs/ to make uv/pip
# trust them.  The directory always exists (with a .gitkeep), so this
# COPY is a no-op when no CAs are configured.
COPY certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates 2>/dev/null || true
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    UV_PROJECT_ENVIRONMENT=/app/.venv
COPY pyproject.toml ./
RUN uv sync --no-dev
COPY app/ ./app/
COPY migrations/ ./migrations/
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
