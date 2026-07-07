(function(){
  const PATCH_VERSION = "teams-overview-v1";

  function h(value){
    return String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }

  function localState(){
    try{return window.state || state || {};}catch(e){return window.state || {};}
  }

  function teamPlayers(teamKey){
    const s = localState();
    const roster = Array.isArray(s.roster) ? s.roster : [];
    const key = String(teamKey || "").toLowerCase();
    return roster.filter(player => String(player && player.team || "").toLowerCase().includes(key));
  }

  function ageFromPlayer(player){
    const raw = player && (player.birthDate || player.birth_date || player.dateOfBirth || player.dob || player.nascita);
    if(raw){
      const born = new Date(raw);
      if(!Number.isNaN(born.getTime())){
        const now = new Date();
        const years = (now - born) / (365.2425 * 24 * 60 * 60 * 1000);
        if(Number.isFinite(years) && years > 0 && years < 90) return years;
      }
    }
    const fallbackAge = Number(player && player.age);
    return Number.isFinite(fallbackAge) && fallbackAge > 0 && fallbackAge < 90 ? fallbackAge : null;
  }

  function averageAge(teamKey){
    const ages = teamPlayers(teamKey).map(ageFromPlayer).filter(value => value != null);
    if(!ages.length) return "—";
    const avg = ages.reduce((sum,value) => sum + value, 0) / ages.length;
    return avg.toLocaleString("it-IT", {minimumFractionDigits:1, maximumFractionDigits:1});
  }

  function setMetric(card, index, value, label){
    const metrics = card.querySelectorAll(".cus-rework-metric");
    const metric = metrics[index];
    if(!metric) return;
    const b = metric.querySelector("b");
    const span = metric.querySelector("span");
    if(b) b.textContent = value;
    if(span) span.textContent = label;
  }

  function patchTeamsOverview(){
    const path = location.pathname.replace(/\/+$/,"/");
    const isTeamsPath = path === "/squadre/" || window.__cusActiveRoute === "teams-overview";
    if(!isTeamsPath) return;

    const app = document.getElementById("app");
    if(!app) return;

    const cards = Array.from(app.querySelectorAll(".cus-rework-grid.two > .cus-rework-card"));
    if(cards.length < 2) return;

    cards.slice(0,2).forEach(card => {
      card.querySelectorAll("span.badge").forEach(badge => badge.remove());
    });

    const firstCard = cards[0];
    const secondCard = cards[1];

    setMetric(firstCard, 1, averageAge("prima"), "Età media");
    setMetric(firstCard, 2, "SERIE C1", "campionato");

    setMetric(secondCard, 1, averageAge("under"), "Età media");
    setMetric(secondCard, 2, "SERIE D", "campionato");
  }

  function patchSoon(){
    patchTeamsOverview();
    setTimeout(patchTeamsOverview, 0);
    setTimeout(patchTeamsOverview, 80);
    setTimeout(patchTeamsOverview, 350);
  }

  function wrapRoute(fnName){
    const original = window[fnName];
    if(typeof original !== "function" || original.__teamsOverviewPatched) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      patchSoon();
      return result;
    };
    wrapped.__teamsOverviewPatched = true;
    window[fnName] = wrapped;
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", patchSoon);
  }else{
    patchSoon();
  }

  wrapRoute("route");
  wrapRoute("cusMenuRoute");

  const app = document.getElementById("app");
  if(app && "MutationObserver" in window){
    new MutationObserver(patchTeamsOverview).observe(app, {childList:true, subtree:true});
  }

  window.__cusTeamsOverviewPatchVersion = PATCH_VERSION;
})();
