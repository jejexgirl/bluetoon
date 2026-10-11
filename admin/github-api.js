// Dashboard back end for GitHub Pages. There is no server there, so the dashboard talks straight to
// GitHub's REST API with the owner's personal access token and saves data/site.json in the repository.
// A GitHub Actions run then fills in titles and view counts and publishes the site.
// Nothing here is secret: only a token that can write to the repository can change anything.

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

const API = "https://api.github.com";
const SITE_FILE = "data/site.json", STATS_FILE = "data/stats.json", UPLOAD_DIR = "public/uploads";
export const WORKFLOW = "pages.yml";
const MAX_UPLOAD = 3 * 1024 * 1024;

const utf8ToB64 = (s) => bytesToB64(new TextEncoder().encode(s));
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, "")), (c) => c.charCodeAt(0)));

function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  const t = (from, n) => String.fromCharCode(...b.subarray(from, from + n));
  if (t(0, 6) === "GIF87a" || t(0, 6) === "GIF89a") return "gif";
  if (t(0, 4) === "RIFF" && t(8, 4) === "WEBP") return "webp";
  return null;
}

const pickStats = (s) => (s ? { views: s.views, duration: s.duration, published: s.published } : {});

export function createGithubApi({ owner, repo, token, fetchImpl, deps }) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const { normalizeSite, parseVideoId, parseChannelUrl } = deps;
  let branch = "main", revNumber = 0, stats = {}, lastSite = null;
  const previews = new Map();

  async function gh(method, path, body) {
    let res;
    try {
      res = await doFetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch { throw new ApiError("Could not reach GitHub. Check your internet connection.", 0); }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.ok) return data;
    const msg = (data && data.message) || `GitHub error ${res.status}`;
    if (res.status === 401) throw new ApiError("GitHub did not accept this token. Create a new one and try again.", 401, data);
    if (res.status === 403 || res.status === 429) {
      const limited = /rate limit/i.test(msg);
      throw new ApiError(limited ? "GitHub says too many requests. Wait a few minutes." : "This token is not allowed to do that. It needs Contents: Read and write on this repository.", 403, data);
    }
    if (res.status === 404) throw new ApiError("Not found. Check the repository name, and that the token was created for this repository.", 404, data);
    if (res.status === 409 || res.status === 422) throw new ApiError("The site was changed somewhere else. Reload the dashboard to continue.", 409, data);
    throw new ApiError(msg, res.status, data);
  }

  const repoPath = `/repos/${owner}/${repo}`;
  async function getFile(path) {
    try { return await gh("GET", `${repoPath}/contents/${path}?ref=${encodeURIComponent(branch)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function putFile(path, contentB64, message, sha) {
    return gh("PUT", `${repoPath}/contents/${path}`, { message, content: contentB64, branch, ...(sha ? { sha } : {}) });
  }
  const view = (site) => ({ ...site, videos: site.videos.map((v) => ({ ...v, ...pickStats(stats[v.id]) })) });

  async function connect() {
    const info = await gh("GET", repoPath);
    if (!info.permissions || !info.permissions.push) throw new ApiError("This token can read the repository but not change it. It needs Contents: Read and write.", 403);
    branch = info.default_branch || "main";
    return { branch, repo: info.full_name };
  }

  async function loadSite() {
    const f = await getFile(SITE_FILE);
    if (!f) throw new ApiError(`${SITE_FILE} is missing from the repository. Upload the whole project folder, including the data folder.`, 404);
    const parsed = JSON.parse(b64ToUtf8(f.content));
    revNumber = Number(parsed.rev) || 0;
    const sf = await getFile(STATS_FILE);
    try { stats = sf ? JSON.parse(b64ToUtf8(sf.content)) : {}; } catch { stats = {}; }
    const { value } = normalizeSite(parsed.site);
    lastSite = value || parsed.site;
    return { rev: f.sha, site: view(lastSite) };
  }

  async function saveSite({ rev, site }) {
    const { value, errors } = normalizeSite(site);
    if (!value) throw new ApiError("Some values are not valid", 400, { errors });
    const body = JSON.stringify({ rev: revNumber + 1, site: value }, null, 2) + "\n";
    const out = await putFile(SITE_FILE, utf8ToB64(body), "Update site from the dashboard", rev);
    revNumber += 1;
    lastSite = value;
    return { rev: out.content.sha, site: view(value) };
  }

  function videoInfo({ inputs }) {
    const list = Array.isArray(inputs) ? inputs.slice(0, 20) : [];
    return { results: list.map((input) => {
      const id = parseVideoId(typeof input === "string" ? input.slice(0, 300) : "");
      if (!id) return { input, ok: false, error: "Not a YouTube video link" };
      // Title, channel and views are read by the GitHub Action after saving (browsers cannot read YouTube directly).
      return { input, ok: true, id, info: { id, title: "", channelName: "", channelUrl: "", pending: true } };
    }) };
  }

  function channelInfo({ url }) {
    const clean = parseChannelUrl(String(url || "").slice(0, 300));
    if (!clean) throw new ApiError("That is not a YouTube channel link", 400);
    const handle = (/\/(@[\w.-]+)$/.exec(clean) || [])[1] || "";
    const name = handle || clean.split("/").pop();
    return { name, handle, url: clean, blurb: "", avatar: null, pending: true };
  }

  async function upload(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length > MAX_UPLOAD) throw new ApiError("Image is larger than 3 MB", 413);
    const ext = sniffImage(buf);
    if (!ext) throw new ApiError("That file is not a JPG, PNG, WebP or GIF image", 400);
    const name = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("") + "." + ext;
    await putFile(`${UPLOAD_DIR}/${name}`, bytesToB64(buf), "Upload image from the dashboard");
    const path = `uploads/${name}`;
    try { previews.set(path, URL.createObjectURL(new Blob([buf], { type: ext === "jpg" ? "image/jpeg" : `image/${ext}` }))); } catch { /* preview is optional */ }
    return { path };
  }

  async function refreshStats() {
    try { await gh("POST", `${repoPath}/actions/workflows/${WORKFLOW}/dispatches`, { ref: branch }); }
    catch (e) { throw new ApiError("Could not start the refresh. Give the token Actions: Read and write, or press Run workflow in the repository's Actions tab.", e.status || 0); }
    return { ok: 0, failed: 0, queued: true, site: lastSite ? view(lastSite) : null };
  }

  async function request(method, path, body, raw) {
    if (method === "GET" && path === "/api/admin/site") return loadSite();
    if (method === "PUT" && path === "/api/site") return saveSite(body);
    if (method === "POST" && path === "/api/video-info") return videoInfo(body);
    if (method === "POST" && path === "/api/channel-info") return channelInfo(body);
    if (method === "POST" && path === "/api/upload") return upload(raw);
    if (method === "POST" && path === "/api/refresh-stats") return refreshStats();
    if (method === "POST" && path === "/api/logout") return { ok: true };
    throw new ApiError("Not available on GitHub Pages", 404);
  }

  return { request, connect, preview: (p) => previews.get(p) || null, mode: "github", repo: `${owner}/${repo}` };
}
