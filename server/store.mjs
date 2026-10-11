// File-based storage with atomic writes and automatic backups.
import { mkdir, readFile, writeFile, rename, copyFile, readdir, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { normalizeSite } from "./validate.mjs";

async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
}

export async function createStore({ dataDir, publicDir, defaultAuthPath }) {
  const files = { site: join(dataDir, "site.json"), stats: join(dataDir, "stats.json"), auth: join(dataDir, "auth.json") };
  const uploadsDir = join(dataDir, "uploads"), backupsDir = join(dataDir, "backups");
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(backupsDir, { recursive: true });

  // First run: seed the site from the defaults in public/js/config.js.
  if (!existsSync(files.site)) {
    const ctx = { window: {} };
    vm.runInNewContext(await readFile(join(publicDir, "js", "config.js"), "utf8"), ctx, { timeout: 1000 });
    const { value, errors } = normalizeSite(JSON.parse(JSON.stringify(ctx.window.PORTFOLIO)));
    if (!value) throw new Error("Default config is invalid: " + errors.join("; "));
    await writeAtomic(files.site, JSON.stringify({ rev: 1, site: value }, null, 2));
  }
  // First run: the password hash. INITIAL_PASSWORD (if set) wins, otherwise the shipped hash is used.
  if (!existsSync(files.auth)) {
    if (process.env.INITIAL_PASSWORD) {
      const { hashPassword } = await import("./security.mjs");
      await writeAtomic(files.auth, JSON.stringify(await hashPassword(process.env.INITIAL_PASSWORD), null, 2));
    } else if (existsSync(defaultAuthPath)) {
      await copyFile(defaultAuthPath, files.auth);
    } else {
      throw new Error("No password is set up yet. Start once with INITIAL_PASSWORD=your-long-password (see README).");
    }
  }

  let current = JSON.parse(await readFile(files.site, "utf8"));
  let stats = existsSync(files.stats) ? JSON.parse(await readFile(files.stats, "utf8")) : {};
  let auth = JSON.parse(await readFile(files.auth, "utf8"));

  return {
    uploadsDir,
    get rev() { return current.rev; },
    get site() { return current.site; },
    get stats() { return stats; },
    get auth() { return auth; },
    async saveSite(site) {
      try { await copyFile(files.site, join(backupsDir, `site-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)); } catch { /* first save */ }
      const old = (await readdir(backupsDir)).filter((f) => f.startsWith("site-")).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 30))) await unlink(join(backupsDir, f)).catch(() => {});
      current = { rev: current.rev + 1, site };
      await writeAtomic(files.site, JSON.stringify(current, null, 2));
      return current.rev;
    },
    async setStats(id, info) {
      const s = {};
      if (Number.isFinite(info.views)) s.views = info.views;
      if (Number.isFinite(info.duration)) s.duration = info.duration;
      if (typeof info.published === "string") s.published = info.published;
      if (!Object.keys(s).length) return;
      stats = { ...stats, [id]: { ...stats[id], ...s, fetchedAt: Date.now() } };
      await writeAtomic(files.stats, JSON.stringify(stats));
    },
    async saveAuth(rec) { auth = rec; await writeAtomic(files.auth, JSON.stringify(rec, null, 2)); },
    // Remove uploaded images that no saved setting references any more (and are older than an hour).
    async gcUploads() {
      const used = new Set();
      const s = current.site;
      [s.brand.logo, ...s.channels.flatMap((c) => [c.avatar, c.banner])].forEach((p) => p && used.add(p.replace(/^uploads\//, "")));
      for (const f of await readdir(uploadsDir)) {
        if (used.has(f)) continue;
        const st = await stat(join(uploadsDir, f)).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 3600e3) await unlink(join(uploadsDir, f)).catch(() => {});
      }
    },
  };
}
