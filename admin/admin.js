// BlueToon Studio: the private dashboard. The server only sends this file to a signed-in session.
// Every value is placed on the page with textContent / setAttribute (never innerHTML).

const TYPE_LABELS = { email: "Email", discord: "Discord", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X (Twitter)", twitch: "Twitch", facebook: "Facebook", github: "GitHub", link: "Other link" };
const rid = (p) => `${p}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (t) => (t || "").toLowerCase().replace(/[\s|]+/g, "");
const compact = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n)).replace(".0", "");
const dur = (s) => { const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0"); };

export async function openDashboard({ csrf, BT, backend }) {
  if (document.getElementById("studio")) return;
  const { h } = BT;
  // backend is set on GitHub Pages (no server): requests go to GitHub instead of /api/*.
  const onGithub = !!backend;
  const url = (p) => new URL(p, document.baseURI).href;

  /* ---------- API ---------- */
  class ApiError extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data; } }
  async function api(method, path, body, raw) {
    if (backend) {
      try { return await backend.request(method, path, body, raw); }
      catch (e) { if (e.status === 401) expired(); throw e; }
    }
    const headers = { "X-CSRF-Token": csrf };
    let payload;
    if (raw) { headers["Content-Type"] = raw.type || "application/octet-stream"; payload = raw; }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(path, { method, headers, body: payload, credentials: "same-origin", cache: "no-store" });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && path !== "/api/password") { expired(); throw new ApiError("Session expired", 401, data); }
    if (!res.ok) throw new ApiError((data && data.error) || `Error ${res.status}`, res.status, data);
    return data;
  }

  /* ---------- state ---------- */
  let rev = 0, draft = null, dirty = false, tab = "videos", saving = false, saveErrors = [], addLog = [];
  const loaded = await api("GET", "/api/admin/site");
  rev = loaded.rev; draft = clone(loaded.site);

  /* ---------- shell ---------- */
  const css = h("link", { rel: "stylesheet", href: url("_admin/admin.css"), id: "studioCss" });
  document.head.append(css);
  const status = h("span", { class: "st-status" });
  const saveBtn = h("button", { class: "st-btn primary", type: "button", onclick: save }, "Save");
  const discardBtn = h("button", { class: "st-btn", type: "button", onclick: () => twoClick(discardBtn, "Discard changes?", reloadFromServer) }, "Discard");
  const closeBtn = h("button", { class: "st-btn", type: "button", onclick: () => (dirty ? twoClick(closeBtn, "Leave without saving?", closeStudio) : closeStudio()) }, "View site");
  const outBtn = h("button", { class: "st-btn", type: "button", onclick: signOut }, "Sign out");
  const tabs = h("nav", { class: "st-nav", "aria-label": "Dashboard sections" });
  const main = h("main", { class: "st-main", id: "stMain" });
  const toastEl = h("div", { class: "st-toast", role: "status", "aria-live": "polite" });
  const root = h("div", { id: "studio", class: "studio", role: "dialog", "aria-modal": "true", "aria-label": "BlueToon Studio dashboard" },
    h("header", { class: "st-top" },
      h("div", { class: "st-brand" }, h("img", { src: draft.brand.logo, alt: "", width: 34, height: 34 }), h("div", {}, h("b", {}, "Studio"), h("span", {}, "Private dashboard"))),
      status, h("div", { class: "st-actions" }, discardBtn, saveBtn, closeBtn, outBtn)),
    h("div", { class: "st-body" }, tabs, main), toastEl);
  document.body.append(root);
  document.body.classList.add("studio-open");
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } };
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
  addEventListener("keydown", onKey);
  addEventListener("beforeunload", onUnload);

  function closeStudio() {
    removeEventListener("keydown", onKey);
    removeEventListener("beforeunload", onUnload);
    try { BT.applyTheme(BT.getData().theme); } catch { /* ignore */ }
    root.remove(); css.remove();
    document.body.classList.remove("studio-open");
  }
  function expired() { closeStudio(); BT.toast(onGithub ? "GitHub did not accept the token. Type the secret word to sign in again." : "Your session ended. Type the secret word to sign in again."); }
  async function signOut() { try { if (backend && backend.signOut) backend.signOut(); else await api("POST", "/api/logout", {}); } catch { /* ignore */ } closeStudio(); BT.toast("Signed out"); }
  function say(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(say.t); say.t = setTimeout(() => toastEl.classList.remove("show"), 3200); }

  function mark() { dirty = true; paintStatus(); }
  function paintStatus() {
    status.textContent = saving ? "Saving..." : dirty ? "Unsaved changes" : "All changes saved";
    status.className = "st-status " + (saving ? "busy" : dirty ? "dirty" : "clean");
    saveBtn.disabled = saving || !dirty;
    discardBtn.disabled = saving || !dirty;
  }
  // First click arms the button, second click inside 3 seconds runs the action (dialogs are not used).
  function twoClick(btn, armedLabel, fn) {
    if (btn.dataset.armed) { clearTimeout(btn._t); delete btn.dataset.armed; btn.textContent = btn._label; btn.classList.remove("armed"); fn(); return; }
    btn._label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = armedLabel; btn.classList.add("armed");
    btn._t = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn._label; btn.classList.remove("armed"); }, 3000);
  }

  async function reloadFromServer() {
    const d = await api("GET", "/api/admin/site");
    rev = d.rev; draft = clone(d.site); dirty = false; saveErrors = []; BT.applyTheme(draft.theme); paintStatus(); renderTab();
  }
  async function save() {
    if (saving || !dirty) return;
    saving = true; saveErrors = []; paintStatus();
    try {
      const data = await api("PUT", "/api/site", { rev, site: draft });
      rev = data.rev; draft = clone(data.site); dirty = false;
      BT.render(clone(data.site));
      say(onGithub ? "Saved to GitHub. The site updates in about a minute." : "Saved. The live site is updated.");
    } catch (e) {
      if (e.status === 400 && e.data && e.data.errors) saveErrors = e.data.errors;
      else saveErrors = [e.message];
      say("Not saved. See the red box at the top.");
    } finally { saving = false; paintStatus(); renderTab(); }
  }

  /* ---------- small builders ---------- */
  function field(label, control, hint) { return h("label", { class: "st-field" }, h("span", {}, label), control, hint ? h("small", {}, hint) : null); }
  function text(obj, key, { label, max = 100, placeholder = "", type = "text", area = false, dir = "auto", hint } = {}) {
    const el = h(area ? "textarea" : "input", { type: area ? null : type, maxlength: String(max), placeholder, dir, rows: area ? "3" : null });
    el.value = obj[key] ?? "";
    el.addEventListener("input", () => { obj[key] = type === "number" ? Number(el.value) : el.value; mark(); });
    return field(label, el, hint);
  }
  function select(obj, key, options, { label, onChange } = {}) {
    const el = h("select", {}, options.map(([v, t]) => h("option", { value: v }, t)));
    el.value = obj[key] ?? "";
    el.addEventListener("change", () => { obj[key] = el.value || null; mark(); if (onChange) onChange(); });
    return label ? field(label, el) : el;
  }
  const move = (arr, from, to) => { const [it] = arr.splice(from, 1); arr.splice(to, 0, it); };
  let drag = null;
  function sortRow(arr, i, body, rerender, { onDelete } = {}) {
    const el = h("div", { class: "st-row" });
    const handle = h("button", { class: "st-handle", type: "button", "aria-label": "Drag to reorder", title: "Drag to reorder" }, "⠿");
    handle.addEventListener("pointerdown", () => { el.draggable = true; });
    handle.addEventListener("pointerup", () => { el.draggable = false; });
    el.addEventListener("dragstart", (e) => { if (!el.draggable) { e.preventDefault(); return; } drag = { arr, from: i }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); el.classList.add("dragging"); });
    el.addEventListener("dragend", () => { el.draggable = false; el.classList.remove("dragging"); drag = null; });
    el.addEventListener("dragover", (e) => { if (drag && drag.arr === arr) { e.preventDefault(); el.classList.add("over"); } });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("over"); if (drag && drag.arr === arr && drag.from !== i) { move(arr, drag.from, i); mark(); rerender(); } });
    const up = h("button", { class: "st-icon", type: "button", "aria-label": "Move up", title: "Move up", disabled: i === 0, onclick() { move(arr, i, i - 1); mark(); rerender(); } }, "↑");
    const down = h("button", { class: "st-icon", type: "button", "aria-label": "Move down", title: "Move down", disabled: i === arr.length - 1, onclick() { move(arr, i, i + 1); mark(); rerender(); } }, "↓");
    const del = h("button", { class: "st-icon danger", type: "button", "aria-label": "Delete", title: "Delete (click twice)" }, "✕");
    del.addEventListener("click", () => twoClick(del, "Sure?", () => { const [gone] = arr.splice(i, 1); if (onDelete) onDelete(gone); mark(); rerender(); }));
    el.append(handle, h("div", { class: "st-row-body" }, body), h("div", { class: "st-row-ctl" }, up, down, del));
    return el;
  }
  async function upload(file) {
    if (!file) return null;
    if (file.size > 4 * 1024 * 1024) throw new Error("Image is larger than 4 MB");
    return (await api("POST", "/api/upload", undefined, file)).path;
  }
  function imageField(obj, key, label, { round = true } = {}) {
    const prev = h("div", { class: "st-img" + (round ? " round" : "") });
    const paint = () => { prev.replaceChildren(obj[key] ? h("img", { src: (backend && backend.preview && backend.preview(obj[key])) || url(obj[key]), alt: "" }) : h("span", {}, "No image")); };
    const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true });
    file.addEventListener("change", async () => {
      try { const p = await upload(file.files[0]); if (p) { obj[key] = p; mark(); paint(); say("Image uploaded. Remember to save."); } }
      catch (e) { say(e.message); }
      file.value = "";
    });
    paint();
    return h("div", { class: "st-field" }, h("span", {}, label), h("div", { class: "st-img-row" }, prev, h("div", { class: "st-stack" },
      h("button", { class: "st-btn", type: "button", onclick: () => file.click() }, "Upload image"),
      obj[key] && key !== "logo" ? h("button", { class: "st-btn", type: "button", onclick() { obj[key] = null; mark(); paint(); renderTab(); } }, "Remove") : null), file));
  }

  /* ---------- tabs ---------- */
  const TABS = [["videos", "Videos"], ["channels", "Channels"], ["accounts", "Accounts"], ["services", "Services"], ["design", "Design"], ["profile", "Profile and About"], ["security", "Security"]].filter(([k]) => !(onGithub && k === "security"));
  function renderTab() {
    tabs.replaceChildren(...TABS.map(([k, t]) => h("button", { type: "button", class: "st-tab", "aria-current": String(tab === k), onclick() { tab = k; renderTab(); } }, t, k === "videos" ? h("em", {}, String(draft.videos.length)) : k === "channels" ? h("em", {}, String(draft.channels.length)) : null)));
    const view = { videos: tabVideos, channels: tabChannels, accounts: tabAccounts, services: tabServices, design: tabDesign, profile: tabProfile, security: tabSecurity }[tab]();
    main.replaceChildren(
      saveErrors.length ? h("div", { class: "st-errors", role: "alert" }, h("b", {}, "Could not save:"), h("ul", {}, saveErrors.map((e) => h("li", {}, e)))) : null,
      view);
    paintStatus();
  }
  const head = (title, sub) => h("div", { class: "st-head" }, h("h1", {}, title), sub ? h("p", {}, sub) : null);

  /* Videos */
  function matchChannel(name) {
    const n = norm(name);
    if (!n) return null;
    const c = draft.channels.find((x) => n === norm(x.name) || (x.handle && n.includes(norm(x.handle.replace(/^@/, "")))));
    return c ? c.id : null;
  }
  function tabVideos() {
    const ta = h("textarea", { id: "addLinks", rows: "3", placeholder: "Paste YouTube links, one per line\nhttps://youtu.be/xxxxxxxxxxx", dir: "ltr", spellcheck: "false" });
    const addBtn = h("button", { class: "st-btn primary", type: "button" }, "Fetch and add");
    addBtn.addEventListener("click", async () => {
      const inputs = ta.value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      if (!inputs.length) return;
      addBtn.disabled = true; addBtn.textContent = "Fetching...";
      try {
        const { results } = await api("POST", "/api/video-info", { inputs });
        addLog = results.map((r) => {
          if (!r.ok) return { bad: true, msg: `${r.input}: ${r.error}` };
          if (draft.videos.some((v) => v.id === r.id)) return { bad: true, msg: `${r.id}: already in your list` };
          draft.videos.push({ id: r.id, title: r.info.title || "", channelName: r.info.channelName || "", channelUrl: r.info.channelUrl || "", channelId: matchChannel(r.info.channelName), hidden: false, views: r.info.views, duration: r.info.duration });
          return { msg: `Added: ${r.info.title || r.id}` + (r.info.pending ? " (title and views are filled in a minute after you save)" : "") };
        });
        if (addLog.some((l) => !l.bad)) mark();
        ta.value = "";
      } catch (e) { addLog = [{ bad: true, msg: e.message }]; }
      renderTab();
    });
    const refresh = h("button", { class: "st-btn", type: "button" }, "Refresh view counts");
    refresh.addEventListener("click", async () => {
      refresh.disabled = true; refresh.textContent = "Refreshing...";
      try {
        const r = await api("POST", "/api/refresh-stats", {});
        if (r.queued) { say("Refresh started on GitHub. Reload the dashboard in a minute or two."); renderTab(); return; }
        const by = new Map(r.site.videos.map((v) => [v.id, v]));
        draft.videos.forEach((v) => { const s = by.get(v.id); if (s) { v.views = s.views; v.duration = s.duration; v.published = s.published; } });
        say(`Updated ${r.ok} video(s)` + (r.failed ? `, ${r.failed} could not be read` : ""));
      } catch (e) { say(e.message); }
      renderTab();
    });
    const list = h("div", { class: "st-list" }, draft.videos.map((v, i) => sortRow(draft.videos, i, videoBody(v), renderTab)));
    return h("div", {},
      head("Videos", "Everything here appears in the Work section, in this order. Thumbnails and view counts come from YouTube automatically."),
      h("section", { class: "st-card" }, h("h2", {}, "Add videos"), field("YouTube links", ta, "youtu.be, youtube.com/watch, shorts and embed links all work."), h("div", { class: "st-inline" }, addBtn, refresh),
        addLog.length ? h("ul", { class: "st-log" }, addLog.map((l) => h("li", { class: l.bad ? "bad" : "ok" }, l.msg))) : null),
      h("h2", { class: "st-sub" }, `${draft.videos.length} video(s)`),
      draft.videos.length ? list : h("p", { class: "st-empty" }, "No videos yet. Paste a link above."));
  }
  function videoBody(v) {
    const chOpts = [["", "(no channel)"], ...draft.channels.map((c) => [c.id, c.name])];
    const stats = [v.views != null ? `${compact(v.views)} views (${Number(v.views).toLocaleString("en-US")})` : "views not available yet", v.duration ? dur(v.duration) : null, v.published || null].filter(Boolean).join("  ·  ");
    const create = !v.channelId && v.channelName && v.channelUrl ? h("button", { class: "st-btn small", type: "button" }, `Add "${v.channelName}" as a channel`) : null;
    if (create) create.addEventListener("click", async () => {
      create.disabled = true; create.textContent = "Reading channel...";
      try {
        const info = await api("POST", "/api/channel-info", { url: v.channelUrl });
        const ch = { id: rid("ch"), name: info.name || v.channelName, handle: info.handle || "", url: info.url, blurb: info.blurb || "", avatar: info.avatar || null, banner: null, monogram: (info.name || v.channelName).slice(0, 2) };
        draft.channels.push(ch);
        draft.videos.forEach((x) => { if (!x.channelId && x.channelName === v.channelName) x.channelId = ch.id; });
        mark(); say("Channel added. Check its details in Channels.");
      } catch (e) { say(e.message); }
      renderTab();
    });
    return h("div", { class: "st-video" },
      h("a", { class: "st-thumb", href: `https://www.youtube.com/watch?v=${v.id}`, target: "_blank", rel: "noopener noreferrer", title: "Open on YouTube" }, h("img", { src: `https://img.youtube.com/vi/${v.id}/mqdefault.jpg`, alt: "", loading: "lazy" })),
      h("div", { class: "st-fields" },
        text(v, "title", { label: "Title", max: 200, placeholder: "Video title" }),
        h("div", { class: "st-two" }, select(v, "channelId", chOpts, { label: "Channel" }),
          h("label", { class: "st-check" }, h("input", { type: "checkbox", checked: !v.hidden, onchange(e) { v.hidden = !e.target.checked; mark(); } }), h("span", {}, "Show on the site"))),
        h("p", { class: "st-meta" }, stats), create));
  }

  /* Channels */
  function tabChannels() {
    const url = h("input", { type: "url", placeholder: "https://www.youtube.com/@channel", dir: "ltr", id: "chUrl" });
    const add = h("button", { class: "st-btn primary", type: "button" }, "Fetch and add");
    add.addEventListener("click", async () => {
      if (!url.value.trim()) return;
      add.disabled = true; add.textContent = "Reading channel...";
      try {
        const i = await api("POST", "/api/channel-info", { url: url.value.trim() });
        draft.channels.push({ id: rid("ch"), name: i.name, handle: i.handle || "", url: i.url, blurb: i.blurb || "", avatar: i.avatar || null, banner: null, monogram: i.name.slice(0, 2) });
        mark(); url.value = ""; say(i.pending ? "Channel added. Its name, logo and description are filled in a minute after you save." : "Channel added with its name and logo.");
      } catch (e) { say(e.message); }
      renderTab();
    });
    const manual = h("button", { class: "st-btn", type: "button", onclick() { draft.channels.push({ id: rid("ch"), name: "New channel", handle: "", url: "https://www.youtube.com/", blurb: "", avatar: null, banner: null, monogram: "NC" }); mark(); renderTab(); } }, "Add manually");
    return h("div", {},
      head("Channels", "People and channels you work with. They appear in the Featured channels section."),
      h("section", { class: "st-card" }, h("h2", {}, "Add a channel"), field("Channel link", url, "The name, logo and description are read from YouTube."), h("div", { class: "st-inline" }, add, manual)),
      h("div", { class: "st-list" }, draft.channels.map((c, i) => sortRow(draft.channels, i, channelBody(c), renderTab, { onDelete: (gone) => draft.videos.forEach((v) => { if (v.channelId === gone.id) v.channelId = null; }) }))));
  }
  function channelBody(c) {
    return h("div", { class: "st-fields" },
      h("div", { class: "st-two" }, text(c, "name", { label: "Name", max: 60 }), text(c, "handle", { label: "Handle", max: 40, placeholder: "@handle", dir: "ltr" })),
      text(c, "url", { label: "Channel link (https)", max: 300, type: "url", dir: "ltr" }),
      text(c, "blurb", { label: "Short description", max: 220, area: true }),
      h("div", { class: "st-two" }, imageField(c, "avatar", "Logo / avatar"), imageField(c, "banner", "Banner (optional)", { round: false })),
      text(c, "monogram", { label: "Initials (used when there is no logo)", max: 3 }));
  }

  /* Accounts */
  function tabAccounts() {
    const sel = h("select", { id: "newAcc" }, Object.entries(TYPE_LABELS).map(([k, t]) => h("option", { value: k }, t)));
    const add = h("button", { class: "st-btn primary", type: "button", onclick() { const t = sel.value; draft.accounts.push({ id: rid("ac"), type: t, label: TYPE_LABELS[t], value: "", url: "" }); mark(); renderTab(); } }, "Add account");
    return h("div", {},
      head("Accounts", "Your contact links. They appear in the Contact section and the footer."),
      h("section", { class: "st-card" }, h("h2", {}, "Add an account"), h("div", { class: "st-inline" }, sel, add)),
      h("div", { class: "st-list" }, draft.accounts.map((a, i) => sortRow(draft.accounts, i, h("div", { class: "st-fields" },
        h("div", { class: "st-two" }, select(a, "type", Object.entries(TYPE_LABELS), { label: "Type", onChange: renderTab }), text(a, "label", { label: "Label", max: 30 })),
        text(a, "value", { label: a.type === "email" ? "Email address" : a.type === "discord" ? "Discord username" : "Shown text", max: 120, dir: "ltr", placeholder: a.type === "email" ? "name@example.com" : "@handle" }),
        a.type === "email" ? null : text(a, "url", { label: a.type === "discord" ? "Invite or profile link (optional)" : "Link (https)", max: 300, type: "url", dir: "ltr", hint: a.type === "discord" ? "Leave empty if you only want to show the username." : null })), renderTab))));
  }

  /* Services */
  function tabServices() {
    return h("div", {},
      head("Services", "What you offer. Shown as cards in the Services section."),
      h("div", { class: "st-list" }, draft.services.map((s, i) => sortRow(draft.services, i, h("div", { class: "st-fields" }, text(s, "title", { label: "Title", max: 60 }), text(s, "text", { label: "Description", max: 300, area: true })), renderTab))),
      h("button", { class: "st-btn primary", type: "button", onclick() { draft.services.push({ title: "New service", text: "" }); mark(); renderTab(); } }, "Add service"));
  }

  /* Profile + About */
  function tabProfile() {
    const aboutRows = draft.about.map((_, i) => { const holder = { get t() { return draft.about[i]; }, set t(v) { draft.about[i] = v; } }; return sortRow(draft.about, i, text(holder, "t", { label: `Paragraph ${i + 1}`, max: 600, area: true }), renderTab); });
    return h("div", {},
      head("Profile and About", "Your name, logo and the text about you."),
      h("section", { class: "st-card" },
        h("div", { class: "st-two" }, text(draft.brand, "name", { label: "Brand name", max: 40 }), text(draft.brand, "years", { label: "Years of experience", type: "number", max: 3 })),
        text(draft.brand, "tagline", { label: "Tagline (small text above the name)", max: 100 }),
        text(draft.brand, "heroLine", { label: "Headline sentence", max: 140 }),
        imageField(draft.brand, "logo", "Logo (top-left and hero)")),
      h("h2", { class: "st-sub" }, "About text"),
      h("div", { class: "st-list" }, aboutRows),
      h("button", { class: "st-btn primary", type: "button", onclick() { draft.about.push(""); mark(); renderTab(); } }, "Add paragraph"));
  }

  /* Design */
  const PRESETS = {
    cobalt:   ["Cobalt",   { bg: "#060b1a", panel: "#0d1738", fg: "#eaf0ff", muted: "#93a0c8", accent: "#2f6bff", accent2: "#6fa0ff" }],
    midnight: ["Violet",   { bg: "#0b0716", panel: "#1a1233", fg: "#f1ecff", muted: "#a79bc9", accent: "#8b5cf6", accent2: "#b79cff" }],
    ember:    ["Ember",    { bg: "#150a07", panel: "#2a140d", fg: "#fff0e8", muted: "#c9a597", accent: "#ff5a1f", accent2: "#ff9a6b" }],
    forest:   ["Forest",   { bg: "#06130e", panel: "#0d2a1f", fg: "#e9fff4", muted: "#8fc4a9", accent: "#18c27a", accent2: "#6fe0b0" }],
    rose:     ["Rose",     { bg: "#16060f", panel: "#2e0e21", fg: "#ffeaf4", muted: "#cf9bb6", accent: "#ff3d8b", accent2: "#ff8cb9" }],
    mono:     ["Mono",     { bg: "#0a0a0a", panel: "#161616", fg: "#f4f4f4", muted: "#9a9a9a", accent: "#e5e5e5", accent2: "#ffffff" }],
    gold:     ["Gold",     { bg: "#100c04", panel: "#241a08", fg: "#fff7e0", muted: "#c7b27a", accent: "#f5b301", accent2: "#ffd75e" }],
    daylight: ["Daylight", { bg: "#f4f6fb", panel: "#ffffff", fg: "#0c1430", muted: "#56627f", accent: "#2f6bff", accent2: "#1d4ed8" }],
  };
  const COLOR_LABELS = [["bg", "Background"], ["panel", "Cards and panels"], ["fg", "Main text"], ["muted", "Soft text"], ["accent", "Accent"], ["accent2", "Accent highlight"]];
  const FONT_LABELS = [["studio", "Studio (default, modern)"], ["bold", "Bold (heavy headlines)"], ["clean", "Clean (system)"], ["editorial", "Editorial (serif headlines)"]];
  const CORNER_LABELS = [["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]];
  const EFFECT_LABELS = [["grain", "Film grain"], ["cursor", "Custom cursor"], ["timeline", "Hero timeline and playhead"], ["ghost", "Big faded total-views number"], ["portrait", "Hero portrait"], ["rec", "REC timecode badge"]];
  const lumOf = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function tabDesign() {
    const t = draft.theme = draft.theme || { preset: "cobalt", colors: clone(PRESETS.cobalt[1]), fonts: "studio", corners: "soft", effects: {} };
    t.colors = t.colors || {}; t.effects = t.effects || {};
    const apply = () => { mark(); BT.applyTheme(t); };
    const warn = h("p", { class: "st-note", role: "status" });
    const checkContrast = () => {
      const r1 = ratio(t.colors.fg, t.colors.bg), r2 = ratio(t.colors.muted, t.colors.bg), r3 = ratio(t.colors.fg, t.colors.panel);
      const low = Math.min(r1, r3) < 4.5 ? "Main text is hard to read on the background or cards. Pick lighter text on dark colours, or darker text on light colours." : r2 < 3 ? "Soft text is very faint on the background." : "";
      warn.textContent = low || "Text contrast looks good."; warn.className = "st-note " + (low ? "bad" : "ok");
    };
    const presetBtns = Object.entries(PRESETS).map(([k, [name, c]]) => {
      const b = h("button", { type: "button", class: "st-btn", "aria-pressed": String(t.preset === k), title: name, onclick() { t.preset = k; t.colors = clone(c); apply(); renderTab(); } },
        h("span", { class: "st-swatch", "aria-hidden": "true", style: `background:linear-gradient(135deg,${c.bg} 0 45%,${c.accent} 45% 100%)` }), name);
      return b;
    });
    const pickers = COLOR_LABELS.map(([k, label]) => {
      const el = h("input", { type: "color", "aria-label": label });
      el.value = t.colors[k] || PRESETS.cobalt[1][k];
      const hex = h("code", {}, el.value);
      el.addEventListener("input", () => { t.colors[k] = el.value.toLowerCase(); t.preset = "custom"; hex.textContent = el.value; checkContrast(); apply(); });
      return h("label", { class: "st-field st-color" }, h("span", {}, label), h("div", { class: "st-inline" }, el, hex));
    });
    const effects = EFFECT_LABELS.map(([k, label]) => {
      const el = h("input", { type: "checkbox" });
      el.checked = t.effects[k] !== false;
      el.addEventListener("change", () => { t.effects[k] = el.checked; apply(); });
      return h("label", { class: "st-check" }, el, h("span", {}, label));
    });
    checkContrast();
    return h("div", {},
      head("Design", "Change the look of the whole site. You see the change live behind this panel; press Save to publish it."),
      h("section", { class: "st-card" }, h("h2", {}, "Themes"), h("div", { class: "st-inline st-wrap" }, presetBtns)),
      h("section", { class: "st-card" }, h("h2", {}, "Colours"), h("div", { class: "st-two st-colors" }, pickers), warn),
      h("section", { class: "st-card" }, h("h2", {}, "Type and shape"),
        h("div", { class: "st-two" },
          select(t, "fonts", FONT_LABELS, { label: "Fonts", onChange: () => BT.applyTheme(t) }),
          select(t, "corners", CORNER_LABELS, { label: "Corners", onChange: () => BT.applyTheme(t) }))),
      h("section", { class: "st-card" }, h("h2", {}, "Effects"), h("div", { class: "st-stack" }, effects)),
      h("button", { class: "st-btn", type: "button", onclick() { t.preset = "cobalt"; t.colors = clone(PRESETS.cobalt[1]); t.fonts = "studio"; t.corners = "soft"; t.effects = {}; apply(); renderTab(); } }, "Reset design to default"));
  }

  /* Security */
  function tabSecurity() {
    const cur = h("input", { type: "password", autocomplete: "current-password", id: "pwCur", maxlength: "200" });
    const nw = h("input", { type: "password", autocomplete: "new-password", id: "pwNew", maxlength: "200" });
    const rp = h("input", { type: "password", autocomplete: "new-password", id: "pwRep", maxlength: "200" });
    const msg = h("p", { class: "st-note", role: "status" });
    const btn = h("button", { class: "st-btn primary", type: "button" }, "Change password");
    btn.addEventListener("click", async () => {
      msg.className = "st-note";
      if (nw.value.length < 12) { msg.textContent = "Use at least 12 characters."; msg.classList.add("bad"); return; }
      if (nw.value !== rp.value) { msg.textContent = "The two new passwords do not match."; msg.classList.add("bad"); return; }
      btn.disabled = true;
      try { await api("POST", "/api/password", { current: cur.value, next: nw.value }); msg.textContent = "Password changed. Other sessions were signed out."; msg.classList.add("ok"); cur.value = nw.value = rp.value = ""; }
      catch (e) { msg.textContent = e.message; msg.classList.add("bad"); }
      btn.disabled = false;
    });
    return h("div", {}, head("Security", "Change the dashboard password."),
      h("section", { class: "st-card" },
        field("Current password", cur), field("New password", nw, "At least 12 characters. A long phrase is better than a short complicated word."), field("Repeat new password", rp), h("div", { class: "st-inline" }, btn), msg),
      h("section", { class: "st-card" }, h("h2", {}, "Good to know"), h("ul", { class: "st-tips" },
        h("li", {}, "Five wrong passwords lock sign-in from that connection for 15 minutes."),
        h("li", {}, "Sessions end after 2 idle hours or 12 hours in total."),
        h("li", {}, "Every save keeps a backup copy on the server (last 30)."))));
  }

  paintStatus();
  renderTab();
  root.querySelector(".st-tab").focus();
}
