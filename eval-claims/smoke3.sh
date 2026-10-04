KC=http://host.docker.internal:8081
tok(){ curl -s -d client_id=claims-app -d username=$1 -d password=$2 -d grant_type=password -d scope=openid $KC/realms/claims/protocol/openid-connect/token | jq -r .access_token; }
A=$(tok alice pw); S=$(tok sam pw); D=$(tok demo demo)
B=localhost:3000/api; R=$RANDOM
j(){ local t=$1; shift; curl -s -w " [%{http_code}]" -X "$1" "$B$2" -H "authorization: Bearer $t" -H 'content-type: application/json' ${3:+-d "$3"}; echo; }
echo "== no token"; curl -s -w " [%{http_code}]\n" localhost:3000/api/claims | cut -c1-200
echo "== demo user list claims"; j $D GET /claims | cut -c1-200
echo "== demo user activate policy"; j $D POST /policies/x/activate '{}' | cut -c1-200
HID=$(curl -s $B/policyholders -H "authorization: Bearer $S" | jq -r '.items[0].id')
PID=$(curl -s -X POST $B/policies -H "authorization: Bearer $S" -H 'content-type: application/json' -d "{\"number\":\"POL-$R\",\"holder\":\"$HID\",\"effectiveFrom\":\"2026-01-01T00:00:00Z\",\"effectiveTo\":\"2027-01-01T00:00:00Z\",\"deductible\":\"200\"}" | jq -r .id); echo PID=$PID
echo "== alice adds coverage (no policiesManage)"; j $A POST /policies/$PID/add_coverage '{"kind":"Fire","limit":"50000"}' | cut -c1-200
j $S POST /policies/$PID/add_coverage '{"kind":"Fire","limit":"50000"}'; j $S POST /policies/$PID/activate '{}'
echo "== alice files claims"; j $A POST /workflows/file_claim "{\"claimNumber\":\"CLM-30-$R\",\"policy\":\"$PID\",\"kind\":\"Fire\",\"lossDate\":\"2026-05-01T00:00:00Z\",\"description\":\"Garage fire, total loss\",\"estimatedAmount\":\"30000\"}"
j $A POST /workflows/file_claim "{\"claimNumber\":\"CLM-31-$R\",\"policy\":\"$PID\",\"kind\":\"Fire\",\"lossDate\":\"2026-05-01T00:00:00Z\",\"description\":\"Kitchen fire, small\",\"estimatedAmount\":\"3000\"}"
C30=$(curl -s "$B/claims?pageSize=100" -H "authorization: Bearer $S" | jq -r '.items[]|select(.claimNumber=="CLM-30-'$R'")|.id'); C31=$(curl -s "$B/claims?pageSize=100" -H "authorization: Bearer $S" | jq -r '.items[]|select(.claimNumber=="CLM-31-'$R'")|.id')
AID=$(curl -s "$B/adjusters" -H "authorization: Bearer $S" | jq -r '.items[0].id')
echo "== alice tries intake bypass"; j $A POST /claims/$C31/intake '{"deductible":"0","fraud":false}' | cut -c1-200
echo "== alice assigns (needs supervisor)"; j $A POST /workflows/assign_claim "{\"claim\":\"$C31\",\"adjuster\":\"$AID\"}" | cut -c1-200
j $S POST /workflows/assign_claim "{\"claim\":\"$C31\",\"adjuster\":\"$AID\"}"; j $S POST /workflows/assign_claim "{\"claim\":\"$C30\",\"adjuster\":\"$AID\"}"
echo "== sam approves alice's claim (not assigned to sam)"; j $S POST /claims/$C31/approve '{"amount":"2500"}' | cut -c1-200
echo "== alice approves 25k (needs supervisor)"; j $A POST /claims/$C30/approve '{"amount":"25000"}' | cut -c1-200
echo "== alice approves 2.5k"; j $A POST /claims/$C31/approve '{"amount":"2500"}'
sleep 2
echo "== payments service"; P=$(curl -s localhost:3002/api/payments -H "authorization: Bearer $S"); echo $P | cut -c1-400
PAYID=$(echo $P | jq -r '.items[0].id')
echo "== send payment"; curl -s -w " [%{http_code}]\n" -X POST localhost:3002/api/payments/$PAYID/send -H "authorization: Bearer $S" -H 'content-type: application/json' -d '{"bankReference":"SEPA-123"}'
sleep 2
echo "== claim after payment"; curl -s $B/claims/$C31 -H "authorization: Bearer $S" | jq -c '{status,approvedAmount,payout}'
