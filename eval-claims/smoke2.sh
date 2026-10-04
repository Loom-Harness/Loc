B=localhost:3000/api
j(){ curl -s -w " [%{http_code}]" -X "$1" "$B$2" -H 'content-type: application/json' ${3:+-d "$3"}; echo; }
HID=$(curl -s $B/policyholders | jq -r '.items[0].id')
P=$(curl -s -X POST $B/policies -H 'content-type: application/json' -d "{\"number\":\"POL-2\",\"holder\":\"$HID\",\"effectiveFrom\":\"2026-09-20T00:00:00Z\",\"effectiveTo\":\"2027-09-20T00:00:00Z\",\"deductible\":\"500\"}"); PID=$(echo $P | jq -r .id); echo "policy $P"
j POST /policies/$PID/add_coverage '{"kind":"Water","limit":"20000"}'
j POST /policies/$PID/activate '{}'
echo "== replica"; j GET /covered_policies
echo "== saga instances"; j GET /workflows/replicate_policies/instances
WF=$(grep -o '"/api[^"]*"' /dev/null)
echo "== file claim (covered)"; j POST /workflows/file_claim "{\"claimNumber\":\"CLM-10\",\"policy\":\"$PID\",\"kind\":\"Water\",\"lossDate\":\"2026-09-25T00:00:00Z\",\"description\":\"Burst pipe in kitchen\",\"estimatedAmount\":\"3000\"}"
echo "== file claim (not covered kind)"; j POST /workflows/file_claim "{\"claimNumber\":\"CLM-11\",\"policy\":\"$PID\",\"kind\":\"Fire\",\"lossDate\":\"2026-09-25T00:00:00Z\",\"description\":\"Burst pipe in kitchen\",\"estimatedAmount\":\"3000\"}"
echo "== file claim (old policy POL-1, activated before replica existed)"; P1=$(curl -s "$B/policies/by_number?number=POL-1" | jq -r .id); j POST /workflows/file_claim "{\"claimNumber\":\"CLM-12\",\"policy\":\"$P1\",\"kind\":\"Collision\",\"lossDate\":\"2026-09-25T00:00:00Z\",\"description\":\"Fender bender xx\",\"estimatedAmount\":\"300\"}"
echo "== dup number"; j POST /workflows/file_claim "{\"claimNumber\":\"CLM-10\",\"policy\":\"$PID\",\"kind\":\"Water\",\"lossDate\":\"2026-09-25T00:00:00Z\",\"description\":\"Burst pipe in kitchen\",\"estimatedAmount\":\"3000\"}"
echo "== the bypass: direct POST /claims still exists?"; j POST /claims "{\"claimNumber\":\"CLM-13\",\"policy\":\"$PID\",\"kind\":\"Fire\",\"lossDate\":\"2026-09-25T00:00:00Z\",\"description\":\"Not covered fire\",\"estimatedAmount\":\"3000\"}"
CID=$(curl -s "$B/claims?pageSize=100" | jq -r '.items[] | select(.claimNumber=="CLM-10") | .id'); curl -s $B/claims/$CID | jq -c '{status,deductibleApplied,suspectedFraud,payout}'
AID=$(curl -s $B/adjusters | jq -r '.items[0].id')
echo "== assign via workflow"; j POST /workflows/assign_claim "{\"claim\":\"$CID\",\"adjuster\":\"$AID\"}"
j POST /claims/$CID/approve '{"amount":"2800"}'; curl -s $B/claims/$CID | jq -c '{status,approvedAmount,deductibleApplied,payout}'
echo "== cancel policy"; j POST /policies/$PID/cancel '{"reason":"non-payment"}'; j GET /covered_policies
