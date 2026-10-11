// Tests for the GitHub Pages version: build output, the Actions refresh script and the dashboard's GitHub back end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build.mjs";
import { refresh } from "../scripts/refresh.mjs";
import { createGithubApi } from "../admin/github-api.js";
import { normalizeSite } from "../server/validate.mjs";
import { parseVideoId, parseChannelUrl } from "../server/youtube.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
async function tempProject() {
  const dir = await mkdtemp(join(tmpdir(), "bt-static-"));
  for (const d of ["public", "admin", "server", "scripts"]) await cp(join(ROOT, d), join(dir, d), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  const doc = JSON.parse(await readFile(join(ROOT, "data", "site.json"), "utf8"));
  await writeFile(join(dir, "data", "site.json"), JSON.stringify(doc));
  return { dir, doc };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test("build: public data hides hidden videos, merges views, adds CSP, ships no secrets", async () => {
  const { dir, doc } = await tempProject();
  try {
    doc.site.videos[1].hidden = true;
    await writeFile(join(dir, "data", "site.json"), JSON.stringify(doc));
    await writeFile(join(dir, "data", "stats.json"), JSON.stringify({ [doc.site.videos[0].id]: { views: 1234, duration: 61, published: "2024-01-02", fetchedAt: 1 } }));
    const out = join(dir, "_site");
    const r = await build({ root: dir, out });
    assert.equal(r.videos, doc.site.videos.length - 1);
    const pub = JSON.parse(await readFile(join(out, "data", "site.json"), "utf8"));
    assert.equal(pub.videos.some((v) => v.id === doc.site.videos[1].id), false);
    assert.equal(pub.videos[0].views, 1234);
    assert.equal("fetchedAt" in pub.videos[0], false);
    const html = await readFile(join(out, "index.html"), "utf8");
    assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
    assert.match(html, /connect-src 'self' https:\/\/api\.github\.com/);
    assert.doesNotMatch(html, /frame-ancestors/);
    for (const f of ["admin.js", "admin.css", "github-api.js", "validate.mjs", "youtube.mjs"]) assert.ok(existsSync(join(out, "_admin", f)), f);
    assert.equal(existsSync(join(out, "server")), false);
    assert.equal(existsSync(join(out, "_admin", "default-auth.json")), false);
    const files = (await readdir(out, { recursive: true })).join("\n");
    assert.doesNotMatch(files, /auth/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("refresh: fills blanks, keeps hand-typed values, saves logos, skips fresh data", async () => {
  const { dir, doc } = await tempProject();
  try {
    const [v0, v1] = doc.site.videos;
    v0.title = "Typed by hand"; v1.title = ""; v1.channelName = ""; v1.channelId = null;
    doc.site.channels.push({ id: "newch", name: "@NewOne", handle: "@NewOne", url: "https://www.youtube.com/@NewOne", blurb: "", avatar: null, banner: null, monogram: "@N" });
    await writeFile(join(dir, "data", "site.json"), JSON.stringify(doc));
    await writeFile(join(dir, "data", "stats.json"), JSON.stringify({ zzzzzzzzzzz: { views: 5, fetchedAt: 1 } }));
    let calls = 0;
    const youtube = {
      async videoInfo(id) { calls++; if (id === doc.site.videos[2].id) throw new Error("private"); return { id, title: "From YouTube " + id, channelName: "REST EXTRA", channelUrl: "https://www.youtube.com/@RESTEXTRA", views: 4200, duration: 600, published: "2024-05-05" }; },
      async channelInfo() { return { name: "New One", handle: "@NewOne", url: "https://www.youtube.com/@NewOne", blurb: "About new one", imageUrl: "https://yt3.googleusercontent.com/x" }; },
      async downloadImage() { return PNG; },
    };
    const logs = [];
    const s = await refresh({ root: dir, youtube, now: 1_000_000_000_000, log: (m) => logs.push(m) });
    assert.equal(s.failedVideos, 1);
    assert.equal(s.channels, 1);
    const site = JSON.parse(await readFile(join(dir, "data", "site.json"), "utf8"));
    const stats = JSON.parse(await readFile(join(dir, "data", "stats.json"), "utf8"));
    assert.equal(site.site.videos[0].title, "Typed by hand");
    assert.equal(site.site.videos[1].title, "From YouTube " + v1.id);
    assert.equal(site.site.videos[1].channelId, "restextra");
    assert.equal(stats[v0.id].views, 4200);
    assert.equal("zzzzzzzzzzz" in stats, false);
    const ch = site.site.channels.find((c) => c.id === "newch");
    assert.equal(ch.name, "New One");
    assert.equal(ch.blurb, "About new one");
    assert.match(ch.avatar, /^uploads\/[a-f0-9]{24}\.png$/);
    assert.ok(existsSync(join(dir, "public", ch.avatar)));
    assert.ok(site.rev > doc.rev);
    // second run right away: nothing is fresh enough to need a fetch except the video that failed
    calls = 0;
    await refresh({ root: dir, youtube, now: 1_000_000_000_000 + 60_000, log: () => {} });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/* ---------- fake GitHub ---------- */
function fakeGithub({ push = true, token = "github_pat_" + "a".repeat(30) } = {}) {
  const files = new Map(); let n = 0; const calls = [];
  const put = (path, text) => { files.set(path, { sha: "sha" + ++n, content: Buffer.from(text).toString("base64") }); };
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url), m = opts.method || "GET", body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ m, path: u.pathname, body });
    assert.equal(u.origin, "https://api.github.com");
    if (opts.headers.Authorization !== `Bearer ${token}`) return json(401, { message: "Bad credentials" });
    const base = "/repos/me/site";
    if (m === "GET" && u.pathname === base) return json(200, { full_name: "me/site", default_branch: "main", permissions: { push } });
    if (u.pathname.startsWith(base + "/contents/")) {
      const path = decodeURIComponent(u.pathname.slice((base + "/contents/").length));
      const f = files.get(path);
      if (m === "GET") return f ? json(200, { ...f, encoding: "base64" }) : json(404, { message: "Not Found" });
      if (m === "PUT") {
        if (f && body.sha !== f.sha) return json(409, { message: "does not match" });
        if (!f && body.sha) return json(422, { message: "sha wasn't supplied" });
        files.set(path, { sha: "sha" + ++n, content: body.content });
        return json(f ? 200 : 201, { content: { sha: files.get(path).sha } });
      }
    }
    if (m === "POST" && u.pathname === base + "/actions/workflows/pages.yml/dispatches") return new Response(null, { status: 204 });
    return json(404, { message: "Not Found" });
  };
  return { files, put, fetchImpl, calls, token };
}
const deps = { normalizeSite, parseVideoId, parseChannelUrl };
async function setup(opts) {
  const gh = fakeGithub(opts);
  const doc = JSON.parse(await readFile(join(ROOT, "data", "site.json"), "utf8"));
  gh.put("data/site.json", JSON.stringify(doc));
  gh.put("data/stats.json", JSON.stringify({ [doc.site.videos[0].id]: { views: 99 } }));
  const api = createGithubApi({ owner: "me", repo: "site", token: gh.token, fetchImpl: gh.fetchImpl, deps });
  return { gh, api, doc };
}

test("github back end: connect checks write access and rejects bad tokens", async () => {
  const ro = await setup({ push: false });
  await assert.rejects(ro.api.connect(), (e) => e.status === 403 && /Contents: Read and write/.test(e.message));
  const bad = createGithubApi({ owner: "me", repo: "site", token: "github_pat_wrong" + "b".repeat(20), fetchImpl: ro.gh.fetchImpl, deps });
  await assert.rejects(bad.connect(), (e) => e.status === 401);
  const ok = await setup();
  assert.deepEqual(await ok.api.connect(), { branch: "main", repo: "me/site" });
});

test("github back end: load, save with stale-sha protection, validation errors", async () => {
  const { gh, api, doc } = await setup();
  await api.connect();
  const loaded = await api.request("GET", "/api/admin/site");
  assert.equal(loaded.site.videos[0].views, 99); // stats merged for display
  const draft = JSON.parse(JSON.stringify(loaded.site));
  draft.brand.tagline = "New tagline ‮x";
  draft.videos.push({ id: "abcdefghijk", title: "", channelId: null });
  const saved = await api.request("PUT", "/api/site", { rev: loaded.rev, site: draft });
  assert.notEqual(saved.rev, loaded.rev);
  const onDisk = JSON.parse(Buffer.from(gh.files.get("data/site.json").content, "base64").toString("utf8"));
  assert.equal(onDisk.site.brand.tagline, "New tagline x");
  assert.equal(onDisk.site.videos.length, doc.site.videos.length + 1);
  assert.equal("views" in onDisk.site.videos[0], false); // stats never leak into site.json
  assert.equal(onDisk.rev, doc.rev + 1);
  // stale sha (someone else saved) is refused
  await assert.rejects(api.request("PUT", "/api/site", { rev: loaded.rev, site: draft }), (e) => e.status === 409);
  // saving again with the new sha works
  await api.request("PUT", "/api/site", { rev: saved.rev, site: saved.site });
  // invalid values never reach GitHub
  const before = gh.calls.length;
  const evil = JSON.parse(JSON.stringify(saved.site));
  evil.accounts.push({ type: "link", label: "x", value: "x", url: "javascript:alert(1)" });
  evil.theme.colors.bg = "red;}body{display:none";
  await assert.rejects(api.request("PUT", "/api/site", { rev: saved.rev, site: evil }), (e) => e.status === 400 && e.data.errors.length >= 2);
  assert.equal(gh.calls.length, before);
});

test("github back end: uploads, video/channel lookups, refresh, unknown routes", async () => {
  const { gh, api } = await setup();
  await api.connect();
  const up = await api.request("POST", "/api/upload", undefined, new Blob([PNG], { type: "image/png" }));
  assert.match(up.path, /^uploads\/[a-f0-9]{24}\.png$/);
  assert.ok(gh.files.has("public/" + up.path));
  await assert.rejects(api.request("POST", "/api/upload", undefined, new Blob(["<svg onload=alert(1)>"], { type: "image/svg+xml" })), (e) => e.status === 400);
  await assert.rejects(api.request("POST", "/api/upload", undefined, new Blob([Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)])])), (e) => e.status === 413);

  const { results } = await api.request("POST", "/api/video-info", { inputs: ["https://youtu.be/dQw4w9WgXcQ", "not a link", "https://evil.example/watch?v=dQw4w9WgXcQ"] });
  assert.equal(results[0].ok, true); assert.equal(results[0].id, "dQw4w9WgXcQ"); assert.equal(results[0].info.pending, true);
  assert.equal(results[1].ok, false); assert.equal(results[2].ok, false);

  const ch = await api.request("POST", "/api/channel-info", { url: "youtube.com/@SomeChannel" });
  assert.equal(ch.handle, "@SomeChannel"); assert.equal(ch.url, "https://www.youtube.com/@SomeChannel");
  await assert.rejects(api.request("POST", "/api/channel-info", { url: "https://evil.example/@x" }), (e) => e.status === 400);

  const r = await api.request("POST", "/api/refresh-stats", {});
  assert.equal(r.queued, true);
  assert.ok(gh.calls.some((c) => c.path.endsWith("/dispatches")));
  await assert.rejects(api.request("POST", "/api/password", {}), (e) => e.status === 404);
});
