#!/bin/bash
# Re-run every S1/S2 reproduction and print the observed symptom. Evidence trail for FINDINGS.md.
cd "$(dirname "$0")/../.." || exit 1
R=eval-clinica/repro
run() { node bin/cli.js generate system "$1" -o "/tmp/vr-$2" 2>&1 | grep -Ev "sensitive-wire" | tail -2; }
echo "### F-002  cross-row invariant";            run $R/r02-overlap-system.ddd f002; grep -c "Appointments.run" /tmp/vr-f002/api/domain/appointment.ts
echo "### F-004  when <function>() private";      run $R/r06-when-function-private.ddd f004; grep -c "private isOpen" /tmp/vr-f004/api/domain/doc.ts
echo "### F-006  ICU dropped";                    run $R/r07-icu-format-dropped.ddd f006; grep -n "get d1\|get d5" /tmp/vr-f006/api/domain/appt.ts
echo "### F-008  retrieval emits no route";       run $R/r08-retrieval-no-route.ddd f008; grep -o '"/[a-z_/{}]*"' /tmp/vr-f008/api/http/appt.routes.ts | sort -u | tr '\n' ' '; echo
echo "### F-013  dotnet State collision";         run $R/r14-dotnet-state-collision.ddd f013; grep -n "public string State\|sealed class State" /tmp/vr-f013/api/Domain/Orders/Order.cs
echo "### F-014  java missing Objects import";    run $R/r15-java-mask-missing-import.ddd f014; grep -c "import java.util.Objects" /tmp/vr-f014/api/src/main/java/com/loom/api/features/employees/EmployeeResponse.java
echo "### F-016  workflow -> private function";   run $R/r16-workflow-calls-private-function.ddd f016; grep -c "private hasSkill" /tmp/vr-f016/api/domain/tech.ts
echo "### F-018  recursive containment crash";    node bin/cli.js generate system $R/r18-recursive-containment-crash.ddd -o /tmp/vr-f018 2>&1 | grep -E "error\(s\)|RangeError" | head -2
echo "### F-022  angular string[] form";          run $R/r22-angular-string-array-form.ddd f022; grep -o "skills: new FormControl(null[^)]*)" /tmp/vr-f022/web/src/app/pages/tech-new.component.ts
