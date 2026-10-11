// Runs inside GitHub Actions (every 6 hours and after each dashboard save).
// Fills in what a browser cannot read from YouTube: video titles, channel names, view counts, durations
// and channel logos. Anything you typed by hand is never overwritten.
//   node scripts/refresh.mjs        (set YT_API_KEY for the most reliable view counts)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { normalizeSite } from "../server/validate.mjs";
import { createYoutube } from "../server/youtube.mjs";
import { sniffImage } from "../server/security.mjs";

const norm = (t) => (t || "").toLowerCase().replace(/[\s|]+/g, "");
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; } };

export async function refresh({ root, youtube, now = Date.now(), maxAgeMs = 5 * 3600e3, log = console.log }) {
  const siteFile = join(root, "data", "site.json"), statsFile = join(root, "data", "stats.json");
  const uploads = join(root, "public", "uploads");
  const doc = await readJson(siteFile, null);
  if (!doc || !doc.site) throw new Error("data/site.json is missing. Run: node scripts/seed.mjs");
  const site = doc.site;
  const stats = await readJson(statsFile, {});
  const before = JSON.stringify(site), statsBefore = JSON.stringify(stats);
  const summary = { videos: 0, failedVideos: 0, channels: 0 };

  const matchChannel = (name, url) => {
    const n = norm(name);
    const c = site.channels.find((x) => (url && x.url === url) || (n && (n === norm(x.name) || (x.handle && n.includes(norm(x.handle.replace(/^@/, "")))))));
    return c ? c.id : null;
  };

  // Videos: new ones, ones without a title, and ones whose numbers are older than maxAgeMs.
  const need = site.videos.filter((v) => !v.title || !stats[v.id] || now - (stats[v.id].fetchedAt || 0) > maxAgeMs);
  const queue = [...need];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let v; (v = queue.shift());) {
      try {
        const info = await youtube.videoInfo(v.id);
        const s = { ...stats[v.id], fetchedAt: now };
        if (Number.isFinite(info.views)) s.views = info.views;
        if (Number.isFinite(info.duration)) s.duration = info.duration;
        if (typeof info.published === "string") s.published = info.published;
        stats[v.id] = s;
        if (!v.title && info.title) v.title = info.title;
        if (!v.channelName && info.channelName) v.channelName = info.channelName;
        if (!v.channelUrl && info.channelUrl) v.channelUrl = info.channelUrl;
        if (!v.channelId) v.channelId = matchChannel(v.channelName, v.channelUrl);
        summary.videos++;
      } catch (e) { summary.failedVideos++; log(`video ${v.id}: ${e.message}`); }
    }
  }));
  for (const id of Object.keys(stats)) if (!site.videos.some((v) => v.id === id)) delete stats[id];

  // Channels that were added from a link and still have no logo.
  for (const c of site.channels) {
    if (c.avatar || !(c.name === c.handle || !c.blurb)) continue;
    try {
      const info = await youtube.channelInfo(c.url);
      if (!c.name || c.name === c.handle) c.name = info.name || c.name;
      if (!c.handle) c.handle = info.handle || "";
      if (!c.blurb) c.blurb = info.blurb || "";
      if (c.monogram === (c.handle || "").slice(0, 2) || !c.monogram) c.monogram = c.name.slice(0, 2);
      if (info.imageUrl) {
        const buf = await youtube.downloadImage(info.imageUrl);
        const kind = sniffImage(buf);
        if (kind) {
          await mkdir(uploads, { recursive: true });
          const name = `${randomBytes(12).toString("hex")}.${kind.ext}`;
          await writeFile(join(uploads, name), buf);
          c.avatar = `uploads/${name}`;
        }
      }
      summary.channels++;
    } catch (e) { log(`channel ${c.name}: ${e.message}`); }
  }
  for (const v of site.videos) if (!v.channelId) v.channelId = matchChannel(v.channelName, v.channelUrl);

  if (JSON.stringify(stats) !== statsBefore) await writeFile(statsFile, JSON.stringify(stats, null, 2) + "\n");
  if (JSON.stringify(site) !== before) {
    const { value, errors } = normalizeSite(site);
    if (!value) log("Not saving site changes, they would be invalid: " + errors.join("; "));
    else await writeFile(siteFile, JSON.stringify({ rev: (doc.rev || 0) + 1, site: value }, null, 2) + "\n");
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const s = await refresh({ root, youtube: createYoutube() });
  console.log(`Updated ${s.videos} video(s) (${s.failedVideos} could not be read), ${s.channels} channel(s).`);
}
