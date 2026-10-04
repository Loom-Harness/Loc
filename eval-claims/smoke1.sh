B=localhost:3000/api
j(){ curl -s -X "$1" "$B$2" -H 'content-type: application/json' ${3:+-d "$3"}; echo; }
echo "== holder"; H=$(j POST /policyholders '{"fullName":"Ada Lovelace","email":"ada@example.com"}'); echo $H; HID=$(echo $H | jq -r .id)
echo "== policy"; P=$(j POST /policies "{\"number\":\"POL-1\",\"holder\":\"$HID\",\"effectiveFrom\":\"2026-01-01T00:00:00Z\",\"effectiveTo\":\"2027-01-01T00:00:00Z\",\"deductible\":\"250.00\"}"); echo $P; PID=$(echo $P | jq -r .id)
echo "== addCoverage"; j POST /policies/$PID/add_coverage '{"kind":"Collision","limit":"10000"}'
echo "== addCoverage dup"; j POST /policies/$PID/add_coverage '{"kind":"Collision","limit":"5000"}'
echo "== activate"; j POST /policies/$PID/activate '{}'
echo "== by_number"; j GET "/policies/by_number?number=POL-1"
echo "== adjuster"; A=$(j POST /adjusters '{"name":"Bob","email":"bob@x.com"}'); echo $A; AID=$(echo $A | jq -r .id)
echo "== claim"; C=$(j POST /claims "{\"claimNumber\":\"CLM-1\",\"policy\":\"$PID\",\"kind\":\"Collision\",\"lossDate\":\"2026-09-01T00:00:00Z\",\"description\":\"Rear-ended at a red light\",\"estimatedAmount\":\"4200\"}"); echo $C; CID=$(echo $C | jq -r .id)
echo "== claim sneaky approvedAmount"; j POST /claims "{\"claimNumber\":\"CLM-2\",\"policy\":\"$PID\",\"kind\":\"Theft\",\"lossDate\":\"2030-09-01T00:00:00Z\",\"description\":\"Bike stolen from garage\",\"estimatedAmount\":\"100\",\"approvedAmount\":\"99999\"}"
echo "== claim bogus policy id"; j POST /claims "{\"claimNumber\":\"CLM-3\",\"policy\":\"00000000-0000-0000-0000-000000000000\",\"kind\":\"Fire\",\"lossDate\":\"2026-09-01T00:00:00Z\",\"description\":\"Kitchen fire xxxxx\",\"estimatedAmount\":\"100\"}"
echo "== approve before assign"; j POST /claims/$CID/approve '{"amount":"100"}'
echo "== assign"; j POST /claims/$CID/assign "{\"adjuster\":\"$AID\"}"
echo "== note"; j POST /claims/$CID/add_note '{"text":"Photos received"}'
echo "== approve too much"; j POST /claims/$CID/approve '{"amount":"5000"}'
echo "== approve"; j POST /claims/$CID/approve '{"amount":"3900"}'
echo "== paid"; j POST /claims/$CID/mark_paid '{}'
echo "== list"; j GET "/claims"
