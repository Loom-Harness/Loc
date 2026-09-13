#!/bin/bash
# Generate a .ddd onto the node backend and typecheck the emitted project.
# usage: check-ts.sh <file.ddd> <outdir>
set -u
F="$1"; O="$2"
rm -rf "$O"
GEN=$(node /home/user/Loc/bin/cli.js generate system "$F" -o "$O" 2>&1)
GX=$?
echo "GENERATE exit=$GX"
echo "$GEN" | tail -3
[ $GX -ne 0 ] && exit 2
cp /root/.ccr/ca-bundle.crt "$O"/api/certs/proxy.crt 2>/dev/null
cd "$O/api" || exit 3
export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
npm install --no-audit --no-fund >/tmp/inst-$$.log 2>&1 || { echo "NPM INSTALL FAILED"; tail -5 /tmp/inst-$$.log; exit 4; }
echo "--- tsc --noEmit ---"
npx tsc --noEmit 2>&1 | head -25
echo "TSC_ERRORS=$(npx tsc --noEmit 2>&1 | grep -c 'error TS')"
