import re, subprocess, sys
out = subprocess.run(["npx", "tsc", "-b"], capture_output=True, text=True).stdout
for line in out.splitlines():
    m = re.match(r"^([^()]+)\((\d+),", line)
    if not m or "never'" not in line:
        continue
    f, l = m.group(1), int(m.group(2))
    src = open(f).read().splitlines()
    print(f"=== {f}:{l}")
    lo = max(0, l - int(sys.argv[1] if len(sys.argv) > 1 else 40))
    for i in range(lo, l + 2):
        s = src[i - 1] if i - 1 < len(src) else ""
        if re.search(r'case "|default:|never', s):
            print(f"{i}: {s}")
