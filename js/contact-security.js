// Contact forms: Cloudflare Turnstile + submission to the /api/contact Pages Function
// (functions/api/contact.js), which holds the Turnstile and Web3Forms secrets.
(() => {
  const SITE_KEY = "0x4AAAAAADq4Kdp7DkhOnEgN";
  const ENDPOINT = "/api/contact";
  let loader = null;

  function loadTurnstile(){
    if(window.turnstile) return Promise.resolve(window.turnstile);
    if(loader) return loader;
    loader = new Promise((resolve,reject) => {
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

  async function prepareForm(form){
    if(!form || form.dataset.cfReady === "1") return;
    form.action = ENDPOINT;
    form.method = "post";
    let box = form.querySelector(".cf-turnstile-box");
    if(!box){
      box = document.createElement("div");
      box.className = "cf-turnstile-box";
      box.style.marginTop = "14px";
      const status = form.querySelector("#contactStatus") || form.querySelector(".form-alert");
      form.insertBefore(box,status || form.querySelector("button[type='submit']"));
    }
    const t = await loadTurnstile();
    if(box.dataset.widgetId) return;
    box.dataset.widgetId = t.render(box,{sitekey:SITE_KEY,theme:"auto"});
    form.dataset.cfReady = "1";
  }

  function prepareAll(){
    document.querySelectorAll("form.contact-form").forEach(form => prepareForm(form).catch(() => {}));
  }

  function setStatus(form,cls,text){
    const el = form.querySelector("#contactStatus") || form.querySelector(".form-alert");
    if(!el) return;
    el.className = "form-alert" + (cls ? " " + cls : "");
    el.textContent = text || "";
  }

  function resetTurnstile(form){
    const box = form.querySelector(".cf-turnstile-box");
    if(window.turnstile && box && box.dataset.widgetId){
      try{window.turnstile.reset(box.dataset.widgetId);}catch(e){}
    }
  }

  window.submitContact = async function(event){
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("#contactSubmit") || form.querySelector("button[type='submit']");
    setStatus(form,"","");
    if(button){button.disabled = true; button.textContent = "Invio in corso...";}
    try{
      await prepareForm(form);
      const payload = Object.fromEntries(new FormData(form).entries());
      if(!payload["cf-turnstile-response"]) throw new Error("Completa la verifica antispam e riprova.");
      const res = await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)});
      const data = await res.json().catch(() => ({success:false,message:"Risposta non valida dal server."}));
      if(!res.ok || !(data.success || data.ok)) throw new Error(data.message || "Invio non riuscito. Riprova più tardi.");
      form.reset();
      resetTurnstile(form);
      setStatus(form,"success","Messaggio inviato correttamente. Ti risponderemo appena possibile.");
    }catch(e){
      resetTurnstile(form);
      setStatus(form,"error",e.message || "Invio non riuscito. Riprova più tardi.");
    }finally{
      if(button){button.disabled = false; button.textContent = "Invia richiesta";}
    }
  };

  // Forms are rendered by the SPA at any time: prepare Turnstile whenever #app changes.
  prepareAll();
  const app = document.getElementById("app");
  if(app) new MutationObserver(prepareAll).observe(app,{childList:true,subtree:true});
})();

// Roster compatibility: "De Nardis Andrea" means surname "De Nardis", given name "Andrea".
(() => {
  function partsOf(player){
    return String(player && player.name || "").trim().split(/\s+/).filter(Boolean);
  }
  function isDeNardis(parts){
    return parts.length >= 3 && parts[0].toLowerCase() === "de" && parts[1].toLowerCase() === "nardis";
  }
  function escapeHtml(value){
    return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char]));
  }

  const originalRosterCardNameHtml = window.rosterCardNameHtml;
  if(typeof originalRosterCardNameHtml === "function"){
    window.rosterCardNameHtml = function(player){
      const parts = partsOf(player);
      if(!isDeNardis(parts)) return originalRosterCardNameHtml(player);
      const surname = parts.slice(0,2).join(" ");
      const given = parts.slice(2).join(" ");
      return `<span class="player-card-surname">${escapeHtml(surname)}</span>${given ? ` <span class="player-card-given">${escapeHtml(given)}</span>` : ""}`;
    };
  }

  const originalPlayerSurname = window.playerSurname;
  if(typeof originalPlayerSurname === "function"){
    window.playerSurname = function(player){
      const parts = partsOf(player);
      return isDeNardis(parts) ? parts.slice(0,2).join(" ") : originalPlayerSurname(player);
    };
  }
})();
