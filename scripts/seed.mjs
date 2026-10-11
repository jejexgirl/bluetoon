// Creates data/site.json from the defaults in public/js/config.js (only if it does not exist yet).
//   node scripts/seed.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { normalizeSite } from "../server/validate.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const target = join(root, "data", "site.json");
if (existsSync(target)) { console.log("data/site.json already exists, nothing to do."); process.exit(0); }
const ctx = { window: {} };
vm.runInNewContext(await readFile(join(root, "public", "js", "config.js"), "utf8"), ctx, { timeout: 1000 });
const { value, errors } = normalizeSite(JSON.parse(JSON.stringify(ctx.window.PORTFOLIO)));
if (!value) { console.error("Default config is invalid:", errors.join("; ")); process.exit(1); }
await mkdir(join(root, "data"), { recursive: true });
await writeFile(target, JSON.stringify({ rev: 1, site: value }, null, 2) + "\n");
console.log("Created data/site.json");
