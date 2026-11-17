import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The `extern-user-path` build case shared by the frontend build harnesses.
 *
 * The documented extern forms name a module in the framework's OWN source
 * directories — `component RiskBadge(...) extern from "./components/RiskBadge"`
 * and `function fmt(...) extern from "./lib/fmt"`.  Loom's shims live in the
 * machine-owned `_extern/` directories, so generating must leave those user
 * modules untouched.  The case plays the user: it writes the hand-written
 * modules into the project directory BEFORE `ddd generate system` runs into
 * the same out dir, hashes them, and after generating checks every hash is
 * unchanged — then the harness builds the project, which proves the shims
 * resolve to (and type-check against) the user's modules.
 */

export type ExternUserPathFramework = "react" | "vue" | "svelte" | "angular";

/** SvelteKit resolves a `.svelte` module only by its full file name, so the
 *  Svelte case names the extension in its `from` path. */
const COMPONENT_FROM: Record<ExternUserPathFramework, string> = {
  react: "./components/RiskBadge",
  vue: "./components/RiskBadge.vue",
  svelte: "./components/RiskBadge.svelte",
  angular: "./components/RiskBadge",
};

/** The `.ddd` source: one extern component and one extern function, both at
 *  the documented user paths, both used on a page. */
export function externUserPathSource(framework: ExternUserPathFramework): string {
  return `
    system Shop {
      subdomain Sales {
        context Orders {
          aggregate Customer with crudish {
            name: string
          }
        }
      }
      ui WebApp {
        framework: ${framework}
        component RiskBadge(score: int, label: string) extern from "${COMPONENT_FROM[framework]}"
        function fmt(x: int): string extern from "./lib/fmt"
        page Home {
          route: "/"
          title: "Home"
          body: Stack {
            RiskBadge { score: 3, label: "risk" },
            Text { fmt(3) }
          }
        }
      }
      storage primary { type: postgres }
      resource ordersState { for: Orders, kind: state, use: primary }
      deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
      deployable web { platform: web, targets: api, ui: WebApp, port: 3003 }
    }
  `;
}

const FMT = `import type { FmtFn } from "./_extern/fmt.signature";

export const fmt: FmtFn = (x) => \`#\${x}\`;
`;

/** The hand-written modules, by path relative to the project directory. */
export function externUserModules(
  framework: ExternUserPathFramework,
): Readonly<Record<string, string>> {
  switch (framework) {
    case "react":
      return {
        "src/components/RiskBadge.tsx": `import type { RiskBadgeProps } from "./_extern/RiskBadge.props";

export default function RiskBadge({ score, label }: RiskBadgeProps) {
  return (
    <span data-testid="risk-badge">
      {label}: {score}
    </span>
  );
}
`,
        "src/lib/fmt.ts": FMT,
      };
    case "vue":
      return {
        "src/components/RiskBadge.vue": `<script setup lang="ts">
import type { RiskBadgeProps } from "./_extern/RiskBadge.props";

const props = defineProps<RiskBadgeProps>();
</script>

<template>
  <span data-testid="risk-badge">{{ props.label }}: {{ props.score }}</span>
</template>
`,
        "src/lib/fmt.ts": FMT,
      };
    case "svelte":
      return {
        "src/components/RiskBadge.svelte": `<script lang="ts">
  import type { RiskBadgeProps } from "../lib/components/_extern/RiskBadge.props";

  const { score, label }: RiskBadgeProps = $props();
</script>

<span data-testid="risk-badge">{label}: {score}</span>
`,
        "src/lib/fmt.ts": FMT,
      };
    case "angular":
      return {
        "src/components/RiskBadge.ts": `import { Component, Input } from "@angular/core";
import type { RiskBadgeProps } from "./_extern/RiskBadge.props";

@Component({
  selector: "app-risk-badge",
  standalone: true,
  template: \`<span data-testid="risk-badge">{{ label }}: {{ score }}</span>\`,
})
export class RiskBadge implements RiskBadgeProps {
  @Input() score = 0;
  @Input() label = "";
}
`,
        "src/lib/fmt.ts": FMT,
      };
  }
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Write the user modules under `projectDir` and return their hashes. */
export function seedExternUserModules(
  projectDir: string,
  modules: Readonly<Record<string, string>>,
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const [rel, content] of Object.entries(modules)) {
    const file = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    hashes.set(rel, sha256(file));
  }
  return hashes;
}

/** Throw unless every seeded user module still exists byte-for-byte. */
export function assertExternUserModulesUnchanged(
  projectDir: string,
  hashes: ReadonlyMap<string, string>,
): void {
  const changed = [...hashes].filter(([rel, hash]) => {
    const file = path.join(projectDir, rel);
    return !fs.existsSync(file) || sha256(file) !== hash;
  });
  if (changed.length > 0) {
    throw new Error(
      `ddd generate system rewrote the user's hand-written extern module(s): ` +
        `${changed.map(([rel]) => rel).join(", ")} — an extern shim landed on the user's path.`,
    );
  }
}
