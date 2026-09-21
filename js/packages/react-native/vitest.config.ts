import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "react-native": fileURLToPath(new URL("./test/react-native.mock.ts", import.meta.url)) } },
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 15000 },
});
