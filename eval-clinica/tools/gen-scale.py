#!/usr/bin/env python3
"""Generate a synthetic Loom model with N aggregates across M contexts, to
measure parse/generate scaling. (Evaluator tool, not part of Loom.)"""
import sys
n = int(sys.argv[1]); ctxs = int(sys.argv[2]) if len(sys.argv) > 2 else 4
per = max(1, n // ctxs)
out = ["system Scale {", "  subdomain Big {"]
idx = 0
for c in range(ctxs):
    out.append(f"    context C{c} {{")
    out.append(f"      enum S{c} {{ Draft, Active, Closed }}")
    for i in range(per):
        idx += 1
        prev = f"        ref: A{c}_{i-1} id" if i > 0 else ""
        out.append(f"""      aggregate A{c}_{i} {{
        name: string
        amount: money
        qty: int
        at: datetime
        status: S{c}
{prev}
        derived display: string = name
        derived total: money = amount * qty
        invariant qty > 0
        create() {{ }}
        operation activate() when status == Draft {{ status := Active }}
        operation close() when status == Active {{ status := Closed  emit E{c}_{i} {{ a: id }} }}
      }}
      event E{c}_{i} {{ a: A{c}_{i} id }}
      repository R{c}_{i} for A{c}_{i} {{ }}
      criterion Open{c}_{i} of A{c}_{i} = status == Draft || status == Active""")
    out.append("    }")
out.append("  }")
out.append("  storage primary { type: postgres }")
for c in range(ctxs):
    out.append(f"  resource st{c} {{ for: C{c}, kind: state, use: primary }}")
out.append("  ui Web with scaffold(subdomains: [Big]) { framework: react }")
out.append("  deployable api { platform: node, contexts: [" + ", ".join(f"C{c}" for c in range(ctxs)) + "], dataSources: [" + ", ".join(f"st{c}" for c in range(ctxs)) + "], port: 3000 }")
out.append("  deployable web { platform: react, targets: api, ui: Web, design: mantine, port: 3001 }")
out.append("}")
print("\n".join(out))
