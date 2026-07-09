(() => {
  const SITE_KEY = "0x4AAAAAADq4Kdp7DkhOnEgN";
  const ENDPOINT = "/api/contact";
  let loader = null;

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (loader) return loader;
    loader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => reject(new Error("Turnstile non disponibile."));
      document.head.appendChild(s);
    });
    return loader;
  }

  async function prepareForm(form) {
    if (!form || form.dataset.cfReady === "1") return;
    form.action = ENDPOINT;
    form.method = "post";
    let box = form.querySelector(".cf-turnstile-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "cf-turnstile-box";
      box.style.marginTop = "14px";
      const status = form.querySelector("#contactStatus") || form.querySelector(".form-alert");
      form.insertBefore(box, status || form.querySelector("button[type='submit']"));
    }
    const t = await loadTurnstile();
    if (box.dataset.widgetId) return;
    box.dataset.widgetId = t.render(box, { sitekey: SITE_KEY, theme: "auto" });
    form.dataset.cfReady = "1";
  }

  function prepareAll() {
    document.querySelectorAll("form.contact-form").forEach(form => prepareForm(form).catch(() => {}));
  }

  function status(form, cls, text) {
    const el = form.querySelector("#contactStatus") || form.querySelector(".form-alert");
    if (!el) return;
    el.className = "form-alert" + (cls ? " " + cls : "");
    el.textContent = text || "";
  }

  function resetTurnstile(form) {
    const box = form.querySelector(".cf-turnstile-box");
    if (window.turnstile && box && box.dataset.widgetId) {
      try { window.turnstile.reset(box.dataset.widgetId); } catch (e) {}
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }

  function slugFor(item, collection) {
    if (typeof window.objectSlug === "function") return window.objectSlug(item, collection);
    const base = item && (item.slug || item.name || item.title || item.id) || "partner";
    return String(base).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "partner";
  }

  function sponsorLogo(item) {
    if (typeof window.sponsorLogoHtml === "function") return window.sponsorLogoHtml(item);
    const logo = String((item && item.logo) || "").trim();
    const name = String((item && item.name) || "Partner").trim();
    if (logo && (/^https?:\/\//i.test(logo) || logo.startsWith("/") || /\.(png|jpe?g|webp|svg|gif)(\?.*)?$/i.test(logo))) {
      return `<img loading="lazy" src="${escapeHtml(logo)}" alt="Logo ${escapeHtml(name)}">`;
    }
    const fallback = logo || name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join("") || "SP";
    return `<span>${escapeHtml(fallback)}</span>`;
  }

  function installPartnerOverride() {
    let cachedSponsors = null;
    let loadingSponsors = null;

    function sponsorsFromState() {
      return Array.isArray(window.state && window.state.sponsors) ? window.state.sponsors : [];
    }

    function renderPartnerPage(sponsors) {
      const items = Array.isArray(sponsors) ? sponsors : [];
      const sponsorCards = items.map(s => `<article class="card card-pad sponsor-card"><div class="sponsor-logo">${sponsorLogo(s)}</div><h2 style="margin-top:8px">${escapeHtml(s.name || "Sponsor")}</h2><button class="btn soft" onclick="route('sponsor-detail-${escapeHtml(slugFor(s, 'sponsors'))}')" style="margin-top:10px">Scopri →</button></article>`).join("") || `<article class="card card-pad"><p class="muted">Nessun partner inserito.</p></article>`;
      if (typeof window.shell === "function") {
        window.shell("Partner", "Sponsor, partner e community del progetto", `<div class="grid grid-4 sponsor-grid-four">${sponsorCards}</div><div class="newsletter" style="margin-top:24px"><h2 style="font-size:38px">Vuoi diventare Partner CUS Trento C5?</h2><button class="btn ghost" onclick="route('become-partner')">Scopri come</button></div>`, "", "Sponsor e partner CUS Trento C5.");
      }
    }

    function loadSponsorsFromCms() {
      if (cachedSponsors) return Promise.resolve(cachedSponsors);
      if (loadingSponsors) return loadingSponsors;
      loadingSponsors = fetch("/content/cms/sponsors.json", { cache: "no-store" })
        .then(res => res.ok ? res.json() : Promise.reject(new Error("sponsors.json non disponibile")))
        .then(data => {
          cachedSponsors = Array.isArray(data && data.sponsors) ? data.sponsors : [];
          return cachedSponsors;
        })
        .catch(() => {
          cachedSponsors = [];
          return cachedSponsors;
        });
      return loadingSponsors;
    }

    window.sponsor = function() {
      const stateSponsors = sponsorsFromState();
      if (stateSponsors.length) {
        cachedSponsors = stateSponsors;
        renderPartnerPage(stateSponsors);
        return;
      }
      if (cachedSponsors && cachedSponsors.length) {
        renderPartnerPage(cachedSponsors);
        return;
      }
      if (typeof window.shell === "function") {
        window.shell("Partner", "Sponsor, partner e community del progetto", `<article class="card card-pad"><p class="muted">Caricamento partner...</p></article>`, "", "Sponsor e partner CUS Trento C5.");
      }
      loadSponsorsFromCms().then(renderPartnerPage);
    };
  }

  function refreshPartnerIfVisible() {
    const path = location.pathname.replace(/\/+$/, "/");
    if (path === "/partner/" || window.__cusActiveRoute === "partner") {
      setTimeout(() => {
        if (typeof window.route === "function") window.route("partner");
      }, 60);
    }
  }

  function isLocalUploadedImage(src) {
    try {
      const url = new URL(src, location.origin);
      return url.origin === location.origin && url.pathname.startsWith("/img/uploads/") && !url.pathname.endsWith("/img/placeholder.webp");
    } catch (e) {
      return String(src || "").startsWith("/img/uploads/");
    }
  }

  function installUploadedImageRetry() {
    document.addEventListener("error", function(event) {
      const img = event && event.target;
      if (!img || !img.tagName || img.tagName.toLowerCase() !== "img") return;
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (!isLocalUploadedImage(src)) return;
      if (img.dataset && img.dataset.uploadRetry === "1") return;
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (event.preventDefault) event.preventDefault();
      if (img.dataset) img.dataset.uploadRetry = "1";
      const separator = src.includes("?") ? "&" : "?";
      img.src = src + separator + "v=" + Date.now();
    }, true);
  }

  function installRealRouteLinks() {
    const paths = {
      home:"/", "teams-overview":"/squadre/", squad:"/squadra/", staff:"/staff/", stats:"/statistiche/", "play-with-us":"/gioca-con-noi/", fixtures:"/calendario/", standings:"/classifica/", coppa:"/coppa/", cnu:"/cnu/", "season-archive":"/archivio-stagioni/", matchday:"/matchday/", events:"/eventi/", "events:upcoming":"/eventi/#prossimi-eventi", "events:tournaments":"/eventi/#tornei", "events:selections":"/eventi/#selezioni", "events:archive":"/eventi/#archivio-eventi", partner:"/partner/", sponsor:"/partner/", "become-partner":"/diventa-partner/", news:"/news/", gallery:"/gallery/", video:"/video/", social:"/social/", "club-project":"/club/", club:"/club/", venue:"/impianto/", records:"/hall-of-fame/", contacts:"/contatti/", privacy:"/privacy/", cookies:"/cookies/"
    };
    const css = `html{scroll-behavior:auto!important}.nav a,.home-structure a,.cus-rework-page a{text-decoration:none}.nav-main{display:inline-flex;align-items:center;border:0}.dropdown a{display:block;width:100%;text-align:left;border-radius:16px;padding:11px 13px;background:#fff;font-weight:850;color:#3f3f46}.dropdown a:hover,.dropdown a.active{background:#f4f4f5;color:var(--red)}.mobile-menu a{display:block;width:100%;text-align:left;background:#f4f4f5;border-radius:14px;padding:10px;margin-top:8px;font-weight:850;color:inherit}.mobile-menu a.active{background:#fee2e2;color:#b91c1c}.home-structure-card-head a{border-radius:999px;background:#f4f4f5;color:#18181b;padding:8px 12px;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.08em}.home-structure-card-cup .home-structure-card-head a{background:#fff;color:#09090b}.home-structure-cta-card a{display:inline-flex;align-items:center;justify-content:center;background:#ffd018;color:#111;border-radius:999px;padding:12px 17px;font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.08em}@media (max-width:640px) and (orientation:portrait){.hero .home-hero-actions{align-items:flex-start!important;max-width:230px!important}.hero .home-hero-actions a.btn,.hero .home-hero-actions .btn{display:inline-flex!important;flex:0 0 auto!important;width:fit-content!important;min-width:0!important;max-width:max-content!important;align-self:flex-start!important;justify-content:flex-start!important;padding:10px 13px!important;font-size:12px!important;line-height:1.1!important;white-space:nowrap!important}}`;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    function clean(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pagina"; }
    function alias(value) { if (value === "sponsor") return "partner"; if (value === "club") return "club-project"; return value || "home"; }
    function href(routeId) {
      const id = alias(routeId);
      if (paths[id]) return paths[id];
      if (id.startsWith("article-")) return "/news/" + clean(id.slice(8)) + "/";
      if (id.startsWith("player-")) return "/squadra/" + clean(id.slice(7)) + "/";
      if (id.startsWith("staff-detail-")) return "/staff/" + clean(id.slice(13)) + "/";
      if (id.startsWith("gallery-album-")) return "/gallery/" + clean(id.slice(14)) + "/";
      if (id.startsWith("video-detail-")) return "/video/" + clean(id.slice(13)) + "/";
      if (id.startsWith("sponsor-detail-")) return "/partner/" + clean(id.slice(15)) + "/";
      if (id.startsWith("package-detail-")) return "/diventa-partner/" + clean(id.slice(15)) + "/";
      if (id.startsWith("event-detail:")) return "/eventi/" + clean(id.slice(13)) + "/";
      if (id.startsWith("match-")) return "/calendario/" + clean(id.slice(6)) + "/";
      return "/" + clean(id) + "/";
    }
    window.cusRouteHref = href;
    const oldScrollTo = window.scrollTo.bind(window);
    window.scrollTo = function(x, y) {
      const isObj = x && typeof x === "object";
      const top = isObj ? Number(x.top || 0) : Number(y || 0);
      const left = isObj ? Number(x.left || 0) : Number(x || 0);
      if (top === 0 && left === 0) return;
      return oldScrollTo.apply(window, arguments);
    };
    window.cusLinkRoute = function(event, routeId) {
      const id = alias(routeId);
      if (event && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return true;
      if (event) event.preventDefault();
      if (event && event.currentTarget && event.currentTarget.closest("#mobileMenu") && typeof window.cusCloseMobileMenu === "function") window.cusCloseMobileMenu();
      if (typeof window.route === "function") window.route(id); else location.href = href(id);
      return false;
    };
    function routeFrom(raw) {
      const match = String(raw || "").match(/(?:cusMenuRoute|route)\(['\"]([^'\"]+)['\"]\)/);
      return match ? match[1] : "";
    }
    function linkify() {
      document.querySelectorAll("button[onclick]").forEach(button => {
        if (button.dataset.cusRealLink === "1") return;
        const routeId = routeFrom(button.getAttribute("onclick"));
        if (!routeId) return;
        const a = document.createElement("a");
        Array.from(button.attributes || []).forEach(attr => { if (!["onclick", "type"].includes(attr.name)) a.setAttribute(attr.name, attr.value); });
        a.href = href(routeId);
        a.innerHTML = button.innerHTML;
        a.dataset.cusRealLink = "1";
        a.addEventListener("click", event => window.cusLinkRoute(event, routeId));
        button.replaceWith(a);
      });
    }
    linkify();
    const app = document.getElementById("app");
    if (app) new MutationObserver(linkify).observe(app, { childList: true, subtree: true });
    const nav = document.querySelector(".nav");
    if (nav) new MutationObserver(linkify).observe(nav, { childList: true, subtree: true });
    const mobile = document.getElementById("mobileMenu");
    if (mobile) new MutationObserver(linkify).observe(mobile, { childList: true, subtree: true });
    setTimeout(linkify, 80); setTimeout(linkify, 350); setTimeout(linkify, 1000);
  }

  window.submitContact = async function(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("#contactSubmit") || form.querySelector("button[type='submit']");
    status(form, "", "");
    if (button) { button.disabled = true; button.textContent = "Invio in corso..."; }
    try {
      await prepareForm(form);
      const payload = Object.fromEntries(new FormData(form).entries());
      if (!payload["cf-turnstile-response"]) throw new Error("Completa la verifica antispam e riprova.");
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({ success: false, message: "Risposta non valida dal server." }));
      if (!res.ok || !(data.success || data.ok)) throw new Error(data.message || "Invio non riuscito. Riprova più tardi.");
      form.reset();
      resetTurnstile(form);
      status(form, "success", "Messaggio inviato correttamente. Ti risponderemo appena possibile.");
    } catch (e) {
      resetTurnstile(form);
      status(form, "error", e.message || "Invio non riuscito. Riprova più tardi.");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Invia richiesta"; }
    }
  };

  installUploadedImageRetry();
  installPartnerOverride();
  refreshPartnerIfVisible();
  installRealRouteLinks();
  document.addEventListener("DOMContentLoaded", () => { prepareAll(); installPartnerOverride(); refreshPartnerIfVisible(); installRealRouteLinks(); });
  const app = document.getElementById("app");
  if (app) new MutationObserver(prepareAll).observe(app, { childList: true, subtree: true });
})();
