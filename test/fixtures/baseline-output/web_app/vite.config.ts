// Auto-generated.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A native run (`npm run dev` / `npm run preview`) serves on the deployable's
// declared port, and PORT overrides it; the image passes its own `--port`.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const port = Number(env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: { port, host: true, proxy: { "/api": env.VITE_API_PROXY_TARGET ?? "http://localhost:8080" } },
  preview: { port, host: true, proxy: { "/api": env.VITE_API_PROXY_TARGET ?? "http://localhost:8080" } },
});
