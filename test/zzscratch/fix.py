import re, subprocess
out = subprocess.run(["npx", "tsc", "-b"], capture_output=True, text=True).stdout
errs = {}
for line in out.splitlines():
    m = re.match(r"^([^()]+)\((\d+),", line)
    if not m or "never'" not in line:
        continue
    errs.setdefault(m.group(1), []).append(int(m.group(2)))
manual = []
for f, lines in errs.items():
    src = open(f).read().split("\n")
    inserts = []
    for l in lines:
        idx = None
        for i in range(l - 1, max(0, l - 140), -1):
            if re.match(r'\s*case "i18nFormat":\s*$', src[i]):
                idx = i
                break
            if re.search(r'never = ', src[i]) and i != l - 1:
                break
        if idx is None:
            manual.append(f"{f}:{l} (no i18nFormat)")
            continue
        nxt = src[idx + 1]
        if re.match(r'\s*case "', nxt) or re.match(r'\s*//', nxt):
            ind = re.match(r'(\s*)', src[idx]).group(1)
            inserts.append((idx + 1, f'{ind}case "modelText":'))
        else:
            manual.append(f"{f}:{l} (i18nFormat has body at {idx+1})")
    for pos, text in sorted(set(inserts), reverse=True):
        src.insert(pos, text)
    open(f, "w").write("\n".join(src))
print("\n".join(manual))
