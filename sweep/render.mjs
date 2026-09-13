// Render a probe model variant: substitute the deployable axes only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORTS = { node: 3000, "node@v4": 3000, dotnet: 8080, elixir: 4000, python: 8000, java: 8081 };

export function render(tmpl, { backend, frontend, design, framework }, outPath) {
  let s = readFileSync(tmpl, "utf8");
  const port = PORTS[backend] ?? 3000;
  const platLit = backend.includes("@") ? `"${backend}"` : backend;
  s = s.replaceAll("__BACKEND__", platLit).replaceAll("__BACKEND_PORT__", String(port));
  s = s.replaceAll("__FRONTEND__", frontend ?? "react");
  // design: / framework: are optional lines injected into the frontend deployable.
  const extra = [];
  if (design) extra.push(`    design: ${design}`);
  s = s.replace("__FRONTEND_EXTRA__", extra.join("\n"));
  if (framework) s = s.replace("__UI_FRAMEWORK__", `  framework: ${framework}\n`);
  else s = s.replace("__UI_FRAMEWORK__", "");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, s);
  return outPath;
}

if (process.argv[1].endsWith("render.mjs")) {
  const [tmpl, out, backend, frontend, design, framework] = process.argv.slice(2);
  render(tmpl, { backend, frontend, design, framework }, out);
  console.log(out);
}
