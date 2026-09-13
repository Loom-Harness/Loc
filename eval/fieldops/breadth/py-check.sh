docker run --rm -v "$PWD/out-python/api:/w" -w /w \
  -e HTTPS_PROXY -e HTTP_PROXY -e REQUESTS_CA_BUNDLE=/ca.crt -e SSL_CERT_FILE=/ca.crt -e PIP_CERT=/ca.crt \
  -v /root/.ccr/ca-bundle.crt:/ca.crt:ro --network host \
  python:3.12-slim bash -lc '
    pip install -q --cert /ca.crt uv 2>&1 | tail -2
    uv sync --native-tls >/tmp/s.log 2>&1 || { echo "UV_SYNC_FAIL"; tail -8 /tmp/s.log; exit 1; }
    echo "--- python -c import ---"
    uv run python -c "import app.main" 2>&1 | tail -12
    echo "IMPORT_EXIT=$?"
  '
