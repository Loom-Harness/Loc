def ins(f, anchor, text, count=1):
    s = open(f).read()
    n = s.count(anchor)
    assert n >= count, (f, anchor, n)
    s = s.replace(anchor, text + anchor, count)
    open(f, "w").write(s)

ins("src/generator/dotnet/validator-emit.ts",
    '    case "authz-filter":\n      // `classifyForWire` excludes these — reaching the renderer',
    '    case "modelText":\n')
ins("src/generator/elixir/vanilla/wire-serialize.ts",
    '    case "authz-filter":\n    case "i18nFormat":\n      return false;',
    '    case "modelText":\n')
ins("src/generator/zod-refine.ts",
    '    case "authz-filter":\n      return false;\n    default: {',
    '    case "modelText":\n')
ins("src/generator/zod-refine.ts",
    '    case "authz-filter":\n      // `classifyForWire` excludes these AND',
    '    case "modelText":\n')
ins("src/ir/util/changeset-invariant-carrier.ts",
    '    case "authz-filter":\n    case "duration":\n      return false;',
    '    case "modelText":\n')
