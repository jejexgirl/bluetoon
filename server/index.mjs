import http from "node:http";
import crypto from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createStore } from "./store.mjs";
import { Sessions, AttemptLimiter, RateBucket, Semaphore, hashPassword, verifyPassword, sniffImage, securityHeaders } from "./security.mjs";
import { normalizeSite } from "./validate.mjs";
import { parseVideoId, parseChannelUrl } from "./youtube.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon" };
const PUBLIC_FILE = /^\/(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js|assets\/[\w.-]+\.(?:jpe?g|png|webp|gif|ico))$/;
const UPLOAD_FILE = /^\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp|gif))$/;
const ADMIN_FILE = /^\/_admin\/(admin\.js|admin\.css)$/;
const COOKIE = "bt_sid";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpErr = (status, message, extra) => Object.assign(new Error(message), { status, extra });

export async function createApp({ dataDir, publicDir, adminDir, defaultAuthPath, youtube, trustProxy = false, background = true, log = console }) {
  const store = await createStore({ dataDir, publicDir, defaultAuthPath });
  const sessions = new Sessions();
  const loginLimiter = new AttemptLimiter();
  const bucket = new RateBucket(300, 60e3);
  const hashSlots = new Semaphore(2);

  const ipOf = (req) => (trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "unknown";
  const isHttps = (req) => !!req.socket.encrypted || (trustProxy && req.headers["x-forwarded-proto"] === "https");
  const hostOf = (req) => (trustProxy && req.headers["x-forwarded-host"]) || req.headers.host || "";

  function send(req, res, status, body, headers = {}) {
    const h = { ...securityHeaders(isHttps(req)), ...headers };
    if (body !== undefined && typeof body === "object" && !Buffer.isBuffer(body)) { body = JSON.stringify(body); h["Content-Type"] = "application/json; charset=utf-8"; h["Cache-Control"] = "no-store"; }
    res.writeHead(status, h);
    res.end(req.method === "HEAD" ? undefined : body);
  }
  const cookieOf = (req, name) => { for (const part of String(req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); } return null; };
  const setCookie = (req, token, maxAge) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      if (Number(req.headers["content-length"] || 0) > limit) return reject(httpErr(413, "Request too large"));
      const chunks = []; let n = 0, big = false;
      req.on("data", (c) => { n += c.length; if (n > limit) { big = true; if (n > limit * 4) req.destroy(); } else chunks.push(c); });
      req.on("end", () => (big ? reject(httpErr(413, "Request too large")) : resolve(Buffer.concat(chunks))));
      req.on("error", reject);
    });
  }
  async function readJson(req, limit = 256 * 1024) {
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) throw httpErr(415, "Expected application/json");
    try { const v = JSON.parse((await readBody(req, limit)).toString("utf8")); return v && typeof v === "object" ? v : {}; } catch (e) { if (e.status) throw e; throw httpErr(400, "Invalid JSON"); }
  }

  // Authentication + CSRF protection for dashboard routes.
  function requireAuth(req, { mutating = false } = {}) {
    const token = cookieOf(req, COOKIE);
    const sess = sessions.get(token);
    if (!sess) throw httpErr(401, "Not signed in");
    if (mutating) {
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === hostOf(req); } catch { /* bad origin */ } if (!ok) throw httpErr(403, "Cross-site request blocked"); }
      const sent = String(req.headers["x-csrf-token"] || "");
      const a = Buffer.from(sent), b = Buffer.from(sess.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpErr(403, "Missing or invalid CSRF token");
    }
    return { sess, token };
  }

  const pickStats = (s) => (s ? { views: s.views, duration: s.duration, published: s.published } : {});
  const siteView = (includeHidden) => {
    const s = store.site;
    return { brand: s.brand, theme: s.theme, channels: s.channels, services: s.services, about: s.about, accounts: s.accounts, videos: s.videos.filter((v) => includeHidden || !v.hidden).map((v) => ({ ...v, ...pickStats(store.stats[v.id]) })) };
  };

  async function refreshStats(ids) {
    let ok = 0, failed = 0; const queue = [...ids];
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (let id; (id = queue.shift());) { try { await store.setStats(id, await youtube.videoInfo(id)); ok++; } catch { failed++; } }
    }));
    return { ok, failed };
  }

  async function saveUpload(buf) {
    const kind = sniffImage(buf);
    if (!kind) throw httpErr(400, "That file is not a JPG, PNG, WebP or GIF image");
    if ((await readdir(store.uploadsDir)).length >= 300) throw httpErr(400, "Upload folder is full");
    const name = `${crypto.randomBytes(12).toString("hex")}.${kind.ext}`;
    await writeFile(join(store.uploadsDir, name), buf, { mode: 0o600 });
    return `uploads/${name}`;
  }

  async function api(req, res, url) {
    const ip = ipOf(req), m = req.method, p = url.pathname;
    if (!bucket.hit(ip)) throw httpErr(429, "Too many requests");

    if (m === "GET" && p === "/api/site") return send(req, res, 200, siteView(false));

    if (m === "GET" && p === "/api/me") {
      const sess = sessions.get(cookieOf(req, COOKIE));
      return send(req, res, 200, sess ? { authenticated: true, csrf: sess.csrf } : { authenticated: false });
    }

    if (m === "POST" && p === "/api/login") {
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === hostOf(req); } catch { /* ignore */ } if (!ok) throw httpErr(403, "Cross-site request blocked"); }
      const gate = loginLimiter.check(ip);
      if (gate.blocked) return send(req, res, 429, { error: "Too many attempts. Try again later.", retry: gate.retry }, { "Retry-After": String(gate.retry) });
      const body = await readJson(req, 4096);
      const ok = typeof body.password === "string" && body.password.length > 0 && body.password.length <= 200 && (await hashSlots.run(() => verifyPassword(body.password, store.auth)));
      if (!ok) {
        const fails = loginLimiter.fail(ip);
        log.warn?.(`[security] failed login from ${ip} at ${new Date().toISOString()}`);
        await sleep(Math.min(250 * fails, 1500));
        return send(req, res, 401, { error: "Wrong password" });
      }
      loginLimiter.success(ip);
      const { token, csrf } = sessions.create();
      return send(req, res, 200, { ok: true, csrf }, { "Set-Cookie": setCookie(req, token, 12 * 3600) });
    }

    if (m === "POST" && p === "/api/logout") {
      const { token } = requireAuth(req, { mutating: true });
      sessions.destroy(token);
      return send(req, res, 200, { ok: true }, { "Set-Cookie": setCookie(req, "", 0) });
    }

    if (m === "GET" && p === "/api/admin/site") {
      requireAuth(req);
      return send(req, res, 200, { rev: store.rev, site: siteView(true) });
    }

    if (m === "PUT" && p === "/api/site") {
      requireAuth(req, { mutating: true });
      const body = await readJson(req, 512 * 1024);
      if (body.rev !== store.rev) return send(req, res, 409, { error: "The site was changed somewhere else. Reload the dashboard to continue.", rev: store.rev });
      const { value, errors } = normalizeSite(body.site);
      if (!value) return send(req, res, 400, { error: "Some values are not valid", errors });
      const rev = await store.saveSite(value);
      store.gcUploads().catch(() => {});
      return send(req, res, 200, { rev, site: siteView(true) });
    }

    if (m === "POST" && p === "/api/video-info") {
      requireAuth(req, { mutating: true });
      const body = await readJson(req, 16 * 1024);
      const inputs = Array.isArray(body.inputs) ? body.inputs.slice(0, 20) : [];
      const results = [];
      for (const input of inputs) {
        const id = parseVideoId(typeof input === "string" ? input.slice(0, 300) : "");
        if (!id) { results.push({ input, ok: false, error: "Not a YouTube video link" }); continue; }
        try { const info = await youtube.videoInfo(id); await store.setStats(id, info); results.push({ input, ok: true, id, info }); }
        catch (e) { results.push({ input, ok: false, id, error: String(e.message || "Could not read this video").slice(0, 200) }); }
      }
      return send(req, res, 200, { results });
    }

    if (m === "POST" && p === "/api/channel-info") {
      requireAuth(req, { mutating: true });
      const body = await readJson(req, 4096);
      const chUrl = parseChannelUrl(String(body.url || "").slice(0, 300));
      if (!chUrl) throw httpErr(400, "That is not a YouTube channel link");
      let info;
      try { info = await youtube.channelInfo(chUrl); } catch (e) { throw httpErr(400, String(e.message || "Could not read this channel").slice(0, 200)); }
      let avatar = null;
      if (info.imageUrl) { try { avatar = await saveUpload(await youtube.downloadImage(info.imageUrl)); } catch { /* avatar can be uploaded by hand */ } }
      return send(req, res, 200, { name: info.name, handle: info.handle, url: info.url, blurb: info.blurb, avatar });
    }

    if (m === "POST" && p === "/api/refresh-stats") {
      requireAuth(req, { mutating: true });
      const r = await refreshStats(store.site.videos.map((v) => v.id));
      return send(req, res, 200, { ...r, site: siteView(true) });
    }

    if (m === "POST" && p === "/api/upload") {
      requireAuth(req, { mutating: true });
      if (!/^image\//i.test(req.headers["content-type"] || "")) throw httpErr(415, "Send an image file");
      return send(req, res, 200, { path: await saveUpload(await readBody(req, 4 * 1024 * 1024)) });
    }

    if (m === "POST" && p === "/api/password") {
      const { token } = requireAuth(req, { mutating: true });
      const gate = loginLimiter.check("pw:" + ip);
      if (gate.blocked) return send(req, res, 429, { error: "Too many attempts. Try again later.", retry: gate.retry });
      const body = await readJson(req, 4096);
      const okCurrent = typeof body.current === "string" && (await hashSlots.run(() => verifyPassword(body.current, store.auth)));
      if (!okCurrent) { loginLimiter.fail("pw:" + ip); await sleep(500); return send(req, res, 401, { error: "Current password is wrong" }); }
      if (typeof body.next !== "string" || body.next.length < 12 || body.next.length > 200) throw httpErr(400, "The new password must be 12 to 200 characters");
      if (body.next === body.current) throw httpErr(400, "The new password must be different");
      await store.saveAuth(await hashSlots.run(() => hashPassword(body.next)));
      sessions.destroyAllExcept(token);
      return send(req, res, 200, { ok: true });
    }

    throw httpErr(404, "Not found");
  }

  async function serveFile(req, res, path, { immutable = false } = {}) {
    let data;
    try { data = await readFile(path); } catch { return send(req, res, 404, "Not found", { "Content-Type": "text/plain" }); }
    return send(req, res, 200, data, { "Content-Type": TYPES[extname(path).toLowerCase()] || "application/octet-stream", "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  }

  const server = http.createServer(async (req, res) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(req, res, 400, "Bad request", { "Content-Type": "text/plain" }); }
      const url = new URL(req.url, "http://x");
      if (pathname.startsWith("/api/")) { url.pathname = pathname; return await api(req, res, url); }
      if (req.method !== "GET" && req.method !== "HEAD") return send(req, res, 405, "Method not allowed", { "Content-Type": "text/plain", Allow: "GET, HEAD" });
      if (pathname === "/") pathname = "/index.html";
      if (PUBLIC_FILE.test(pathname)) return await serveFile(req, res, join(publicDir, pathname));
      let mm;
      if ((mm = UPLOAD_FILE.exec(pathname))) return await serveFile(req, res, join(store.uploadsDir, mm[1]), { immutable: true });
      if ((mm = ADMIN_FILE.exec(pathname))) {
        try { requireAuth(req); } catch { return send(req, res, 404, "Not found", { "Content-Type": "text/plain" }); }
        return await serveFile(req, res, join(adminDir, mm[1]));
      }
      return send(req, res, 404, "Not found", { "Content-Type": "text/plain" });
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.status) return send(req, res, e.status, { error: e.message, ...(e.extra || {}) });
      log.error?.("[error]", e);
      return send(req, res, 500, { error: "Server error" });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 60;

  const timers = [setInterval(() => { sessions.sweep(); loginLimiter.sweep(); bucket.sweep(); }, 60e3)];
  if (background) {
    const run = () => refreshStats(store.site.videos.map((v) => v.id)).then((r) => log.info?.(`[stats] refreshed ${r.ok} video(s), ${r.failed} failed`)).catch(() => {});
    timers.push(setTimeout(run, 5000), setInterval(run, 6 * 3600e3));
  }
  timers.forEach((t) => t.unref?.());

  return { server, store, sessions, close: () => new Promise((r) => { timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); server.close(() => r()); server.closeAllConnections?.(); }) };
}
