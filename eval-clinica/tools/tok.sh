#!/bin/bash
# mint a token: tok.sh '<json claims>'
curl -sG --noproxy '*' http://127.0.0.1:9099/mint --data-urlencode "claims=$1"
