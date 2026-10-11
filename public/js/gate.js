// Hidden entrance to the dashboard: typing the secret word anywhere on the page opens a sign-in box.
// This file contains no password and no token.
//  - With the Node server: the password is checked by the server, which also decides who may download
//    the dashboard code (only signed-in sessions can fetch /_admin/*).
//  - On GitHub Pages (no server): the box asks for the repository and a GitHub token. The token is the key:
//    only someone whose token can write to the repository can change the site.
(() => {
  "use strict";
  const SEQ = "itsmebluetoon";
  const TOKEN_RE = /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/;
  const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;
  let buf = "", last = 0, busy = false;
  const BT = () => window.BT;
  const url = (p) => new URL(p, document.baseURI).href;
  const store = (kind) => { try { return window[kind]; } catch { return null; } };
  const get = (kind, k) => { try { return store(kind)?.getItem(k) || ""; } catch { return ""; } };
  const put = (kind, k, v) => { try { store(kind)?.setItem(k, v); } catch { /* storage unavailable */ } };
  const del = (kind, k) => { try { store(kind)?.removeItem(k); } catch { /* ignore */ } };

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const now = Date.now();
    if (now - last > 4000) buf = "";
    last = now;
    buf = (buf + e.key.toLowerCase()).slice(-SEQ.length);
    if (buf === SEQ) { buf = ""; start(); }
  });

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...opts });
    let body = null;
    try { body = await res.json(); } catch { /* not json */ }
    return { res, body };
  }

  async function start() {
    if (busy || document.getElementById("gate") || document.getElementById("studio")) return;
    busy = true;
    try {
      const { res, body } = await api("api/me");
      if (res.ok && body) { if (body.authenticated) await openDashboard({ csrf: body.csrf }); else showLogin(); }
      else await startGithub(); // no server answered: this is the GitHub Pages version
    } catch { BT().toast("The dashboard needs the BlueToon server (run start.bat) or the GitHub Pages version."); }
    finally { busy = false; }
  }

  async function openDashboard(args) {
    try {
      const mod = await import(url("_admin/admin.js"));
      await mod.openDashboard({ BT: BT(), ...args });
    } catch (e) {
      BT().toast("Could not open the dashboard. Sign in again.");
    }
  }

  /* ---------- GitHub Pages mode ---------- */
  function guessRepo() {
    const saved = get("localStorage", "bt_gh_repo");
    if (saved) return saved;
    const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return "";
    return `${m[1]}/${location.pathname.split("/")[1] || m[1] + ".github.io"}`;
  }
  async function connectGithub(repoStr, token) {
    const [owner, repo] = repoStr.split("/");
    const [{ createGithubApi }, v, y] = await Promise.all([import(url("_admin/github-api.js")), import(url("_admin/validate.mjs")), import(url("_admin/youtube.mjs"))]);
    const backend = createGithubApi({ owner, repo, token, deps: { normalizeSite: v.normalizeSite, parseVideoId: y.parseVideoId, parseChannelUrl: y.parseChannelUrl } });
    await backend.connect();
    backend.signOut = () => { del("sessionStorage", "bt_gh_token"); del("localStorage", "bt_gh_token"); };
    return backend;
  }
  async function startGithub() {
    const repoStr = guessRepo(), saved = get("sessionStorage", "bt_gh_token") || get("localStorage", "bt_gh_token");
    if (saved && REPO_RE.test(repoStr)) {
      try { await openDashboard({ backend: await connectGithub(repoStr, saved) }); return; }
      catch { del("sessionStorage", "bt_gh_token"); del("localStorage", "bt_gh_token"); }
    }
    showGithubLogin(repoStr);
  }
  function showGithubLogin(repoStr) {
    const { h } = BT();
    const remember = h("input", { type: "checkbox", id: "gateRemember" });
    showForm({
      title: "Studio access",
      fields: [
        { id: "gateRepo", label: "GitHub repository (owner/name)", type: "text", value: repoStr, placeholder: "yourname/bluetoon-site", autocomplete: "off" },
        { id: "gateTok", label: "Your GitHub access token", type: "password", placeholder: "github_pat_...", autocomplete: "off" },
      ],
      extra: h("label", { class: "gate-remember" }, remember, " Keep me signed in on this device"),
      hint: "Create it once in GitHub: Settings > Developer settings > Fine-grained tokens. Only this repository, with Contents: Read and write.",
      async submit([repoVal, tok]) {
        repoVal = repoVal.trim(); tok = tok.trim();
        if (!REPO_RE.test(repoVal)) return "Write the repository like yourname/bluetoon-site";
        if (!TOKEN_RE.test(tok)) return "That does not look like a GitHub token.";
        let backend;
        try { backend = await connectGithub(repoVal, tok); } catch (e) { return e.message || "Could not connect to GitHub."; }
        put("localStorage", "bt_gh_repo", repoVal);
        put(remember.checked ? "localStorage" : "sessionStorage", "bt_gh_token", tok);
        return { done: () => openDashboard({ backend }) };
      },
    });
  }

  /* ---------- Node server mode ---------- */
  function showLogin() {
    showForm({
      title: "Studio access",
      fields: [{ id: "gatePw", label: "Enter the password to continue", type: "password", placeholder: "Password", autocomplete: "current-password" }],
      async submit([pw]) {
        if (!pw) return "";
        const { res, body } = await api("api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
        if (res.ok && body && body.csrf) return { done: () => openDashboard({ csrf: body.csrf }) };
        if (res.status === 429) return `Too many attempts. Try again in ${Math.ceil(((body && body.retry) || 900) / 60)} minute(s).`;
        if (res.status === 401) return { error: "Wrong password.", shake: true };
        return "Could not sign in. Please try again.";
      },
    });
  }

  /* ---------- shared sign-in card ---------- */
  function showForm({ title, fields, extra, hint, submit }) {
    const { h } = BT();
    const err = h("p", { class: "gate-err", role: "alert" });
    const inputs = fields.map((f) => h("input", { id: f.id, type: f.type, autocomplete: f.autocomplete, placeholder: f.placeholder || "", maxlength: "300", spellcheck: "false", dir: "ltr", value: f.value || "" }));
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Unlock");
    const cancel = h("button", { class: "btn btn-ghost", type: "button" }, "Cancel");
    const form = h("form", { class: "gate-card", novalidate: true },
      h("div", { class: "gate-head" }, h("img", { src: BT().getData()?.brand?.logo || "assets/bluetoon-logo.jpg", alt: "", width: 48, height: 48 }), h("div", {}, h("span", { class: "gate-kicker" }, "Private area"), h("h2", { id: "gateTitle" }, title))),
      ...fields.flatMap((f, i) => [h("label", { for: f.id }, f.label), inputs[i]]),
      extra || null, hint ? h("p", { class: "gate-hint" }, hint) : null,
      err, h("div", { class: "gate-actions" }, cancel, btn));
    const wrap = h("div", { id: "gate", class: "gate", role: "dialog", "aria-modal": "true", "aria-labelledby": "gateTitle" }, form);
    document.body.append(wrap);
    const first = inputs.find((i) => !i.value) || inputs[0];
    requestAnimationFrame(() => { wrap.classList.add("open"); first.focus(); });

    const close = () => { wrap.classList.remove("open"); setTimeout(() => wrap.remove(), 250); removeEventListener("keydown", onKey, true); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "Tab") {
        const els = [...inputs, ...form.querySelectorAll("input[type=checkbox]"), cancel, btn], i = els.indexOf(document.activeElement);
        if (i === -1) { e.preventDefault(); els[0].focus(); }
        else if (e.shiftKey && i === 0) { e.preventDefault(); btn.focus(); }
        else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
      }
    };
    addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", close);
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      let out;
      try { out = await submit(inputs.map((i) => i.value)); } catch { out = "Could not connect. Please try again."; }
      if (out && out.done) { inputs.forEach((i) => { if (i.type === "password") i.value = ""; }); close(); await out.done(); return; }
      inputs.forEach((i) => { if (i.type === "password") i.value = ""; });
      const o = typeof out === "string" ? { error: out } : out || {};
      err.textContent = o.error || "";
      if (o.shake) { form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); }
      btn.disabled = false; (inputs.find((i) => i.type === "password") || inputs[0]).focus();
    });
  }
})();
