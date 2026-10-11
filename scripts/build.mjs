// Builds the folder that GitHub Pages publishes (_site).
//   node scripts/build.mjs
// It copies public/, adds the dashboard files under _admin/, writes the public data/site.json
// (hidden videos removed, view counts merged in) and adds a Content-Security-Policy to index.html.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CSP } from "../server/security.mjs";

// Static hosting cannot send headers, so the same policy goes in a <meta> tag
// (it allows GitHub's API for the dashboard; frame-ancestors only works as a header).
export const PAGES_CSP = CSP.split("; ")
  .filter((d) => !d.startsWith("frame-ancestors"))
  .map((d) => (d.startsWith("connect-src") ? "connect-src 'self' https://api.github.com" : d.startsWith("img-src") ? d + " blob:" : d))
  .join("; ");

const pick = (s) => (s ? { views: s.views, duration: s.duration, published: s.published } : {});

export async function build({ root, out }) {
  await rm(out, { recursive: true, force: true });
  await cp(join(root, "public"), out, { recursive: true });
  const admin = join(out, "_admin");
  await mkdir(admin, { recursive: true });
  for (const [from, to] of [["admin/admin.js", "admin.js"], ["admin/admin.css", "admin.css"], ["admin/github-api.js", "github-api.js"], ["server/validate.mjs", "validate.mjs"], ["server/youtube.mjs", "youtube.mjs"]]) {
    await cp(join(root, from), join(admin, to));
  }
  const doc = JSON.parse(await readFile(join(root, "data", "site.json"), "utf8"));
  let stats = {};
  try { stats = JSON.parse(await readFile(join(root, "data", "stats.json"), "utf8")); } catch { /* none yet */ }
  const s = doc.site;
  const pub = { brand: s.brand, theme: s.theme, channels: s.channels, services: s.services, about: s.about, accounts: s.accounts, videos: s.videos.filter((v) => !v.hidden).map((v) => ({ ...v, ...pick(stats[v.id]) })) };
  await mkdir(join(out, "data"), { recursive: true });
  await writeFile(join(out, "data", "site.json"), JSON.stringify(pub));
  const idx = join(out, "index.html");
  const html = await readFile(idx, "utf8");
  if (!/<head>/i.test(html)) throw new Error("index.html has no <head>");
  await writeFile(idx, html.replace(/<head>/i, `<head>\n<meta http-equiv="Content-Security-Policy" content="${PAGES_CSP}">`));
  await writeFile(join(out, ".nojekyll"), "");
  return { videos: pub.videos.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const r = await build({ root, out: join(root, "_site") });
  console.log(`Built _site with ${r.videos} visible video(s).`);
}
