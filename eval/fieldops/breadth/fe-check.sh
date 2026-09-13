#!/bin/bash
N=$1; D=out-fe-$N/web
[ -d "$D" ] || { echo "$N NO_WEB_DIR"; exit 0; }
cp /root/.ccr/ca-bundle.crt $D/certs/proxy.crt 2>/dev/null
cd $D || exit 1
export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
npm install --no-audit --no-fund >/tmp/fe-$N-inst.log 2>&1 || { echo "$N NPM_INSTALL_FAIL: $(grep -m1 'npm error' /tmp/fe-$N-inst.log)"; exit 0; }
OUT=$(npm run build 2>&1)
if echo "$OUT" | grep -qE "error TS|error:|ERROR"; then
  echo "$N BUILD_FAIL errors=$(echo "$OUT"|grep -cE 'error TS|ERROR')"
  echo "$OUT" | grep -E "error TS|ERROR" | head -4 | sed "s/^/   $N| /"
else
  echo "$N BUILD_OK"
fi
