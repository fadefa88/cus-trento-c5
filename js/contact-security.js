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

  document.addEventListener("DOMContentLoaded", prepareAll);
  const app = document.getElementById("app");
  if (app) new MutationObserver(prepareAll).observe(app, { childList: true, subtree: true });
})();
