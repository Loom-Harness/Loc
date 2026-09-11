import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Play the USER for every `function f(...) extern from "<path>"` the example
 * declares.
 *
 * The frontend extern hatch splits ownership deliberately: Loom writes the
 * typed signature (`src/lib/extern/<f>.signature.ts`) and the conformance shim
 * (`src/lib/<f>.ts`, which does `import { f as _impl } from "../<path>"`), and
 * the USER writes the module at `<path>` — see
 * `src/generator/_frontend/extern-functions.ts`.  `ddd generate system` writes
 * a whole tree and nothing else; there is no seam through which an example can
 * ship a hand-written source file.  So `examples/showcase.ddd`, which declares
 * `function initials(name: string): string extern from "./helpers"` to cover
 * the UiFunction surface, generates a `console_web` whose `npm run build`
 * (`tsc --noEmit && vite build`) cannot pass:
 *
 *     src/lib/initials.ts(3,35): error TS2307: Cannot find module '../helpers'
 *
 * — which is what killed `docker compose build` (target console_web) in every
 * conformance-full run from 2026-09-08 onward.  The gate was not red before
 * that because it was SKIPPING, not because the tree built.
 *
 * The harness therefore does what a real user does: writes the module.  The
 * bodies throw — showcase declares `initials` but never calls it, so the only
 * thing under test is that the shim's import resolves and the signature
 * conforms.  A `never`-returning body satisfies any declared return type, so
 * this stays generic: a second extern needs no change here.
 *
 * If the example ever drops its extern declarations this writes nothing and
 * the build is unaffected; the failure mode worth defending against is the
 * opposite one — a shim this cannot parse — and that throws below rather than
 * silently skipping.
 *
 * @returns how many user modules were written.
 */
export function writeExternUserModules(outDir: string): number {
  // name of the shim's export + the module path the user owns, per shim file.
  const shimImport = /^import \{ (\w+) as _impl \} from "\.\.\/(.+)";$/m;
  let written = 0;
  for (const sub of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const libDir = path.join(outDir, sub.name, "src", "lib");
    if (!fs.existsSync(libDir)) continue;
    // module path (relative to src/) → the extern names it must export
    const byModule = new Map<string, string[]>();
    for (const file of fs.readdirSync(libDir)) {
      if (!file.endsWith(".ts")) continue;
      const text = fs.readFileSync(path.join(libDir, file), "utf8");
      if (!text.includes("AUTO-GENERATED shim")) continue;
      const m = shimImport.exec(text);
      if (!m) {
        // The shim's import line changed shape.  Silence here would let the
        // user module go unwritten and put the TS2307 back into the docker
        // build, twenty minutes later and one layer down.
        throw new Error(
          `extern shim ${sub.name}/src/lib/${file} did not match the expected ` +
            `\`import { <name> as _impl } from "../<path>";\` line — update ` +
            `writeExternUserModules() to match the emitter.`,
        );
      }
      const [, name, rel] = m;
      byModule.set(rel, [...(byModule.get(rel) ?? []), name]);
    }
    for (const [rel, names] of byModule) {
      const target = path.join(outDir, sub.name, "src", `${rel}.ts`);
      if (fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const sigDir = path.relative(
        path.dirname(target),
        path.join(outDir, sub.name, "src", "lib", "extern"),
      );
      const body = names
        .map((n) => {
          const Fn = `${n[0].toUpperCase()}${n.slice(1)}Fn`;
          const sig = `${sigDir.startsWith(".") ? sigDir : `./${sigDir}`}/${n}.signature`;
          return (
            `import type { ${Fn} } from "${sig.split(path.sep).join("/")}";\n` +
            `export const ${n}: ${Fn} = () => {\n` +
            `  throw new Error("extern '${n}' is not implemented by the conformance fixture");\n` +
            `};\n`
          );
        })
        .join("\n");
      fs.writeFileSync(
        target,
        `// Written by test/e2e/e2e.test.ts — the USER half of the frontend extern\n` +
          `// hatch, which Loom deliberately never writes.  See writeExternUserModules().\n` +
          body,
      );
      written++;
    }
  }
  return written;
}
