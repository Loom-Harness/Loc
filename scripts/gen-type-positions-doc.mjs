// Regenerate the type-position table in `docs/language-reference/04-type-system.md`
// from `src/language/type-positions.ts`.  The rendering lives in
// `src/system/type-positions-doc.ts` so the same function backs this writer and
// the drift test.
//
//   npm run docs:types      # = npm run build && node scripts/gen-type-positions-doc.mjs

import fs from "node:fs";
import path from "node:path";
import { withTypePositionsBlock } from "../out/system/type-positions-doc.js";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const docPath = path.join(repoRoot, "docs/language-reference/04-type-system.md");

fs.writeFileSync(docPath, withTypePositionsBlock(fs.readFileSync(docPath, "utf8")), "utf8");
console.log(`Wrote ${path.relative(repoRoot, docPath)}`);
