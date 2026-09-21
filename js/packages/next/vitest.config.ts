import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "next/navigation": fileURLToPath(new URL("./test/next-navigation.mock.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["test/**/*.test.tsx"], testTimeout: 15000 },
});
