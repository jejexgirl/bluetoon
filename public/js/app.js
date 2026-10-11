(() => {
  "use strict";
  const DEFAULTS = window.PORTFOLIO;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let DATA = null;
  let videos = [];
  let activeFilter = "all";

  /* ---------- helpers ---------- */
  // Builds DOM with text nodes only, so content saved from the dashboard can never inject markup.
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const NS = "http://www.w3.org/2000/svg";
  function svg(pathD, { stroke = false, extra } = {}) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", pathD);
    s.append(p);
    if (extra) s.append(extra);
    return s;
  }
  const ICONS = {
    mail: "M2 5.5A1.5 1.5 0 013.5 4h17A1.5 1.5 0 0122 5.5v13a1.5 1.5 0 01-1.5 1.5h-17A1.5 1.5 0 012 18.5zM4 7.3V18h16V7.3l-8 5.6z",
    instagram: "M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 4 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1 0 8.3 0 8.7 0 12s0 3.7.1 4.9c.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24s3.7 0 4.9-.1c4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9s0-3.7-.1-4.9c-.2-4.4-2.6-6.8-7-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 100 12.4 6.2 6.2 0 000-12.4zM12 16a4 4 0 110-8 4 4 0 010 8zm6.4-11.8a1.4 1.4 0 100 2.9 1.4 1.4 0 000-2.9z",
    youtube: "M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6z",
    discord: "M20.3 4.4A19.8 19.8 0 0015.4 3l-.2.5a18 18 0 00-4.4 0L10.6 3a19.7 19.7 0 00-4.9 1.4C2.6 9 1.8 13.5 2.2 17.9a19.9 19.9 0 006 3l.7-1.2a13 13 0 01-2-1l.5-.4a14 14 0 0012.1 0l.5.4c-.6.4-1.3.7-2 1l.7 1.2a19.8 19.8 0 006-3c.5-5.1-.8-9.5-3.4-13.5zM8.7 15.2c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4z",
    tiktok: "M19.6 6.7a4.8 4.8 0 01-3.8-4.2h-3.3v13.5a2.8 2.8 0 11-2.8-2.8c.3 0 .6 0 .8.1V9.9a6.2 6.2 0 106.2 6.2V9.1a8 8 0 004.7 1.5V7.3a4.8 4.8 0 01-1.8-.6z",
    x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
    link: "M10.6 13.4a1 1 0 010-1.4l3-3a3 3 0 114.2 4.2l-1.5 1.5-1.4-1.4 1.5-1.5a1 1 0 00-1.4-1.4l-3 3a1 1 0 01-1.4 0zm2.8-2.8a1 1 0 010 1.4l-3 3a3 3 0 11-4.2-4.2l1.5-1.5 1.4 1.4-1.5 1.5a1 1 0 001.4 1.4l3-3a1 1 0 011.4 0z",
  };
  const iconFor = (type) => svg(ICONS[type === "email" ? "mail" : type] || ICONS.link);
  const EYE = () => { const s = svg("M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"); const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "3"); s.append(c); s.setAttribute("class", "eye"); return s; };

  const safeHttps = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
  const safeImg = (p) => (typeof p === "string" && /^(assets|uploads)\/[\w.-]+$/.test(p) ? p : null);
  const EMAIL_RE = /^[^\s@<>"'()\\,;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
  const pad = (n) => String(n).padStart(2, "0");
  const norm = (t) => (t || "").toLowerCase().replace(/[\s|]+/g, "");
  const nf = (n) => {
    const f = (x, suf) => (Math.floor(x * 10) / 10).toString().replace(/\.0+$/, "") + suf;
    if (n >= 1e9) return f(n / 1e9, "B");
    if (n >= 1e6) return f(n / 1e6, "M");
    if (n >= 1e3) return f(n / 1e3, "K");
    return String(n);
  };
  const fmtDur = (sec) => { const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (hh ? hh + ":" + pad(m) : m) + ":" + pad(s); };

  /* ---------- toast + clipboard ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch {
      const ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0;top:0;left:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
      toast(ok ? okMsg : "Copy failed. Select the text and copy it manually.");
    }
  }

  /* ---------- data ---------- */
  async function load() {
    // The Node server answers api/site; on GitHub Pages there is no server, so the build publishes data/site.json instead.
    for (const url of ["api/site", "data/site.json"]) {
      try {
        const r = await fetch(url, { cache: "no-store", credentials: "same-origin" });
        if (!r.ok || !/json/i.test(r.headers.get("content-type") || "")) continue;
        const j = await r.json();
        if (j && Array.isArray(j.videos) && Array.isArray(j.channels)) return j;
      } catch { /* try the next source */ }
    }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  const channelOf = (v) => DATA.channels.find((c) => c.id === v.channelId) || DATA.channels.find((c) => v.channelName && (norm(v.channelName) === norm(c.name) || (c.handle && norm(v.channelName).includes(norm(c.handle.replace(/^@/, ""))))));
  const channelLabel = (v) => { const c = channelOf(v); return c ? c.name : v.channelName || ""; };
  const displayTitle = (v) => v.title || `Project ${pad(v.n)}`;

  /* ---------- brand / hero ---------- */
  function splitName(name) { const m = /^(.*?)(toon)$/i.exec(name); return m && m[1] ? [m[1], m[2]] : [name, ""]; }
  function renderBrand() {
    const b = DATA.brand || DEFAULTS.brand;
    const [a, c] = splitName(b.name);
    $$("[data-brandword]").forEach((n) => n.replaceChildren(a, h("b", {}, c)));
    $(".h-blue").textContent = a;
    $(".h-toon").textContent = c;
    $("#heroTagline").textContent = b.tagline || "";
    $("#heroLine").textContent = b.heroLine || "";
    $("#footBrand").textContent = b.name;
    $("#yearsNum").textContent = b.years;
    document.title = `${b.name} | Video Editor`;
    const logo = safeImg(b.logo);
    if (logo) $$("img[data-logo]").forEach((i) => (i.src = logo));
  }

  /* ---------- channels ---------- */
  function renderClients() {
    const grid = $("#clientGrid");
    grid.replaceChildren(...DATA.channels.map((c, i) => {
      const mono = () => h("div", { class: "avatar mono", "aria-hidden": "true" }, c.monogram || c.name.slice(0, 2));
      const av = safeImg(c.avatar);
      const avatar = av ? h("img", { class: "avatar", src: av, alt: `${c.name} channel logo`, width: 88, height: 88, loading: "lazy", onerror(e) { e.target.replaceWith(mono()); } }) : mono();
      const banner = safeImg(c.banner);
      return h("article", { class: "client reveal", style: `--d:${(i % 3) * 0.12}s` },
        banner ? h("img", { class: "client-banner", src: banner, alt: "", loading: "lazy" }) : null,
        h("div", { class: "client-top" }, avatar, h("div", {}, h("h3", { dir: "auto" }, c.name), h("div", { class: "handle" }, c.handle || ""))),
        h("p", { dir: "auto" }, c.blurb || ""),
        safeHttps(c.url) ? h("a", { class: "btn btn-primary", href: c.url, target: "_blank", rel: "noopener noreferrer" }, "Visit channel") : null);
    }));
    observeReveals(grid);
  }

  /* ---------- videos ---------- */
  function thumbImg(id) {
    const urls = ["maxresdefault", "sddefault", "hqdefault", "mqdefault"].map((q) => `https://img.youtube.com/vi/${id}/${q}.jpg`);
    const img = new Image();
    let i = 0;
    img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    img.onerror = () => { i++; if (i < urls.length) img.src = urls[i]; else img.remove(); };
    img.onload = () => { if (img.naturalWidth <= 120 && i < urls.length - 1) { i++; img.src = urls[i]; } }; // YouTube answers a missing maxres with a 120px placeholder
    img.src = urls[0];
    return img;
  }
  function metaNodes(v) {
    const nodes = [];
    if (v.views != null) { nodes.push(h("span", { class: "views", title: Number(v.views).toLocaleString("en-US") + " views" }, EYE(), nf(v.views) + " views")); }
    const c = channelOf(v), label = channelLabel(v) || "YouTube", av = c && safeImg(c.avatar);
    if (nodes.length) nodes.push(h("span", { class: "dot", "aria-hidden": "true" }, "·"));
    nodes.push(h("span", { class: "by" }, av ? h("img", { src: av, alt: "", width: 18, height: 18, loading: "lazy" }) : null, label));
    return nodes;
  }
  function buildCard(v, idx) {
    const play = h("span", { class: "play" });
    play.append(svg("M7 4.5v15l12-7.5z"));
    const hover = v.views != null ? h("span", { class: "hv" }, EYE(), h("b", {}, Number(v.views).toLocaleString("en-US")), " views") : null;
    const btn = h("button", { class: "card-btn", type: "button", "aria-label": `Play video: ${displayTitle(v)}${v.views != null ? `, ${Number(v.views).toLocaleString("en-US")} views` : ""}` },
      h("div", { class: "thumb" }, thumbImg(v.id), h("span", { class: "idx" }, pad(v.n)), v.duration ? h("span", { class: "dur" }, fmtDur(v.duration)) : null, hover, play));
    const card = h("article", { class: "card reveal" + (v.title ? "" : " pending"), "data-id": v.id, style: `--d:${(idx % 3) * 0.08}s` },
      btn, h("h3", { dir: "auto" }, displayTitle(v)), h("div", { class: "meta" }, metaNodes(v)));
    $(".thumb", card).addEventListener("pointermove", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      e.currentTarget.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    });
    return card;
  }
  function renderGrid() {
    videos = DATA.videos.filter((v) => !v.hidden).map((v, i) => ({ ...v, n: i + 1 }));
    const grid = $("#grid");
    grid.replaceChildren(...videos.map(buildCard));
    observeReveals(grid);
  }
  function renderFilters() {
    const box = $("#filters");
    const labels = [...new Set(videos.map(channelLabel).filter(Boolean))];
    if (activeFilter !== "all" && !labels.includes(activeFilter)) activeFilter = "all";
    if (labels.length < 2) { box.hidden = true; applyFilter(); return; }
    box.hidden = false;
    const mk = (label, key) => h("button", { type: "button", class: "chip", "aria-pressed": String(activeFilter === key), onclick() { activeFilter = key; applyFilter(); renderFilters(); } }, label);
    box.replaceChildren(mk("All", "all"), ...labels.map((l) => mk(l, l)));
    applyFilter();
  }
  function applyFilter() {
    videos.forEach((v) => { const card = $(`.card[data-id="${v.id}"]`); if (card) card.hidden = !(activeFilter === "all" || channelLabel(v) === activeFilter); });
  }

  /* ---------- services / about / contact ---------- */
  function renderServices() {
    $("#services").replaceChildren(...DATA.services.map((s, i) => h("article", { class: "service reveal", style: `--d:${(i % 3) * 0.08}s` }, h("h3", { dir: "auto" }, s.title), h("p", { dir: "auto" }, s.text || ""))));
    observeReveals($("#services"));
  }
  function renderAbout() { $("#aboutCopy").replaceChildren(...DATA.about.map((t) => h("p", { dir: "auto" }, t))); }
  function renderContact() {
    const items = DATA.accounts.map((a) => {
      const actions = [];
      if (a.type === "email" && EMAIL_RE.test(a.value)) {
        actions.push(h("a", { class: "btn btn-primary btn-sm", href: `mailto:${a.value}` }, "Send email"), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => copyText(a.value, "Email copied") }, "Copy address"));
      } else if (a.type === "discord") {
        actions.push(h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => copyText(a.value, "Discord username copied") }, "Copy username"));
        if (safeHttps(a.url)) actions.push(h("a", { class: "btn btn-ghost btn-sm", href: a.url, target: "_blank", rel: "noopener noreferrer" }, "Open Discord"));
      } else if (safeHttps(a.url)) {
        actions.push(h("a", { class: "btn btn-primary btn-sm", href: a.url, target: "_blank", rel: "noopener noreferrer" }, "Open " + a.label));
      }
      return h("li", { class: "contact-item" }, h("span", { class: "label" }, a.label), h("span", { class: "value", dir: "auto" }, a.value), h("div", { class: "row" }, actions));
    });
    $("#contactList").replaceChildren(...items);
    observeReveals($("#contactList").parentElement);

    $("#footerSocial").replaceChildren(...DATA.accounts.map((a) => {
      let el;
      if (a.type === "email" && EMAIL_RE.test(a.value)) el = h("a", { href: `mailto:${a.value}` });
      else if (a.type === "discord") el = h("button", { type: "button", onclick: () => copyText(a.value, "Discord username copied") });
      else if (safeHttps(a.url)) el = h("a", { href: a.url, target: "_blank", rel: "noopener noreferrer" });
      else return null;
      el.setAttribute("aria-label", a.type === "discord" ? `Copy ${a.label} username` : a.label);
      el.setAttribute("title", a.label);
      el.append(iconFor(a.type));
      return el;
    }).filter(Boolean));
  }

  /* ---------- total views ghost ---------- */
  let ghostBound = false;
  function renderGhost() {
    const el = $("#ghost");
    const total = DATA.videos.filter((v) => !v.hidden).reduce((a, v) => a + (Number(v.views) || 0), 0);
    if (total < 1000) { el.hidden = true; return; }
    $("#ghostNum").textContent = nf(total) + "+";
    el.hidden = false;
    const upd = () => { el.classList.toggle("on", scrollY > innerHeight * 0.55); if (!reduceMotion) el.style.setProperty("--gy", scrollY * -0.06 + "px"); };
    if (!ghostBound) { addEventListener("scroll", upd, { passive: true }); ghostBound = true; }
    upd();
  }

  /* ---------- reveals ---------- */
  let io;
  function observeReveals(root = document) {
    const els = $$(".reveal:not(.in)", root);
    if (reduceMotion || typeof IntersectionObserver === "undefined") { els.forEach((e) => e.classList.add("in")); return; }
    io = io || new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- nav ---------- */
  function initNav() {
    const nav = $("#nav"), toggle = $("#navToggle"), links = $("#navLinks");
    const onScroll = () => nav.classList.toggle("solid", scrollY > 40);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const setOpen = (open) => { links.classList.toggle("open", open); toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu"); };
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    links.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && links.classList.contains("open")) { setOpen(false); toggle.focus(); } });
    if (typeof IntersectionObserver !== "undefined") {
      const map = new Map($$(".nav-links a[href^='#']").map((a) => [a.getAttribute("href").slice(1), a]));
      const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
        const a = map.get(en.target.id);
        if (a && en.isIntersecting) { map.forEach((x) => x.classList.remove("active")); if (!a.classList.contains("nav-cta")) a.classList.add("active"); }
      }), { rootMargin: "-45% 0px -50% 0px" });
      map.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
    }
  }

  /* ---------- cursor + timecode ---------- */
  function initCursor() {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches || reduceMotion) return;
    document.body.classList.add("has-cursor");
    const dot = $("#cursorDot"), ring = $("#cursorRing");
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px,${y}px)`; }, { passive: true });
    document.addEventListener("pointerover", (e) => document.body.classList.toggle("cursor-hot", !!e.target.closest("a, button, .card")));
    (function loop() { rx += (x - rx) * 0.18; ry += (y - ry) * 0.18; ring.style.transform = `translate(${rx}px,${ry}px)`; requestAnimationFrame(loop); })();
  }
  function initTimecode() {
    const el = $("#tc");
    if (!el || reduceMotion) return;
    const t0 = performance.now();
    setInterval(() => {
      const f = Math.floor((performance.now() - t0) / 40), s = Math.floor(f / 25);
      el.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % 25)}`;
    }, 40);
  }
  function countUp() {
    const el = $("#yearsNum"), end = Number(el.textContent) || 0;
    if (reduceMotion || !end) return;
    let t0;
    el.textContent = "0";
    requestAnimationFrame(function step(t) {
      t0 = t0 || t;
      const p = Math.min((t - t0) / 1400, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    });
  }

  /* ---------- video modal ---------- */
  const modal = $("#modal"), dialog = $("#dialog"), closeBtn = $("#modalClose"), watchLink = $("#modalWatch"), frame = $(".frame");
  const pageRegions = () => $$("header.nav, main, footer, .skip");
  let player = null, lastFocus = null, apiPromise = null, openToken = 0, hideTimer = null;

  function loadYTApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === "function") prev(); resolve(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => { apiPromise = null; reject(new Error("YouTube API blocked")); };
      document.head.append(s);
      setTimeout(() => reject(new Error("YouTube API timeout")), 8000);
    });
    return apiPromise;
  }
  const resetFrame = () => frame.replaceChildren(h("div", { id: "player" }));
  function showEmbedFail(v, code) {
    const local = location.protocol === "file:";
    const msg = local ? "This page was opened from a file, so YouTube refuses to play videos inside it. Start the site with start.bat and open http://localhost:8080."
      : code === 153 ? "YouTube could not verify this site yet. Open the site over https or on localhost."
      : "This video can't be played on other sites.";
    try { if (player && player.destroy) player.destroy(); } catch { /* ignore */ }
    player = null;
    frame.replaceChildren(h("div", { class: "poster" },
      h("img", { src: `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`, alt: "" }),
      h("div", {}, h("p", {}, msg), h("a", { class: "btn btn-primary", href: `https://www.youtube.com/watch?v=${v.id}`, target: "_blank", rel: "noopener noreferrer" }, "Watch on YouTube"), h("small", {}, code ? `YouTube player error ${code}` : ""))));
  }
  function fallbackIframe(v) {
    resetFrame();
    $("#player").replaceWith(h("iframe", { src: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1`, title: displayTitle(v), allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" }));
  }
  async function mountPlayer(v) {
    const token = ++openToken;
    resetFrame();
    try { await loadYTApi(); } catch { if (token === openToken) fallbackIframe(v); return; }
    if (token !== openToken) return;
    const vars = { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    player = new YT.Player("player", { host: "https://www.youtube-nocookie.com", videoId: v.id, width: "100%", height: "100%", playerVars: vars, events: { onError: (e) => showEmbedFail(v, e && e.data) } });
  }
  function openVideo(v, trigger) {
    clearTimeout(hideTimer);
    lastFocus = trigger || document.activeElement;
    $("#modalTitle").textContent = displayTitle(v);
    $("#modalTitle").setAttribute("dir", "auto");
    $("#modalChannel").textContent = [channelLabel(v) || "YouTube", v.views != null ? Number(v.views).toLocaleString("en-US") + " views" : null].filter(Boolean).join("  ·  ");
    watchLink.href = `https://www.youtube.com/watch?v=${v.id}`;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    pageRegions().forEach((r) => r.setAttribute("inert", ""));
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add("open")));
    closeBtn.focus();
    mountPlayer(v);
  }
  function closeModal() {
    if (modal.hidden) return;
    openToken++;
    try { if (player && player.stopVideo) player.stopVideo(); } catch { /* ignore */ }
    try { if (player && player.destroy) player.destroy(); } catch { /* ignore */ }
    player = null;
    resetFrame(); // removes any iframe so audio can never continue
    modal.classList.remove("open");
    document.body.classList.remove("modal-open");
    pageRegions().forEach((r) => r.removeAttribute("inert"));
    hideTimer = setTimeout(() => { modal.hidden = true; }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function initModal() {
    $("#grid").addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const v = videos.find((x) => x.id === card.dataset.id);
      if (v) openVideo(v, $(".card-btn", card));
    });
    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target.closest(".frame") || e.target.closest("a")) return; closeModal(); });
    addEventListener("keydown", (e) => {
      if (modal.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
      if (e.key === "Tab") {
        const order = [closeBtn, watchLink], i = order.indexOf(document.activeElement);
        if (i === -1) { e.preventDefault(); closeBtn.focus(); }
        else if (e.shiftKey && i === 0) { e.preventDefault(); watchLink.focus(); }
        else if (!e.shiftKey && i === order.length - 1) { e.preventDefault(); closeBtn.focus(); }
      }
    });
  }

  /* ---------- render + boot ---------- */
  /* ---------- theme (colours, fonts, corners, effects from the dashboard) ---------- */
  const HEX = /^#[0-9a-f]{6}$/i;
  const FONTS = {
    studio: ['"Bricolage Grotesque", "Cairo", system-ui, sans-serif', '"Cairo", "Bricolage Grotesque", system-ui, sans-serif'],
    bold: ['"Arial Black", "Cairo", Impact, system-ui, sans-serif', '"Cairo", system-ui, sans-serif'],
    clean: ['system-ui, "Cairo", "Segoe UI", sans-serif', 'system-ui, "Cairo", "Segoe UI", sans-serif'],
    editorial: ['Georgia, "Cairo", "Times New Roman", serif', '"Cairo", Georgia, serif'],
  };
  const RK = { sharp: 0.25, soft: 1, round: 1.7 };
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function applyTheme(t) {
    t = t || DEFAULTS.theme;
    const d = DEFAULTS.theme, root = document.documentElement.style, c = t.colors || {};
    const col = {};
    for (const k of Object.keys(d.colors)) col[k] = HEX.test(c[k]) ? c[k] : d.colors[k];
    for (const k of Object.keys(col)) root.setProperty("--" + k, col[k]);
    root.setProperty("--bg-rgb", rgbOf(col.bg).join(", "));
    root.setProperty("--panel-rgb", rgbOf(col.panel).join(", "));
    root.setProperty("--accent-rgb", rgbOf(col.accent).join(", "));
    root.setProperty("--accent2-rgb", rgbOf(col.accent2).join(", "));
    root.setProperty("--on-accent", lum(col.accent) > 0.4 ? "#050816" : "#ffffff");
    root.setProperty("color-scheme", lum(col.bg) > 0.4 ? "light" : "dark");
    const f = FONTS[t.fonts] || FONTS.studio;
    root.setProperty("--font-display", f[0]);
    root.setProperty("--font-body", f[1]);
    root.setProperty("--rk", String(RK[t.corners] ?? 1));
    const e = Object.assign({}, d.effects, t.effects || {});
    for (const k of ["grain", "cursor", "timeline", "ghost", "portrait", "rec"]) document.body.classList.toggle("fx-no-" + k, e[k] === false);
  }

  function renderAll() {
    applyTheme(DATA.theme);
    renderBrand();
    renderClients();
    renderGrid();
    renderFilters();
    renderServices();
    renderAbout();
    renderContact();
    renderGhost();
  }
  async function boot() {
    $("#year").textContent = new Date().getFullYear();
    DATA = await load();
    renderAll();
    initNav();
    initCursor();
    initTimecode();
    initModal();
    observeReveals();
    countUp();
  }
  window.BT = {
    render(data) { DATA = data; renderAll(); },
    getData: () => DATA,
    applyTheme, toast, copyText, h,
  };
  window.BT.ready = boot();
})();
