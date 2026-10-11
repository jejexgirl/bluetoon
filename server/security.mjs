// Security primitives: password hashing, sessions, rate limiting, image sniffing, headers.
import crypto from "node:crypto";

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };
const scryptAsync = (pw, salt, keylen, opts) => new Promise((res, rej) => crypto.scrypt(pw, salt, keylen, opts, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(pw, salt, SCRYPT.keylen, SCRYPT);
  return { alg: "scrypt", salt: salt.toString("base64"), hash: key.toString("base64"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keylen: SCRYPT.keylen };
}
export async function verifyPassword(pw, rec) {
  if (typeof pw !== "string" || pw.length > 200 || !rec) return false;
  const key = await scryptAsync(pw, Buffer.from(rec.salt, "base64"), rec.keylen, { N: rec.N, r: rec.r, p: rec.p, maxmem: SCRYPT.maxmem });
  const exp = Buffer.from(rec.hash, "base64");
  return key.length === exp.length && crypto.timingSafeEqual(key, exp);
}

// Limits how many scrypt hashes run at once so login attempts cannot exhaust the CPU.
export class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise((r) => this.q.push(r));
    this.n--;
    try { return await fn(); } finally { this.n++; const next = this.q.shift(); if (next) next(); }
  }
}

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
export class Sessions {
  constructor({ idleMs = 2 * 3600e3, absMs = 12 * 3600e3 } = {}) { this.map = new Map(); this.idleMs = idleMs; this.absMs = absMs; }
  create() {
    const token = crypto.randomBytes(32).toString("base64url");
    const csrf = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    this.map.set(sha(token), { csrf, created: now, last: now });
    return { token, csrf };
  }
  get(token) {
    if (typeof token !== "string" || token.length > 100) return null;
    const k = sha(token), s = this.map.get(k), now = Date.now();
    if (!s) return null;
    if (now - s.last > this.idleMs || now - s.created > this.absMs) { this.map.delete(k); return null; }
    s.last = now;
    return s;
  }
  destroy(token) { if (typeof token === "string") this.map.delete(sha(token)); }
  destroyAllExcept(token) { const keep = typeof token === "string" ? sha(token) : null; for (const k of this.map.keys()) if (k !== keep) this.map.delete(k); }
  sweep() { const now = Date.now(); for (const [k, s] of this.map) if (now - s.last > this.idleMs || now - s.created > this.absMs) this.map.delete(k); }
}

// 5 wrong passwords within 15 minutes locks that IP out for 15 minutes.
export class AttemptLimiter {
  constructor({ max = 5, windowMs = 15 * 60e3, lockMs = 15 * 60e3 } = {}) { this.max = max; this.windowMs = windowMs; this.lockMs = lockMs; this.map = new Map(); }
  check(key) {
    const r = this.map.get(key), now = Date.now();
    if (r && r.lockUntil > now) return { blocked: true, retry: Math.ceil((r.lockUntil - now) / 1000) };
    return { blocked: false };
  }
  fail(key) {
    const now = Date.now();
    let r = this.map.get(key);
    if (!r || now - r.first > this.windowMs) r = { fails: 0, first: now, lockUntil: 0 };
    r.fails++;
    if (r.fails >= this.max) { r.lockUntil = now + this.lockMs; r.fails = 0; r.first = now; }
    this.map.set(key, r);
    return r.fails;
  }
  success(key) { this.map.delete(key); }
  sweep() { const now = Date.now(); for (const [k, r] of this.map) if (r.lockUntil < now && now - r.first > this.windowMs) this.map.delete(k); }
}

// Simple per-IP request budget for the whole API.
export class RateBucket {
  constructor(limit = 240, windowMs = 60e3) { this.limit = limit; this.windowMs = windowMs; this.map = new Map(); }
  hit(key) {
    const now = Date.now();
    let r = this.map.get(key);
    if (!r || now - r.start > this.windowMs) r = { start: now, n: 0 };
    r.n++;
    this.map.set(key, r);
    return r.n <= this.limit;
  }
  sweep() { const now = Date.now(); for (const [k, r] of this.map) if (now - r.start > this.windowMs) this.map.delete(k); }
}

// Recognises real image files from their first bytes (never trust the client's content type). SVG is refused on purpose.
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  const h6 = buf.subarray(0, 6).toString("latin1");
  if (h6 === "GIF87a" || h6 === "GIF89a") return { ext: "gif", mime: "image/gif" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export const CSP = [
  "default-src 'none'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://img.youtube.com https://i.ytimg.com",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(https) {
  const h = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // YouTube's player needs to see the site's origin, so the referrer is not fully stripped.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (https) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}
