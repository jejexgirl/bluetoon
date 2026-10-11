// Strict validation/normalisation of everything the dashboard can save.
// Unknown keys are dropped, every string is length-limited, every URL must be https,
// every image path must point to our own assets/uploads folders.
// Web Crypto is used so this file also runs in the browser (the GitHub-hosted dashboard validates with it).
const wc = globalThis.crypto ?? (await import("node:crypto")).webcrypto;

export const ACCOUNT_TYPES = ["email", "discord", "instagram", "youtube", "tiktok", "x", "twitch", "facebook", "github", "link"];
const ACCOUNT_HOSTS = {
  discord: ["discord.com", "discord.gg"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"],
  twitch: ["twitch.tv"],
  facebook: ["facebook.com", "fb.com"],
  github: ["github.com"],
};
export const YT_HOSTS = ["youtube.com"];
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const EMAIL_RE = /^[^\s@<>"'()\\,;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const IMG_RE = /^(assets|uploads)\/[A-Za-z0-9._-]{1,80}\.(jpe?g|png|webp|gif)$/i;
const ID_RE = /^[a-z0-9-]{1,40}$/;

// Removes control characters and bidi-override characters (used for text spoofing).
export function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "").trim().slice(0, max);
}
export function safeUrl(s, hosts) {
  if (typeof s !== "string") return null;
  s = s.trim();
  if (!s || s.length > 500) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) return null;
  return u.href;
}
export const imagePath = (s) => (typeof s === "string" && IMG_RE.test(s.trim()) ? s.trim() : null);
export const newId = (prefix = "x") => `${prefix}-${Array.from(wc.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
export const FONT_SETS = ["studio", "bold", "clean", "editorial"];
export const CORNERS = ["sharp", "soft", "round"];
export const EFFECTS = ["grain", "cursor", "timeline", "ghost", "portrait", "rec"];
export const DEFAULT_THEME = {
  preset: "cobalt",
  colors: { bg: "#060b1a", panel: "#0d1738", fg: "#eaf0ff", muted: "#93a0c8", accent: "#2f6bff", accent2: "#6fa0ff" },
  fonts: "studio", corners: "soft",
  effects: { grain: true, cursor: true, timeline: true, ghost: true, portrait: true, rec: true },
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

export function normalizeSite(input) {
  const errors = [];
  const err = (p, m) => errors.push(`${p}: ${m}`);
  if (!isObj(input)) return { errors: ["site: must be an object"] };

  // brand
  const b = isObj(input.brand) ? input.brand : {};
  const years = Number.parseInt(b.years, 10);
  const brand = {
    name: cleanText(b.name, 40) || "BlueToon",
    years: Number.isFinite(years) && years >= 0 && years <= 99 ? years : 8,
    tagline: cleanText(b.tagline, 100),
    heroLine: cleanText(b.heroLine, 140),
    logo: imagePath(b.logo) || "assets/bluetoon-logo.jpg",
  };
  if (b.logo && !imagePath(b.logo)) err("brand.logo", "invalid image path");

  // channels
  const channels = [];
  const seenCh = new Set();
  if (!Array.isArray(input.channels)) err("channels", "must be a list");
  else if (input.channels.length > 30) err("channels", "too many (max 30)");
  else input.channels.forEach((c, i) => {
    const p = `channels[${i}]`;
    if (!isObj(c)) return err(p, "invalid");
    const name = cleanText(c.name, 60);
    if (!name) return err(p + ".name", "required");
    const url = safeUrl(c.url, YT_HOSTS);
    if (!url) return err(p + ".url", "must be an https youtube.com link");
    let id = typeof c.id === "string" && ID_RE.test(c.id) ? c.id : newId("ch");
    while (seenCh.has(id)) id = newId("ch");
    seenCh.add(id);
    if (c.avatar && !imagePath(c.avatar)) err(p + ".avatar", "invalid image path");
    if (c.banner && !imagePath(c.banner)) err(p + ".banner", "invalid image path");
    channels.push({
      id, name, url,
      handle: cleanText(c.handle, 40),
      blurb: cleanText(c.blurb, 220),
      avatar: imagePath(c.avatar),
      banner: imagePath(c.banner),
      monogram: cleanText(c.monogram, 3) || name.slice(0, 2),
    });
  });

  // videos
  const videos = [];
  const seenV = new Set();
  if (!Array.isArray(input.videos)) err("videos", "must be a list");
  else if (input.videos.length > 200) err("videos", "too many (max 200)");
  else input.videos.forEach((v, i) => {
    const p = `videos[${i}]`;
    if (!isObj(v)) return err(p, "invalid");
    if (typeof v.id !== "string" || !VIDEO_ID_RE.test(v.id)) return err(p + ".id", "not a valid YouTube video id");
    if (seenV.has(v.id)) return; // silently drop duplicates
    seenV.add(v.id);
    const channelId = typeof v.channelId === "string" && seenCh.has(v.channelId) ? v.channelId : null;
    videos.push({
      id: v.id,
      title: cleanText(v.title, 200),
      channelId,
      channelName: cleanText(v.channelName, 80),
      channelUrl: safeUrl(v.channelUrl, YT_HOSTS) || "",
      hidden: v.hidden === true,
    });
  });

  // services
  const services = [];
  if (!Array.isArray(input.services)) err("services", "must be a list");
  else if (input.services.length > 20) err("services", "too many (max 20)");
  else input.services.forEach((s, i) => {
    if (!isObj(s)) return err(`services[${i}]`, "invalid");
    const title = cleanText(s.title, 60);
    if (!title) return err(`services[${i}].title`, "required");
    services.push({ title, text: cleanText(s.text, 300) });
  });

  // about
  const about = [];
  if (!Array.isArray(input.about)) err("about", "must be a list");
  else if (input.about.length > 10) err("about", "too many paragraphs (max 10)");
  else input.about.forEach((t) => { const x = cleanText(t, 600); if (x) about.push(x); });

  // accounts
  const accounts = [];
  const seenA = new Set();
  if (!Array.isArray(input.accounts)) err("accounts", "must be a list");
  else if (input.accounts.length > 20) err("accounts", "too many (max 20)");
  else input.accounts.forEach((a, i) => {
    const p = `accounts[${i}]`;
    if (!isObj(a)) return err(p, "invalid");
    if (!ACCOUNT_TYPES.includes(a.type)) return err(p + ".type", "unknown type");
    const label = cleanText(a.label, 30) || a.type;
    let value = cleanText(a.value, 120);
    let url = "";
    if (a.type === "email") {
      if (!EMAIL_RE.test(value)) return err(p + ".value", "not a valid email address");
    } else if (a.type === "discord") {
      if (value.length < 2) return err(p + ".value", "enter the Discord username");
      if (a.url) { url = safeUrl(a.url, ACCOUNT_HOSTS.discord); if (!url) return err(p + ".url", "must be an https discord.com / discord.gg link"); }
    } else {
      url = safeUrl(a.url, ACCOUNT_HOSTS[a.type]);
      if (!url) return err(p + ".url", "must be a valid https link" + (ACCOUNT_HOSTS[a.type] ? ` on ${ACCOUNT_HOSTS[a.type].join(" / ")}` : ""));
      if (!value) value = new URL(url).hostname.replace(/^www\./, "");
    }
    let id = typeof a.id === "string" && ID_RE.test(a.id) ? a.id : newId("ac");
    while (seenA.has(id)) id = newId("ac");
    seenA.add(id);
    accounts.push({ id, type: a.type, label, value, url });
  });

  // theme: colours must be exact #rrggbb values (so nothing else can ever reach the stylesheet)
  const t = isObj(input.theme) ? input.theme : {};
  const tc = isObj(t.colors) ? t.colors : {};
  const colors = {};
  for (const k of Object.keys(DEFAULT_THEME.colors)) {
    if (tc[k] === undefined) { colors[k] = DEFAULT_THEME.colors[k]; continue; }
    if (typeof tc[k] !== "string" || !HEX_RE.test(tc[k])) { err(`theme.colors.${k}`, "must be a colour like #2f6bff"); continue; }
    colors[k] = tc[k].toLowerCase();
  }
  const te = isObj(t.effects) ? t.effects : {};
  const effects = {};
  for (const k of EFFECTS) effects[k] = te[k] === undefined ? DEFAULT_THEME.effects[k] : te[k] === true;
  const theme = {
    preset: typeof t.preset === "string" && /^[a-z]{1,16}$/.test(t.preset) ? t.preset : "custom",
    colors,
    fonts: FONT_SETS.includes(t.fonts) ? t.fonts : "studio",
    corners: CORNERS.includes(t.corners) ? t.corners : "soft",
    effects,
  };

  if (errors.length) return { errors };
  return { value: { brand, channels, videos, services, about, accounts, theme }, errors: [] };
}
