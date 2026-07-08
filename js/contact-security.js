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
    window.sponsor = function() {
      const sponsors = Array.isArray(window.state && window.state.sponsors) ? window.state.sponsors : [];
      const sponsorCards = sponsors.map(s => `<article class="card card-pad sponsor-card"><div class="sponsor-logo">${sponsorLogo(s)}</div><h2 style="margin-top:8px">${escapeHtml(s.name || "Sponsor")}</h2><button class="btn soft" onclick="route('sponsor-detail-${escapeHtml(slugFor(s, 'sponsors'))}')" style="margin-top:10px">Scopri →</button></article>`).join("") || `<article class="card card-pad"><p class="muted">Nessun partner inserito.</p></article>`;
      if (typeof window.shell === "function") {
        window.shell("Partner", "Sponsor, partner e community del progetto", `<div class="grid grid-4 sponsor-grid-four">${sponsorCards}</div><div class="newsletter" style="margin-top:24px"><h2 style="font-size:38px">Vuoi diventare Partner CUS Trento C5?</h2><button class="btn ghost" onclick="route('become-partner')">Scopri come</button></div>`, "", "Sponsor e partner CUS Trento C5.");
      }
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

  installPartnerOverride();
  refreshPartnerIfVisible();
  document.addEventListener("DOMContentLoaded", () => { prepareAll(); installPartnerOverride(); refreshPartnerIfVisible(); });
  const app = document.getElementById("app");
  if (app) new MutationObserver(prepareAll).observe(app, { childList: true, subtree: true });
})();
