#!/usr/bin/env node
// The toolchain's dependencies need Node >= 22.12 (commander's floor; chevrotain
// calls `Object.groupBy`, which Node 20 lacks).  Check before importing them so
// an older Node gets one clear line instead of a parser stack trace.  Keep this
// file free of syntax or APIs newer than Node 14 so the check itself runs.
var MIN_NODE = [22, 12];
var have = process.versions.node.split(".").map(Number);
if (have[0] < MIN_NODE[0] || (have[0] === MIN_NODE[0] && have[1] < MIN_NODE[1])) {
  console.error(
    "ddd: Loom requires Node " + MIN_NODE.join(".") + " or newer; this is Node " +
      process.versions.node + ". Upgrade Node (e.g. `nvm install 22`) and re-run.",
  );
  process.exit(1);
}
import("../out/cli/main.js").catch((err) => {
  console.error(err);
  process.exit(1);
});
