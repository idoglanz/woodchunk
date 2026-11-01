import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only; the browser tests in e2e/ run with Playwright.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
