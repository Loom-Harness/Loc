import glob, re

packs = ["mantine/v9", "shadcn/v4", "mui/v7", "chakra/v3"]
changed = []
for p in packs:
    for f in sorted(glob.glob(f"designs/{p}/*.hbs")):
        s = open(f).read()
        o = s
        name = f.split("/")[-1]
        if name == "form-op-module.hbs":
            s = s.replace("{{humanOp}}", "{{{humanOp}}}")
        if name == "primitive-form-of.hbs":
            s = s.replace("{{submitLabel}}", "{{{submitLabel}}}")
        if name.startswith("field-input-"):
            # attribute position:  attr="{{label}}"
            s = re.sub(
                r'(\b[a-zA-Z-]+)="\{\{label\}\}"',
                lambda m: '{{#if labelExpr}}' + m.group(1) + '={ {{{labelExpr}}} }{{else}}' + m.group(1) + '="{{label}}"{{/if}}',
                s,
            )
            # text position:  >{{label}}<
            s = s.replace(">{{label}}<", ">{{#if labelExpr}}{ {{{labelExpr}}} }{{else}}{{label}}{{/if}}<")
        if s != o:
            open(f, "w").write(s)
            changed.append(f)
print("\n".join(changed))
