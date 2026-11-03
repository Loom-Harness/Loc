import re
specs = [
    ("src/generator/_walker/walker-core.ts", 2253),
    ("src/generator/dotnet/validator-emit.ts", 531),
    ("src/generator/feliz/fs-expr.ts", 676),
    ("src/generator/zod-refine.ts", 487),
    ("src/ir/util/walk.ts", 128),
    ("src/ir/validate/checks/shared.ts", 684),
    ("src/ir/validate/invariant-classify.ts", 156),
]
for f, l in specs:
    src = open(f).read().split("\n")
    # find exact line near l
    for i in range(l - 4, l + 4):
        if re.match(r'\s*case "modelText":\s*$', src[i - 1]) and re.match(r'\s*case "i18nFormat":', src[i - 2]):
            del src[i - 1]
            print("removed", f, i)
            break
    else:
        print("NOT FOUND", f, l)
    open(f, "w").write("\n".join(src))
