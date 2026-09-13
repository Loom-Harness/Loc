// Minimal static server with SPA fallback (no deps, no self-proxy).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
const [root, port] = [process.argv[2], Number(process.argv[3])];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon", ".map": "application/json" };
createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let p = join(root, normalize(url).replace(/^(\.\.[/\\])+/, ""));
  try { if ((await stat(p)).isDirectory()) p = join(p, "index.html"); }
  catch { p = join(root, "index.html"); }
  try {
    const buf = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); }
}).listen(port, "127.0.0.1");
