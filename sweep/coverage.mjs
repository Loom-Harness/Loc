import { WALKER_LAYOUT_PRIMITIVES, WALKER_SUB_PRIMITIVES } from "../out/util/walker-primitive-names.js";
import { readFileSync } from "node:fs";
const s = readFileSync(process.argv[2], "utf8");
const all = [...WALKER_LAYOUT_PRIMITIVES, ...WALKER_SUB_PRIMITIVES];
const missing = all.filter((p) => !new RegExp(`(^|[^A-Za-z])${p}\\s*\\{`, "m").test(s));
console.log(`primitives: ${all.length} | covered: ${all.length - missing.length}`);
if (missing.length) console.log("MISSING:", missing.join(", "));
