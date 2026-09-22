B="$1"
mk(){ python3 -c "import base64,sys;print(base64.b64encode(sys.argv[1].encode()).decode())" "$1"; }
P='"ops.workOrderRead","ops.workOrderWrite","ops.workOrderDispatch","ops.opsAdmin","ops.costRateUnmask","accounts.orgRead","accounts.orgAdmin"'
TA=$(mk "{\"id\":\"u-a\",\"email\":\"a@x\",\"role\":\"admin\",\"permissions\":[$P],\"tenantId\":\"TENANT-A\"}")
TL=$(mk "{\"id\":\"u-l\",\"email\":\"l@x\",\"role\":\"tech\",\"permissions\":[\"ops.workOrderRead\"],\"tenantId\":\"TENANT-A\"}")
TB=$(mk "{\"id\":\"u-b\",\"email\":\"b@x\",\"role\":\"admin\",\"permissions\":[$P],\"tenantId\":\"TENANT-B\"}")
H="x-loom-dev-claims: $TA"
j(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id'))"; }
C=$(curl -s -XPOST -H 'content-type: application/json' -H "$H" -d '{"name":"WireCo","billingEmail":"w@w.co"}' $B/customers|j)
S=$(curl -s -XPOST -H 'content-type: application/json' -H "$H" -d "{\"customerId\":\"$C\",\"label\":\"L\",\"addressLine\":\"A\"}" $B/sites|j)
T=$(curl -s -XPOST -H 'content-type: application/json' -H "$H" -d '{"fullName":"Dana","skills":["hvac"],"costRate":"85.0000"}' $B/technicians|j)
W=$(curl -s -XPOST -H 'content-type: application/json' -H "$H" -d "{\"customerId\":\"$C\",\"siteId\":\"$S\",\"assetId\":null,\"status\":\"Draft\",\"priority\":\"Normal\",\"currency\":\"EUR\"}" $B/work_orders|j)
curl -s -XPOST -H 'content-type: application/json' -H "$H" -d '{"kind":"Labour","description":"Diagnostics","quantity":2,"unitPrice":"50.2500"}' $B/work_orders/$W/add_line >/dev/null
echo "### GET /work_orders/{id}"
curl -s -H "$H" $B/work_orders/$W | python3 -c "
import json,sys
d=json.load(sys.stdin)
def norm(o):
  if isinstance(o,dict): return {k:('<uuid>' if k.endswith('Id') or k=='id' or k=='parentId' else ('<ts>' if k.endswith('At') and isinstance(v,str) else norm(v))) for k,v in sorted(o.items()) for v in [o[k]]}
  if isinstance(o,list): return [norm(x) for x in o]
  return o
print(json.dumps(norm(d),indent=0,sort_keys=True))"
echo "### GET /work_orders (paged envelope keys)"
curl -s -H "$H" "$B/work_orders?page=1&pageSize=5" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sorted(d.keys()), 'total=',d.get('total'))"
echo "### statuses"
echo -n "unauth           "; curl -s -o /dev/null -w "%{http_code}\n" $B/customers
echo -n "invariant(422?)  "; curl -s -o /dev/null -w "%{http_code}\n" -XPOST -H 'content-type: application/json' -H "$H" -d '{"name":"","billingEmail":"a@b.co"}' $B/customers
echo -n "check(422?)      "; curl -s -o /dev/null -w "%{http_code}\n" -XPOST -H 'content-type: application/json' -H "$H" -d '{"name":"X","billingEmail":"bad"}' $B/customers
echo -n "notfound(404?)   "; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" $B/work_orders/3f1a6a2e-0c7b-4f0a-9c2e-7b9d1f0a5e11
echo -n "forbidden(403?)  "; curl -s -o /dev/null -w "%{http_code}\n" -XPOST -H 'content-type: application/json' -H "x-loom-dev-claims: $TL" -d '{"kind":"Labour","description":"x","quantity":1,"unitPrice":"1.0000"}' $B/work_orders/$W/add_line
echo -n "whengate(409?)   "; curl -s -o /dev/null -w "%{http_code}\n" -XPOST -H 'content-type: application/json' -H "$H" -d '{}' $B/work_orders/$W/start
echo -n "crosstenant(404?)"; curl -s -o /dev/null -w "%{http_code}\n" -H "x-loom-dev-claims: $TB" $B/work_orders/$W
echo -n "mask(null?)      "; curl -s -H "x-loom-dev-claims: $TL" $B/technicians/$T | python3 -c "import json,sys;print(json.load(sys.stdin).get('costRate'))"
echo "### error body shape (invariant)"
curl -s -XPOST -H 'content-type: application/json' -H "$H" -d '{"name":"X","billingEmail":"bad"}' $B/customers | python3 -c "import json,sys;d=json.load(sys.stdin);print(sorted(d.keys()));print(json.dumps({k:d[k] for k in d if k!='instance'},sort_keys=True))"
