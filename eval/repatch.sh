#!/bin/sh
# Re-apply the hand patches that `ddd generate system` clobbers on every run.
# Each corresponds to a finding; see eval/FINDINGS.md.
d="$1"; shift
sed -i '0,/from "drizzle-orm";/s//from "drizzle-orm";\nimport { ne } from "drizzle-orm";  \/* F-013 *\//' "$d/api/db/repositories/workOrder-repository.ts" 2>/dev/null
sed -i 's|eq(schema.workOrders.technicianId, currentUser.technicianId)|eq(schema.workOrders.technicianId, (currentUser.technicianId ?? "00000000-0000-0000-0000-000000000000") as string) /* F-014 */|' "$d/api/db/repositories/workOrder-repository.ts" 2>/dev/null
sed -i 's|  private hasSkill(|  public hasSkill( /* F-015 */ |' "$d/api/domain/technician.ts" 2>/dev/null
sed -i 's|image: minio/minio:latest|image: quay.io/minio/minio:latest  # F-020|' "$d/docker-compose.yml"
cp /root/.ccr/ca-bundle.crt "$d/api/certs/proxy-ca.crt" 2>/dev/null
mkdir -p "$d/web/certs" && cp /root/.ccr/ca-bundle.crt "$d/web/certs/proxy-ca.crt"
echo "repatched $d"
