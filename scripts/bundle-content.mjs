import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/content/content.ts"],
  outfile: "content/content.js",
  bundle: true,
  format: "iife",
  target: "chrome114",
  sourcemap: true,
  logLevel: "info",
});

console.log("[bundle] content/content.js");
