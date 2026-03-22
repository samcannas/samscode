import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  platform: "node",
  external: ["naudiodon", "clipboardy", "@nut-tree/nut-js"],
  esbuildOptions(options) {
    options.external = [...(options.external ?? []), "naudiodon", "clipboardy", "@nut-tree/nut-js"];
  },
});
