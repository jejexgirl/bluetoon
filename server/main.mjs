// Entry point:  node server/main.mjs
// Environment: PORT (default 8080), HOST, DATA_DIR (default ./data), TRUST_PROXY=1 behind a reverse proxy,
// YT_API_KEY (optional, YouTube Data API v3), INITIAL_PASSWORD (only used on the very first start).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./index.mjs";
import { createYoutube } from "./youtube.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

const app = await createApp({
  dataDir: resolve(process.env.DATA_DIR || resolve(root, "data")),
  publicDir: resolve(root, "public"),
  adminDir: resolve(root, "admin"),
  defaultAuthPath: resolve(root, "server", "default-auth.json"),
  youtube: createYoutube(),
  trustProxy: process.env.TRUST_PROXY === "1",
});
app.server.listen(port, host, () => {
  console.log(`BlueToon portfolio running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}  (Ctrl+C to stop)`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.close().then(() => process.exit(0)));
