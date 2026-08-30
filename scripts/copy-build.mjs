import { readdirSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "dist");

if (!existsSync(src)) {
  console.error(`[copy-build] no dist/ directory found at ${src}; did tsc fail?`);
  process.exit(1);
}

const dirs = ["background", "core"];
for (const d of dirs) {
  const from = join(src, d);
  const to = join(root, d);
  if (!existsSync(from)) continue;
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (f.endsWith(".js") || f.endsWith(".js.map")) {
      copyFileSync(join(from, f), join(to, f));
    }
  }
}

console.log("[copy-build] mirrored dist/ into project root");
