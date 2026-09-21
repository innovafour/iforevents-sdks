import { defineConfig } from "tsup";
export default defineConfig([
  { entry: { index: "src/index.ts" }, format: ["esm", "cjs"], dts: true, clean: true, target: "es2020", external: ["@iforevents/core"] },
  { entry: { "iforevents.iife": "src/iife.ts" }, format: ["iife"], globalName: "Iforevents", footer: { js: "Iforevents = Iforevents.Iforevents;" }, minify: true, target: "es2018", noExternal: [/.*/], platform: "browser", outExtension: () => ({ js: ".js" }) },
]);
