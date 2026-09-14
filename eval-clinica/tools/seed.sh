#!/bin/bash
set -e
API=http://127.0.0.1:3000/api
T="$1"
post() { curl -s --noproxy '*' -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d "$2" "$API/$1"; }
