"""Apply literal replacements: rep.py <spec.txt>.

Spec format: blocks separated by lines
@@@ <path> [count]
<old text>
===
<new text>
@@@ ...
"""
import sys

spec = open(sys.argv[1]).read()
blocks = spec.split("@@@ ")[1:]
for b in blocks:
    header, body = b.split("\n", 1)
    parts = header.split()
    path = parts[0]
    count = int(parts[1]) if len(parts) > 1 else 1
    old, new = body.split("\n===\n", 1)
    if new.endswith("\n"):
        new = new[:-1]
    s = open(path).read()
    n = s.count(old)
    if n != count:
        print(f"FAIL {path}: expected {count} got {n}: {old[:80]!r}")
        sys.exit(1)
    s = s.replace(old, new)
    open(path, "w").write(s)
    print(f"ok {path}")
