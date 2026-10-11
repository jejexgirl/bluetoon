// Fetches public YouTube data on the server. Only fixed YouTube/Google hosts are ever contacted,
// and only with values that were validated first (11-character video ids, youtube.com channel links).
import { VIDEO_ID_RE } from "./validate.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IMG_HOSTS = ["yt3.googleusercontent.com", "yt3.ggpht.com", "i.ytimg.com"];
const MAX_TEXT = 3 * 1024 * 1024;
const MAX_IMG = 4 * 1024 * 1024;

export function parseVideoId(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (VIDEO_ID_RE.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else { const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname); if (m) id = m[2]; }
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export function parseChannelUrl(input) {
  if (typeof input !== "string") return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : "https://" + input.trim()); } catch { return null; }
  if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return null;
  const m = /^\/(@[\w.-]{1,60}|channel\/UC[\w-]{22}|c\/[\w.-]{1,60}|user\/[\w.-]{1,60})\/?/.exec(u.pathname);
  return m ? `https://www.youtube.com/${m[1]}` : null;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export function ogTag(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const m = re.exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i").exec(html);
  return m ? decode(m[1]) : "";
}
const isoSeconds = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ""); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : undefined; };

export function createYoutube({ fetchImpl = globalThis.fetch, apiKey = process.env.YT_API_KEY || "" } = {}) {
  async function get(url, { headers = {}, max = MAX_TEXT, binary = false, redirect = "follow" } = {}) {
    const res = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(12000), redirect });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > max) throw new Error("response too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error("response too large");
    return { buf, text: binary ? "" : buf.toString("utf8"), url: res.url || url, type: res.headers.get("content-type") || "" };
  }

  async function videoInfo(id) {
    if (!VIDEO_ID_RE.test(id)) throw new Error("invalid video id");
    if (apiKey) {
      const { text } = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${id}&key=${encodeURIComponent(apiKey)}`);
      const it = (JSON.parse(text).items || [])[0];
      if (!it) throw new Error("video not found or private");
      return {
        id, title: it.snippet.title, channelName: it.snippet.channelTitle,
        channelUrl: `https://www.youtube.com/channel/${it.snippet.channelId}`,
        views: it.statistics?.viewCount != null ? Number(it.statistics.viewCount) : undefined,
        duration: isoSeconds(it.contentDetails?.duration), published: (it.snippet.publishedAt || "").slice(0, 10) || undefined,
      };
    }
    const out = { id };
    try {
      const { text } = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`);
      const j = JSON.parse(text);
      out.title = j.title; out.channelName = j.author_name; out.channelUrl = j.author_url;
    } catch { /* title may still come from the page below */ }
    try {
      const { text: html } = await get(`https://www.youtube.com/watch?v=${id}`, { headers: { Cookie: "CONSENT=YES+1; SOCS=CAI" } });
      const views = /"videoDetails":\{[^}]*?"viewCount":"(\d+)"/.exec(html) || /"viewCount":"(\d+)"/.exec(html);
      const len = /"lengthSeconds":"(\d+)"/.exec(html);
      const pub = /"publishDate":"(\d{4}-\d{2}-\d{2})/.exec(html);
      if (views) out.views = Number(views[1]);
      if (len) out.duration = Number(len[1]);
      if (pub) out.published = pub[1];
      if (!out.title) out.title = ogTag(html, "og:title");
    } catch { /* keep what we have */ }
    if (!out.title) throw new Error("video not found, private, or YouTube could not be reached");
    return out;
  }

  async function channelInfo(url) {
    const clean = parseChannelUrl(url);
    if (!clean) throw new Error("not a YouTube channel link");
    const { text: html } = await get(clean, { headers: { Cookie: "CONSENT=YES+1; SOCS=CAI" } });
    const name = ogTag(html, "og:title");
    if (!name) throw new Error("channel not found");
    const canonical = (/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html) || [])[1] || "";
    const handle = (/^https:\/\/www\.youtube\.com\/(@[\w.-]+)/.exec(canonical) || /\/(@[\w.-]+)$/.exec(clean) || [])[1] || "";
    return { name, handle, url: parseChannelUrl(canonical) || clean, blurb: ogTag(html, "og:description").slice(0, 220), imageUrl: ogTag(html, "og:image") };
  }

  async function downloadImage(url) {
    let u;
    try { u = new URL(url); } catch { throw new Error("bad image url"); }
    if (u.protocol !== "https:" || !IMG_HOSTS.includes(u.hostname)) throw new Error("image host not allowed");
    const r = await get(u.href, { max: MAX_IMG, binary: true, redirect: "error" }); // never follow redirects to other hosts
    if (!IMG_HOSTS.includes(new URL(r.url).hostname)) throw new Error("image redirected to a disallowed host");
    return r.buf;
  }

  return { videoInfo, channelInfo, downloadImage };
}
