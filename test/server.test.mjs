import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/index.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const fakeYoutube = {
  async videoInfo(id) { if (id === "AAAAAAAAAAA") throw new Error("video not found"); return { id, title: `Title ${id}`, channelName: "REST EXTRA", channelUrl: "https://www.youtube.com/@RESTEXTRA", views: 1234567, duration: 600, published: "2026-01-01" }; },
  async channelInfo() { return { name: "Test Channel", handle: "@test", url: "https://www.youtube.com/@test", blurb: "hi", imageUrl: "https://yt3.ggpht.com/x" }; },
  async downloadImage() { return PNG; },
};
const silent = { warn() {}, info() {}, error() {} };
// Tests seed their own throw-away password, so the real one never appears in any file.
const PASSWORD = "test-only-password-9876";
process.env.INITIAL_PASSWORD = PASSWORD;

async function start(opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "bt-"));
  const app = await createApp({ dataDir, publicDir: join(root, "public"), adminDir: join(root, "admin"), defaultAuthPath: join(root, "server", "default-auth.json"), youtube: fakeYoutube, background: false, log: silent, ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, dataDir, stop: async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
async function login(base, password = PASSWORD) {
  const res = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  const body = await res.json();
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return { res, body, cookie };
}
const authed = (base, s, method, path, body, extra = {}) => fetch(base + path, { method, headers: { "Content-Type": "application/json", Cookie: s.cookie, "X-CSRF-Token": s.body.csrf, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });

let ctx;
before(async () => { ctx = await start(); });
after(async () => { await ctx.stop(); });

test("public page and data are served with strict security headers", async () => {
  const res = await fetch(ctx.base + "/");
  assert.equal(res.status, 200);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-inline/.test(csp.match(/script-src[^;]*/)[0]), "scripts must not allow inline code");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  const site = await (await fetch(ctx.base + "/api/site")).json();
  assert.equal(site.videos.length, 15);
  assert.equal(site.rev, undefined);
  assert.ok(site.channels.length === 2 && site.accounts.length === 4);
});

test("the HTML has no inline scripts (CSP-safe)", async () => {
  const html = await (await fetch(ctx.base + "/")).text();
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "inline <script> found");
  assert.ok(!/\son\w+\s*=/.test(html), "inline event handler found");
});

test("source, data and path-traversal URLs are never served", async () => {
  const paths = ["/server/index.mjs", "/server/default-auth.json", "/data/auth.json", "/data/site.json", "/package.json", "/admin/admin.js", "/_admin/admin.js", "/_admin/admin.css",
    "/../server/main.mjs", "/%2e%2e/server/main.mjs", "/css/../../package.json", "/js/%2e%2e%2f%2e%2e%2fpackage.json", "/assets/..%2f..%2fpackage.json", "/.env", "/uploads/../auth.json", "/uploads/..%2fauth.json", "/test/server.test.mjs", "/README.md", "/css/", "/js/"];
  for (const p of paths) {
    const res = await fetch(ctx.base + p);
    assert.equal(res.status, 404, `${p} should be 404 but was ${res.status}`);
  }
});

test("wrong methods and malformed input are rejected", async () => {
  assert.equal((await fetch(ctx.base + "/", { method: "POST" })).status, 405);
  assert.equal((await fetch(ctx.base + "/api/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(ctx.base + "/api/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" })).status, 415);
  assert.equal((await fetch(ctx.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" })).status, 400);
  assert.equal((await fetch(ctx.base + "/%E0%A4%A")).status, 400);
  assert.equal((await fetch(ctx.base + "/api/nope")).status, 404);
});

test("dashboard endpoints require a session", async () => {
  for (const [m, p] of [["GET", "/api/admin/site"], ["POST", "/api/video-info"], ["POST", "/api/channel-info"], ["POST", "/api/refresh-stats"], ["POST", "/api/upload"], ["POST", "/api/password"], ["POST", "/api/logout"]]) {
    const res = await fetch(ctx.base + p, { method: m, headers: { "Content-Type": "application/json" }, body: m === "POST" ? "{}" : undefined });
    assert.equal(res.status, 401, `${m} ${p}`);
  }
  assert.deepEqual(await (await fetch(ctx.base + "/api/me")).json(), { authenticated: false });
});

test("login: cross-site origin is refused, correct password gives a hardened cookie", async () => {
  const evil = await fetch(ctx.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(evil.status, 403);
  const s = await login(ctx.base);
  assert.equal(s.res.status, 200);
  const raw = s.res.headers.get("set-cookie");
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Strict/);
  assert.ok(s.body.csrf.length > 20);
  assert.ok(!JSON.stringify(s.body).includes(PASSWORD));
});

test("saving needs the CSRF token and a same-site origin; stale revisions are rejected", async () => {
  const s = await login(ctx.base);
  const { rev, site } = await (await fetch(ctx.base + "/api/admin/site", { headers: { Cookie: s.cookie } })).json();
  const noCsrf = await fetch(ctx.base + "/api/site", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: s.cookie }, body: JSON.stringify({ rev, site }) });
  assert.equal(noCsrf.status, 403);
  const badCsrf = await authed(ctx.base, s, "PUT", "/api/site", { rev, site }, { "X-CSRF-Token": "x".repeat(32) });
  assert.equal(badCsrf.status, 403);
  const badOrigin = await authed(ctx.base, s, "PUT", "/api/site", { rev, site }, { Origin: "https://evil.example" });
  assert.equal(badOrigin.status, 403);
  const stale = await authed(ctx.base, s, "PUT", "/api/site", { rev: rev + 5, site });
  assert.equal(stale.status, 409);
  const ok = await authed(ctx.base, s, "PUT", "/api/site", { rev, site });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).rev, rev + 1);
});

test("full edit cycle persists: add video + channel + account, reorder, hide, delete", async () => {
  const s = await login(ctx.base);
  const get = async () => (await (await fetch(ctx.base + "/api/admin/site", { headers: { Cookie: s.cookie } })).json());
  let { rev, site } = await get();

  const info = await (await authed(ctx.base, s, "POST", "/api/video-info", { inputs: ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=BBBBBBBBBBB", "https://example.com/x", "AAAAAAAAAAA"] })).json();
  assert.deepEqual(info.results.map((r) => r.ok), [true, true, false, false]);

  site.videos.push({ id: "dQw4w9WgXcQ", title: "New <img src=x onerror=alert(1)> video", channelName: "REST EXTRA", channelUrl: "https://www.youtube.com/@RESTEXTRA", channelId: "restextra" });
  site.channels.push({ id: "new-ch", name: "New Channel", handle: "@new", url: "https://www.youtube.com/@new", blurb: "x", avatar: null, banner: null, monogram: "NC" });
  site.accounts.push({ id: "tt", type: "tiktok", label: "TikTok", value: "@blue", url: "https://www.tiktok.com/@blue" });
  site.videos.reverse();                      // reorder
  site.videos.find((v) => v.id === "BZ7qVfSoqbE").hidden = true;
  site.services.pop();
  let res = await authed(ctx.base, s, "PUT", "/api/site", { rev, site });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));

  const pub = await (await fetch(ctx.base + "/api/site")).json();
  assert.equal(pub.videos.length, 15, "16 total minus 1 hidden");
  assert.ok(!pub.videos.some((v) => v.id === "BZ7qVfSoqbE"), "hidden video must not be public");
  assert.equal(pub.videos[0].id, "dQw4w9WgXcQ".length === 11 ? pub.videos[0].id : "");
  assert.equal(pub.videos.find((v) => v.id === "dQw4w9WgXcQ").views, 1234567, "views are merged from the stats file");
  assert.equal(pub.channels.at(-1).id, "new-ch");
  assert.equal(pub.accounts.at(-1).type, "tiktok");
  assert.equal(pub.services.length, 4);
  assert.equal(pub.videos.find((v) => v.id === "dQw4w9WgXcQ").title, "New <img src=x onerror=alert(1)> video", "stored as plain text; the page renders it with textContent");
  const adm = await get();
  assert.equal(adm.site.videos.length, 16, "dashboard still sees the hidden video");

  // delete things
  adm.site.videos = adm.site.videos.filter((v) => v.id !== "dQw4w9WgXcQ");
  adm.site.channels = adm.site.channels.filter((c) => c.id !== "new-ch");
  res = await authed(ctx.base, s, "PUT", "/api/site", { rev: adm.rev, site: adm.site });
  assert.equal(res.status, 200);
  assert.ok(!(await (await fetch(ctx.base + "/api/site")).json()).channels.some((c) => c.id === "new-ch"));
});

test("hostile values are refused or neutralised by the validator", async () => {
  const s = await login(ctx.base);
  const { rev, site } = await (await fetch(ctx.base + "/api/admin/site", { headers: { Cookie: s.cookie } })).json();
  const attempt = async (mutate) => { const c = JSON.parse(JSON.stringify(site)); mutate(c); const r = await authed(ctx.base, s, "PUT", "/api/site", { rev, site: c }); return { status: r.status, body: await r.json() }; };
  const cases = {
    "javascript: account url": (c) => c.accounts.push({ type: "instagram", label: "x", value: "x", url: "javascript:alert(1)" }),
    "data: account url": (c) => c.accounts.push({ type: "link", label: "x", value: "x", url: "data:text/html,<script>alert(1)</script>" }),
    "http (not https) url": (c) => c.accounts.push({ type: "link", label: "x", value: "x", url: "http://example.com" }),
    "url with credentials": (c) => c.accounts.push({ type: "link", label: "x", value: "x", url: "https://user:pw@example.com" }),
    "lookalike host": (c) => c.accounts.push({ type: "instagram", label: "x", value: "x", url: "https://instagram.com.evil.example/x" }),
    "bad email": (c) => c.accounts.push({ type: "email", label: "x", value: "not an email<script>" }),
    "bad video id": (c) => c.videos.push({ id: "../../etc/passwd" }),
    "channel url off youtube": (c) => (c.channels[0].url = "https://evil.example/@x"),
    "svg logo": (c) => (c.brand.logo = "uploads/evil.svg"),
    "traversal in avatar": (c) => (c.channels[0].avatar = "uploads/../../server/main.mjs"),
    "external avatar": (c) => (c.channels[0].avatar = "https://evil.example/a.png"),
    "unknown account type": (c) => c.accounts.push({ type: "exec", label: "x", value: "x", url: "https://example.com" }),
    "css injection in colour": (c) => (c.theme.colors.bg = "red;} body{display:none"),
    "url() in colour": (c) => (c.theme.colors.accent = "url(https://evil.example/x)"),
    "short hex colour": (c) => (c.theme.colors.fg = "#fff"),
    "too many videos": (c) => { for (let i = 0; i < 201; i++) c.videos.push({ id: String(i).padStart(11, "a") }); },
  };
  for (const [name, fn] of Object.entries(cases)) {
    const r = await attempt(fn);
    assert.equal(r.status, 400, `${name} should be rejected, got ${r.status}`);
  }
  // control/bidi characters are stripped from text
  const r = await attempt((c) => (c.brand.tagline = "ok‮evil\u0000"));
  assert.equal(r.status, 200);
  const pub = await (await fetch(ctx.base + "/api/site")).json();
  assert.equal(pub.brand.tagline, "okevil");
});

test("uploads: only real images, random names, safe serving", async () => {
  const s = await login(ctx.base);
  const up = (buf, type) => fetch(ctx.base + "/api/upload", { method: "POST", headers: { "Content-Type": type, Cookie: s.cookie, "X-CSRF-Token": s.body.csrf }, body: buf });
  assert.equal((await up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml")).status, 400);
  assert.equal((await up(Buffer.from("<?php system($_GET[0]); ?>" + "x".repeat(40)), "image/png")).status, 400, "content type lies, bytes are not an image");
  assert.equal((await up(Buffer.from("hello world, plain text"), "text/plain")).status, 415);
  assert.equal((await up(Buffer.alloc(5 * 1024 * 1024, 1), "image/png")).status, 413);
  const ok = await up(PNG, "image/png");
  assert.equal(ok.status, 200);
  const { path } = await ok.json();
  assert.match(path, /^uploads\/[a-f0-9]{24}\.png$/);
  const got = await fetch(ctx.base + "/" + path);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(ctx.base + "/uploads/evil.php")).status, 404);
});

test("channel lookup downloads and stores the logo automatically", async () => {
  const s = await login(ctx.base);
  const r = await (await authed(ctx.base, s, "POST", "/api/channel-info", { url: "https://www.youtube.com/@test" })).json();
  assert.equal(r.name, "Test Channel");
  assert.match(r.avatar, /^uploads\/[a-f0-9]{24}\.png$/);
  assert.equal((await authed(ctx.base, s, "POST", "/api/channel-info", { url: "https://evil.example/@x" })).status, 400);
});

test("dashboard code is only downloadable after signing in", async () => {
  assert.equal((await fetch(ctx.base + "/_admin/admin.js")).status, 404);
  const s = await login(ctx.base);
  const res = await fetch(ctx.base + "/_admin/admin.js", { headers: { Cookie: s.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/);
  assert.ok(!(await res.text()).includes(PASSWORD));
  assert.equal((await fetch(ctx.base + "/_admin/admin.css", { headers: { Cookie: s.cookie } })).status, 200);
});

test("logout ends the session", async () => {
  const s = await login(ctx.base);
  assert.equal((await authed(ctx.base, s, "POST", "/api/logout", {})).status, 200);
  assert.equal((await fetch(ctx.base + "/api/admin/site", { headers: { Cookie: s.cookie } })).status, 401);
});

test("password change: wrong current refused, short refused, old password stops working", async () => {
  const c2 = await start();
  try {
    const s = await login(c2.base);
    assert.equal((await authed(c2.base, s, "POST", "/api/password", { current: "nope", next: "a-long-new-password" })).status, 401);
    assert.equal((await authed(c2.base, s, "POST", "/api/password", { current: PASSWORD, next: "short" })).status, 400);
    assert.equal((await authed(c2.base, s, "POST", "/api/password", { current: PASSWORD, next: "a-long-new-password" })).status, 200);
    assert.equal((await login(c2.base, PASSWORD)).res.status, 401);
    assert.equal((await login(c2.base, "a-long-new-password")).res.status, 200);
  } finally { await c2.stop(); }
});

test("brute force: 5 wrong passwords lock the connection, even for the right password", async () => {
  const c2 = await start();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await login(c2.base, "wrong" + i)).res.status, 401);
    const locked = await login(c2.base, PASSWORD);
    assert.equal(locked.res.status, 429);
    assert.ok(Number(locked.res.headers.get("retry-after")) > 0);
    assert.equal(locked.cookie, "");
  } finally { await c2.stop(); }
});

test("data survives a restart (files on disk)", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bt-persist-"));
  const mk = () => createApp({ dataDir, publicDir: join(root, "public"), adminDir: join(root, "admin"), defaultAuthPath: join(root, "server", "default-auth.json"), youtube: fakeYoutube, background: false, log: silent });
  let a = await mk();
  await new Promise((r) => a.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${a.server.address().port}`;
  const s = await login(base);
  const { rev, site } = await (await fetch(base + "/api/admin/site", { headers: { Cookie: s.cookie } })).json();
  site.brand.tagline = "Persisted tagline";
  assert.equal((await authed(base, s, "PUT", "/api/site", { rev, site })).status, 200);
  await a.close();
  a = await mk();
  await new Promise((r) => a.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${a.server.address().port}`;
  assert.equal((await (await fetch(base + "/api/site")).json()).brand.tagline, "Persisted tagline");
  await a.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("theme: valid colours persist and reach visitors; unknown values fall back", async () => {
  const s = await login(ctx.base);
  const { rev, site } = await (await fetch(ctx.base + "/api/admin/site", { headers: { Cookie: s.cookie } })).json();
  site.theme = { preset: "gold", colors: { ...site.theme.colors, accent: "#F5B301" }, fonts: "nope", corners: "round", effects: { grain: false, bogus: true } };
  const r = await authed(ctx.base, s, "PUT", "/api/site", { rev, site });
  assert.equal(r.status, 200);
  const pub = await (await fetch(ctx.base + "/api/site")).json();
  assert.equal(pub.theme.colors.accent, "#f5b301");
  assert.equal(pub.theme.fonts, "studio");
  assert.equal(pub.theme.corners, "round");
  assert.equal(pub.theme.effects.grain, false);
  assert.equal(pub.theme.effects.cursor, true);
  assert.equal("bogus" in pub.theme.effects, false);
});
