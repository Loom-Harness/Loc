import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, use: { ...base.use, baseURL: "http://127.0.0.1:4203", launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } } });
