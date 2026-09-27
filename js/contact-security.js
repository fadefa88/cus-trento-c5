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

  function esc(value){
    return String(value ?? "").replace(/[&<>\"']/g,ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }

  function clean(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "pagina";
  }

  function normalize(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  }

  function slugFor(item){
    if(typeof window.objectSlug === "function") return window.objectSlug(item,"sponsors");
    return clean(item && (item.slug || item.name || item.title || item.id) || "partner");
  }

  function sponsorLogo(item){
    if(typeof window.sponsorLogoHtml === "function") return window.sponsorLogoHtml(item);
    const logo = String(item && item.logo || "").trim();
    const name = String(item && item.name || "Partner").trim();
    if(logo && (/^https?:\/\//i.test(logo) || logo.startsWith("/") || /\.(png|jpe?g|webp|svg|gif)(\?.*)?$/i.test(logo))) return `<img loading="lazy" src="${esc(logo)}" alt="Logo ${esc(name)}">`;
    const fallback = logo || name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join("") || "SP";
    return `<span>${esc(fallback)}</span>`;
  }

  function installPartnerOverride(){
    let cachedSponsors = null;
    let loadingSponsors = null;
    const fromState = () => {
      try{return Array.isArray(state && state.sponsors) ? state.sponsors : [];}catch(e){return [];}
    };
    function renderPartnerPage(sponsors){
      const items = Array.isArray(sponsors) ? sponsors : [];
      const cards = items.map(s => `<article class="card card-pad sponsor-card"><div class="sponsor-logo">${sponsorLogo(s)}</div><h2 style="margin-top:8px">${esc(s.name || "Sponsor")}</h2><button class="btn soft" onclick="route('sponsor-detail-${esc(slugFor(s))}')" style="margin-top:10px">Scopri →</button></article>`).join("") || `<article class="card card-pad"><p class="muted">Nessun partner inserito.</p></article>`;
      if(typeof window.shell === "function") window.shell("Partner","Sponsor, partner e community del progetto",`<div class="grid grid-4 sponsor-grid-four">${cards}</div><div class="newsletter" style="margin-top:24px"><h2 style="font-size:38px">Vuoi diventare Partner CUS Trento C5?</h2><button class="btn ghost" onclick="route('become-partner')">Scopri come</button></div>`,"","Sponsor e partner CUS Trento C5.");
    }
    function loadSponsors(){
      if(cachedSponsors) return Promise.resolve(cachedSponsors);
      if(loadingSponsors) return loadingSponsors;
      loadingSponsors = fetch("/content/cms/sponsors.json",{cache:"no-store"})
        .then(r => r.ok ? r.json() : Promise.reject(new Error("sponsors.json non disponibile")))
        .then(data => cachedSponsors = Array.isArray(data && data.sponsors) ? data.sponsors : [])
        .catch(() => cachedSponsors = []);
      return loadingSponsors;
    }
    window.sponsor = function(){
      const current = fromState();
      if(current.length){cachedSponsors = current; renderPartnerPage(current); return;}
      if(cachedSponsors && cachedSponsors.length){renderPartnerPage(cachedSponsors); return;}
      if(typeof window.shell === "function") window.shell("Partner","Sponsor, partner e community del progetto",`<article class="card card-pad"><p class="muted">Caricamento partner...</p></article>`,"","Sponsor e partner CUS Trento C5.");
      loadSponsors().then(renderPartnerPage);
    };
  }

  function refreshPartnerIfVisible(){
    const path = location.pathname.replace(/\/+$/,"/");
    if(path === "/partner/" || window.__cusActiveRoute === "partner") setTimeout(() => {if(typeof window.route === "function") window.route("partner");},60);
  }

  function installUploadedImageRetry(){
    document.addEventListener("error",event => {
      const img = event && event.target;
      if(!img || !img.tagName || img.tagName.toLowerCase() !== "img") return;
      const src = img.currentSrc || img.getAttribute("src") || "";
      let local = false;
      try{const u = new URL(src,location.origin); local = u.origin === location.origin && u.pathname.startsWith("/img/uploads/") && !u.pathname.endsWith("/img/placeholder.webp");}
      catch(e){local = String(src).startsWith("/img/uploads/");}
      if(!local || img.dataset.uploadRetry === "1") return;
      if(event.stopImmediatePropagation) event.stopImmediatePropagation();
      if(event.preventDefault) event.preventDefault();
      img.dataset.uploadRetry = "1";
      img.src = src + (src.includes("?") ? "&" : "?") + "v=" + Date.now();
    },true);
  }

  function installRealRouteLinks(){
    const paths = {home:"/","teams-overview":"/squadre/",squad:"/squadra/",staff:"/staff/",stats:"/statistiche/","play-with-us":"/gioca-con-noi/",fixtures:"/calendario/",standings:"/classifica/",coppa:"/coppa/",cnu:"/cnu/","season-archive":"/archivio-stagioni/",events:"/eventi/","events:upcoming":"/eventi/#prossimi-eventi","events:tournaments":"/eventi/#tornei","events:selections":"/eventi/#selezioni","events:archive":"/eventi/#archivio-eventi",partner:"/partner/",sponsor:"/partner/","become-partner":"/diventa-partner/",news:"/news/",gallery:"/gallery/",video:"/video/",social:"/social/","club-project":"/club/",club:"/club/",venue:"/impianto/",records:"/hall-of-fame/",contacts:"/contatti/",privacy:"/privacy/",cookies:"/cookies/"};
    function alias(value){if(value === "sponsor") return "partner"; if(value === "club") return "club-project"; return value || "home";}
    function href(routeId){
      const id = alias(routeId);
      if(paths[id]) return paths[id];
      if(id.startsWith("article-")) return "/news/"+clean(id.slice(8))+"/";
      if(id.startsWith("player-")) return "/squadra/"+clean(id.slice(7))+"/";
      if(id.startsWith("staff-detail-")) return "/staff/"+clean(id.slice(13))+"/";
      if(id.startsWith("gallery-album-")) return "/gallery/"+clean(id.slice(14))+"/";
      if(id.startsWith("video-detail-")) return "/video/"+clean(id.slice(13))+"/";
      if(id.startsWith("sponsor-detail-")) return "/partner/"+clean(id.slice(15))+"/";
      if(id.startsWith("package-detail-")) return "/diventa-partner/"+clean(id.slice(15))+"/";
      if(id.startsWith("event-detail:")) return "/eventi/"+clean(id.slice(13))+"/";
      if(id.startsWith("match-")) return "/calendario/"+clean(id.slice(6))+"/";
      return "/"+clean(id)+"/";
    }
    window.cusRouteHref = href;
    function routeFrom(raw){const m = String(raw || "").match(/(?:cusMenuRoute|route)\(['\"]([^'\"]+)['\"]\)/); return m ? m[1] : "";}
    function linkify(root){
      (root || document).querySelectorAll("button[onclick]").forEach(button => {
        if(button.dataset.cusRealLink === "1") return;
        const routeId = routeFrom(button.getAttribute("onclick"));
        if(!routeId) return;
        const a = document.createElement("a");
        Array.from(button.attributes || []).forEach(attr => {if(!["onclick","type"].includes(attr.name)) a.setAttribute(attr.name,attr.value);});
        a.href = href(routeId);
        a.innerHTML = button.innerHTML;
        a.dataset.cusRealLink = "1";
        a.addEventListener("click",event => {
          if(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if(a.closest("#mobileMenu") && typeof window.cusCloseMobileMenu === "function") window.cusCloseMobileMenu();
          if(typeof window.route === "function") window.route(alias(routeId)); else location.href = href(routeId);
        });
        button.replaceWith(a);
      });
    }
    linkify(document);
    [document.getElementById("app"),document.querySelector(".nav"),document.getElementById("mobileMenu")].filter(Boolean).forEach(node => new MutationObserver(() => linkify(node)).observe(node,{childList:true,subtree:true}));
    setTimeout(() => linkify(document),100);
    setTimeout(() => linkify(document),500);
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

  function getState(){try{return state || {};}catch(e){return {};}}
  function isCusTeamName(name){return normalize(name).includes("cus trento");}

  function applyMatchBranding(){
    const hero = document.querySelector(".match-center-v57-hero");
    if(!hero) return;
    const competition = hero.querySelector(".match-center-v57-competition");
    const mark = hero.querySelector(".match-center-v57-compmark");
    const img = mark && mark.querySelector("img");
    if(!competition || !mark || !img) return;
    const raw = String(competition.textContent || "").trim();
    const isSerieD = mark.classList.contains("is-youth") || /under\s*23|serie\s*d/i.test(raw);
    const isCup = /coppa/i.test(raw);
    const label = isSerieD ? (isCup ? "Coppa Serie D" : "Serie D") : (isCup ? "Coppa Serie B" : "Serie B - Girone B");
    const logo = isSerieD ? "https://calcioa5.custrento.it/img/uploads/firefly.png" : "https://calcioa5.custrento.it/img/uploads/firefly_removebackground.png";
    competition.textContent = label;
    if(img.getAttribute("src") !== logo) img.setAttribute("src",logo);
    img.setAttribute("alt",isSerieD ? "Serie D Calcio a 5" : "Serie B Calcio a 5");
    mark.setAttribute("aria-label",isSerieD ? "Serie D Calcio a 5" : "Serie B Calcio a 5");
    img.style.setProperty("clip-path","none","important");
    img.style.setProperty("transform","none","important");
    img.style.setProperty("object-fit","contain","important");
    img.style.setProperty("background","transparent","important");
  }

  function currentMatchFromHero(){
    const hero = document.querySelector(".match-center-v57-hero");
    if(!hero) return null;
    const s = getState();
    const all = [...(s.fixtures || []),...(s.u21Fixtures || [])];
    const parts = location.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "";
    if(slug && typeof findObjectBySlug === "function"){
      try{const bySlug = findObjectBySlug(all,"fixtures",slug); if(bySlug) return bySlug;}catch(e){}
    }
    const names = Array.from(hero.querySelectorAll(".match-center-v57-teamname")).map(node => normalize(node.textContent));
    const venue = normalize(hero.querySelector(".match-center-v57-venue")?.textContent || "");
    return all.find(match => normalize(match && match.home) === names[0] && normalize(match && match.away) === names[1] && (!venue || normalize(match && match.venue) === venue)) || all.find(match => normalize(match && match.home) === names[0] && normalize(match && match.away) === names[1]) || null;
  }

  function playerFromRef(ref,roster){
    let resolved = ref;
    if(typeof resolvePlayerId === "function"){
      try{resolved = resolvePlayerId(ref,roster);}catch(e){}
    }
    return roster.find(player => String(player && player.id) === String(resolved)) || roster.find(player => normalize(player && player.name) === normalize(ref)) || null;
  }

  function eventPlayer(event,roster){
    const raw = event && (event.playerId ?? event.player ?? event.name ?? event.id);
    return playerFromRef(raw,roster);
  }

  function yellowForPlayer(match,player,roster){
    const events = Array.isArray(match && match.yellowCardEvents) ? match.yellowCardEvents : [];
    return events.some(event => {
      const p = eventPlayer(event,roster);
      return p && String(p.id) === String(player.id);
    });
  }

  function goalsForPlayer(match,player,roster){
    const events = Array.isArray(match && match.scorerEvents) ? match.scorerEvents : [];
    return events.reduce((sum,event) => {
      const raw = event && (event.playerId ?? event.player ?? event.name ?? event.id);
      if(typeof isOwnGoalScorer === "function"){
        try{if(isOwnGoalScorer(raw)) return sum;}catch(e){}
      }
      const p = eventPlayer(event,roster);
      if(!p || String(p.id) !== String(player.id)) return sum;
      const times = Array.isArray(event.goalTimes) ? event.goalTimes.filter(Boolean).length : 0;
      const count = Math.max(1,Number(event.goals || event.value || 1) || 1,times || 0);
      return sum + count;
    },0);
  }

  function personNameParts(full){
    const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
    if(parts.length <= 1) return {first:"",last:parts[0] || ""};
    const firstRaw = parts.shift();
    const first = firstRaw.charAt(0).toUpperCase() + firstRaw.slice(1).toLowerCase();
    return {first,last:parts.join(" ").toUpperCase()};
  }

  function convocatiCss(){
    if(document.getElementById("match-squad-v61-style")) return;
    const style = document.createElement("style");
    style.id = "match-squad-v61-style";
    style.textContent = `
      .match-squad-v61{margin-top:22px!important;padding:28px 26px 32px!important;background:#fff!important;color:#09090b!important;overflow:hidden;}
      .match-squad-v61 h2{margin:0 0 26px;font-size:34px;line-height:1;font-weight:1000;letter-spacing:-.05em;color:#09090b;}
      .match-squad-v61-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:34px;row-gap:26px;}
      .match-squad-v61-player{display:grid;grid-template-columns:54px minmax(0,1fr);align-items:center;gap:12px;min-width:0;}
      .match-squad-v61-number{font-size:46px;line-height:.9;font-weight:1000;letter-spacing:-.06em;color:#09090b;text-align:left;font-family:Impact,"Arial Narrow",Arial,sans-serif;}
      .match-squad-v61-copy{min-width:0;}
      .match-squad-v61-first{font-size:13px;line-height:1.05;font-weight:500;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .match-squad-v61-last{margin-top:2px;font-size:23px;line-height:.98;font-weight:1000;letter-spacing:-.025em;text-transform:uppercase;color:#09090b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Impact,"Arial Narrow",Arial,sans-serif;}
      .match-squad-v61-events{display:flex;align-items:center;gap:8px;min-height:18px;margin-top:7px;}
      .match-squad-v61-yellow{display:inline-block;width:11px;height:17px;border-radius:2px;background:#f4d94d;box-shadow:inset 0 0 0 1px rgba(0,0,0,.04);}
      .match-squad-v61-goal{display:inline-flex;align-items:center;gap:3px;font-size:14px;line-height:1;color:#b91c1c;font-weight:1000;}
      .match-squad-v61-goal i{font-size:13px;}
      .match-squad-v61-empty{grid-column:1/-1;margin:0;color:#71717a;font-weight:700;}
      @media(max-width:520px){
        .match-squad-v61{padding:24px 16px 28px!important;}
        .match-squad-v61 h2{font-size:30px;margin-bottom:24px;}
        .match-squad-v61-grid{column-gap:14px;row-gap:23px;}
        .match-squad-v61-player{grid-template-columns:42px minmax(0,1fr);gap:9px;}
        .match-squad-v61-number{font-size:37px;}
        .match-squad-v61-first{font-size:11px;}
        .match-squad-v61-last{font-size:18px;}
      }
    `;
    document.head.appendChild(style);
  }

  function renderConvocati(){
    const hero = document.querySelector(".match-center-v57-hero");
    if(!hero) return;
    const match = currentMatchFromHero();
    if(!match) return;

    applyMatchBranding();

    document.querySelectorAll(".match-center-v57-details").forEach(node => node.remove());
    document.querySelectorAll(".lineup-board").forEach(node => {
      const parent = node.parentElement;
      if(parent && parent.classList.contains("grid")) parent.remove();
      else node.remove();
    });
    document.querySelectorAll(".match-squad-v61").forEach(node => node.remove());

    const s = getState();
    const roster = Array.isArray(s.roster) ? s.roster : [];
    const lineup = match.lineup || {};
    const refs = [...(Array.isArray(lineup.startingFive) ? lineup.startingFive : []),...(Array.isArray(lineup.bench) ? lineup.bench : [])]
      .filter((value,index,arr) => arr.findIndex(item => String(item) === String(value)) === index);
    const players = refs.map(ref => playerFromRef(ref,roster)).filter(Boolean);

    const card = document.createElement("section");
    card.className = "card card-pad match-squad-v61";
    card.innerHTML = `<h2>Convocati</h2><div class="match-squad-v61-grid">${players.length ? players.map(player => {
      const names = personNameParts(player.name);
      const yellow = yellowForPlayer(match,player,roster);
      const goals = goalsForPlayer(match,player,roster);
      const events = `${yellow ? '<span class="match-squad-v61-yellow" aria-label="Ammonito"></span>' : ''}${goals ? `<span class="match-squad-v61-goal" aria-label="${goals} gol"><i class="fa-solid fa-futbol" aria-hidden="true"></i>${goals > 1 ? `<b>×${goals}</b>` : ''}</span>` : ''}`;
      return `<div class="match-squad-v61-player"><div class="match-squad-v61-number">${esc(player.number ?? "–")}</div><div class="match-squad-v61-copy"><div class="match-squad-v61-first">${esc(names.first)}</div><div class="match-squad-v61-last">${esc(names.last)}</div><div class="match-squad-v61-events">${events}</div></div></div>`;
    }).join("") : '<p class="match-squad-v61-empty">Convocati non inseriti.</p>'}</div>`;

    hero.insertAdjacentElement("afterend",card);
    hero.dataset.matchSquadV61 = "1";
  }

  function renderU23OpponentScorers(){
    const hero = document.querySelector(".match-center-v57-hero");
    if(!hero) return;
    const competition = hero.querySelector(".match-center-v57-competition");
    if(!competition || !/serie\s*d/i.test(String(competition.textContent || ""))) return;
    const match = currentMatchFromHero();
    if(!match || normalize(match.status) !== "terminata") return;
    const teams = Array.from(hero.querySelectorAll(".match-center-v57-team"));
    if(teams.length < 2) return;
    const opponentIndex = isCusTeamName(match.home) ? 1 : 0;
    const target = teams[opponentIndex]?.querySelector(".match-center-v57-scorers");
    if(!target) return;
    const events = Array.isArray(match.opponentScorerEvents) ? match.opponentScorerEvents : [];
    target.innerHTML = events.map(event => {
      const name = String(event && event.name || "").trim();
      if(!name) return "";
      const goals = Math.max(1,Number(event && event.goals || 1) || 1);
      return `<div class="match-center-v57-scorer">${esc(name)}${goals > 1 ? `<small>×${goals}</small>` : ""}</div>`;
    }).join("");
  }

  let scheduled = false;
  function enhanceMatch(){
    const hero = document.querySelector(".match-center-v57-hero");
    if(!hero) return;
    if(hero.dataset.matchSquadV61 === "1" && document.querySelector(".match-squad-v61")){
      applyMatchBranding();
      renderU23OpponentScorers();
      return;
    }
    renderConvocati();
    renderU23OpponentScorers();
  }
  function scheduleEnhance(){
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {scheduled = false; enhanceMatch();});
  }

  installUploadedImageRetry();
  installPartnerOverride();
  refreshPartnerIfVisible();
  installRealRouteLinks();
  convocatiCss();
  prepareAll();
  scheduleEnhance();

  document.addEventListener("DOMContentLoaded",() => {prepareAll(); installPartnerOverride(); refreshPartnerIfVisible(); scheduleEnhance();});
  const app = document.getElementById("app");
  if(app) new MutationObserver(() => {prepareAll(); scheduleEnhance();}).observe(app,{childList:true,subtree:true});
  setTimeout(scheduleEnhance,120);
  setTimeout(scheduleEnhance,500);
  setTimeout(scheduleEnhance,1200);
})();
