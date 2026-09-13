import { promises as fs } from "node:fs";
import * as path from "node:path";

// objectStore 'dispatchPhotos' — local-directory store (raw bytes + sidecar meta).
export const dispatchPhotosDir = process.env.DISPATCH_PHOTOS_URL_DIR ?? path.join(process.cwd(), "data", "dispatchPhotos");

function dispatchPhotos$path(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(dispatchPhotosDir, safe);
}

export async function dispatchPhotos$put(key: string, body: unknown): Promise<void> {
  await dispatchPhotos$putBytes(key, Buffer.from(JSON.stringify(body)), "application/json");
}

export async function dispatchPhotos$get(key: string): Promise<unknown> {
  const obj = await dispatchPhotos$getBytes(key);
  return obj ? JSON.parse(Buffer.from(obj.body).toString("utf8")) : null;
}

export async function dispatchPhotos$list(prefix: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dispatchPhotosDir);
    return names.filter((n) => !n.endsWith(".meta.json") && n.startsWith(prefix));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

export async function dispatchPhotos$delete(key: string): Promise<void> {
  await fs.rm(dispatchPhotos$path(key), { force: true });
  await fs.rm(dispatchPhotos$path(key) + ".meta.json", { force: true });
}

export async function dispatchPhotos$putBytes(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await fs.mkdir(dispatchPhotosDir, { recursive: true });
  await fs.writeFile(dispatchPhotos$path(key), body);
  await fs.writeFile(dispatchPhotos$path(key) + ".meta.json", JSON.stringify({ contentType, size: body.byteLength }));
}

export async function dispatchPhotos$getBytes(key: string): Promise<{ body: Uint8Array; contentType: string; size: number } | null> {
  try {
    const body = await fs.readFile(dispatchPhotos$path(key));
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await fs.readFile(dispatchPhotos$path(key) + ".meta.json", "utf8")) as { contentType?: string };
      if (meta.contentType) contentType = meta.contentType;
    } catch { /* no sidecar — fall back to octet-stream */ }
    return { body, contentType, size: body.byteLength };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

