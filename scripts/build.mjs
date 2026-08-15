import { chmod, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const outputDirectory = resolve("plugin", "dist");

await rm(outputDirectory, { recursive: true, force: true });
await build({
  entryPoints: {
    "stop-hook": resolve("src", "hook", "command.ts"),
    configure: resolve("src", "config", "command.ts"),
    "pi-extension": resolve("src", "pi", "extension.ts"),
  },
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "none",
  outdir: outputDirectory,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
});

await Promise.all([
  chmod(resolve(outputDirectory, "stop-hook.mjs"), 0o755),
  chmod(resolve(outputDirectory, "configure.mjs"), 0o755),
]);
