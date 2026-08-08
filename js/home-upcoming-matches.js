(function(){
  const demoFixtures = {
    prima: [
      {home:"Futsal Rovereto", away:"CUS Trento C5", date:"2026-09-19", time:"20:45", venue:"Palasport Rovereto", competition:"Serie C1"},
      {home:"CUS Trento C5", away:"Bolzano Futsal", date:"2026-09-26", time:"21:00", venue:"Sanbàpolis", competition:"Serie C1"},
      {home:"Olympia Rovereto", away:"CUS Trento C5", date:"2026-10-03", time:"20:30", venue:"Palestra Olympia", competition:"Serie C1"},
      {home:"CUS Trento C5", away:"Virtus Trento", date:"2026-10-10", time:"21:00", venue:"Sanbàpolis", competition:"Serie C1"},
      {home:"Bassa Atesina", away:"CUS Trento C5", date:"2026-10-17", time:"20:45", venue:"Palazzetto Egna", competition:"Serie C1"},
      {home:"CUS Trento C5", away:"Mezzolombardo C5", date:"2026-10-24", time:"21:00", venue:"Sanbàpolis", competition:"Serie C1"},
      {home:"Imperial Grumo", away:"CUS Trento C5", date:"2026-10-31", time:"20:30", venue:"Palestra Grumo", competition:"Serie C1"},
      {home:"CUS Trento C5", away:"Fiavé 1945", date:"2026-11-07", time:"21:00", venue:"Sanbàpolis", competition:"Serie C1"}
    ],
    u21: [
      {home:"CUS Trento U21", away:"Futsal Atesina U21", date:"2026-09-20", time:"18:00", venue:"Sanbàpolis", competition:"Under 21"},
      {home:"Trento Giovani", away:"CUS Trento U21", date:"2026-09-27", time:"17:30", venue:"Palestra Comunale", competition:"Under 21"},
      {home:"CUS Trento U21", away:"Rovereto U21", date:"2026-10-04", time:"18:00", venue:"Sanbàpolis", competition:"Under 21"},
      {home:"Bolzano U21", away:"CUS Trento U21", date:"2026-10-11", time:"16:00", venue:"Palasport Bolzano", competition:"Under 21"},
      {home:"CUS Trento U21", away:"Mezzolombardo U21", date:"2026-10-18", time:"18:00", venue:"Sanbàpolis", competition:"Under 21"},
      {home:"Bassa Atesina U21", away:"CUS Trento U21", date:"2026-10-25", time:"17:00", venue:"Palazzetto Egna", competition:"Under 21"},
      {home:"CUS Trento U21", away:"Olympia U21", date:"2026-11-01", time:"18:00", venue:"Sanbàpolis", competition:"Under 21"},
      {home:"Virtus Trento U21", away:"CUS Trento U21", date:"2026-11-08", time:"17:30", venue:"Palestra Virtus", competition:"Under 21"}
    ]
  };

  function h(value){
    return String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }

  function norm(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function isCus(value){
    const key = norm(value).replace(/[^a-z0-9]/g, "");
    return key.includes("custrento");
  }

  function js(value){
    return String(value ?? "").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\n/g," ");
  }

  function teamLabel(key){
    return key === "u21" ? "Under 21" : "Prima squadra";
  }

  function allRawFixtures(){
    const s = typeof state !== "undefined" ? state : {};
    return [
      ...(s.fixtures || []).map(match => ({match, key:"prima"})),
      ...(s.u21Fixtures || []).map(match => ({match, key:"u21"}))
    ];
  }

  function allDemoFixtures(){
    return [
      ...demoFixtures.prima.map(match => ({match, key:"prima"})),
      ...demoFixtures.u21.map(match => ({match, key:"u21"}))
    ];
  }

  function fixtureTimestamp(match){
    if(!match || !match.date) return 0;
    const rawTime = String(match.time || "00:00");
    const safeTime = /^\d{1,2}:\d{2}/.test(rawTime) ? rawTime.slice(0,5) : "00:00";
    const full = Date.parse(`${match.date}T${safeTime}:00`);
    if(!Number.isNaN(full)) return full;
    const dateOnly = Date.parse(match.date);
    return Number.isNaN(dateOnly) ? 0 : dateOnly;
  }

  function isFinished(match){
    const status = norm(match && match.status);
    return !!(match && match.score) || status.includes("terminata") || status.includes("finale") || status.includes("giocata");
  }

  function normalizeFixture(match, key, demo){
    const home = match.home || (key === "u21" ? "CUS Trento U21" : "CUS Trento C5");
    const away = match.away || "Avversario";
    return {
      id: match.id,
      key,
      home,
      away,
      date: match.date || "",
      time: match.time || "TBC",
      venue: match.venue || "Campo da definire",
      competition: match.competition || match.round || (key === "u21" ? "Under 21" : "Serie C1"),
      opponentLogo: match.opponentLogo || "",
      mode: isCus(home) ? "Casa" : "Trasferta",
      demo: !!demo
    };
  }

  function fixtureDayTimestamp(match){
    if(!match || !match.date) return Number.MAX_SAFE_INTEGER;
    const day = Date.parse(String(match.date).slice(0, 10));
    return Number.isNaN(day) ? Number.MAX_SAFE_INTEGER : day;
  }

  function todayStartTimestamp(){
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  }

  function upcomingFixtures(){
    const todayStart = todayStartTimestamp();
    const byDate = (a,b) => {
      const ta = fixtureTimestamp(a) || Number.MAX_SAFE_INTEGER;
      const tb = fixtureTimestamp(b) || Number.MAX_SAFE_INTEGER;
      return ta - tb;
    };

    const cms = allRawFixtures()
      .filter(item => item.match && !isFinished(item.match))
      .map(item => normalizeFixture(item.match, item.key, false))
      .filter(match => fixtureDayTimestamp(match) >= todayStart)
      .sort(byDate);

    return {fixtures: cms, usingDemo: false};
  }

  function teamMark(name, match){
    if(isCus(name)) return `<img src="/img/logo.webp" alt="CUS Trento C5">`;
    const opponentLogo = match && match.opponentLogo ? String(match.opponentLogo) : "";
    if(opponentLogo) return `<img src="${h(opponentLogo)}" alt="${h(name || "Avversaria")}">`;
    const parts = String(name || "AV")
      .replace(/c5|u21/ig, "")
      .split(/\s+/)
      .filter(Boolean);
    const text = parts.length > 1 ? parts.slice(0,2).map(part => part[0]).join("") : (parts[0] || "AV").slice(0,3);
    return `<span>${h(text.toUpperCase())}</span>`;
  }

  function fixtureDate(value){
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return "TBD";
    return new Intl.DateTimeFormat("it-IT", {day:"numeric", month:"short"}).format(date).replace(".", "") + ".";
  }

  function card(match){
    const modeClass = norm(match.mode).includes("casa") ? "home" : "away";
    const click = match.id != null ? `route('match-${js(match.id)}')` : `route('fixtures')`;
    return `<article class="home-upcoming-card" onclick="${click}" tabindex="0" role="button" aria-label="${h(match.home)} contro ${h(match.away)}">
      <div class="home-upcoming-meta">
        <span class="home-upcoming-mode ${modeClass}">${h(match.mode)}</span>
        <b>${h(fixtureDate(match.date))}</b>
        <span>${h(match.venue)}</span>
        <em>${h(match.competition)}</em>
      </div>
      <div class="home-upcoming-body">
        <div class="home-upcoming-teams">
          <div class="home-upcoming-team"><i>${teamMark(match.home, match)}</i><strong>${h(match.home)}</strong></div>
          <div class="home-upcoming-team"><i>${teamMark(match.away, match)}</i><strong>${h(match.away)}</strong></div>
        </div>
        <div class="home-upcoming-time">${h(match.time || "TBC")}</div>
      </div>
      <div class="home-upcoming-foot"></div>
    </article>`;
  }

  function section(){
    const data = upcomingFixtures();
    if(!data.fixtures.length) return "";
    return `<section class="home-upcoming-section" aria-label="Prossime partite">
      <div class="container">
        <div class="home-upcoming-head">
          <div class="home-upcoming-title"><h2>Prossime partite</h2></div>
        </div>
        <div class="home-upcoming-shell">
          <button class="home-upcoming-side home-upcoming-side-left" data-home-upcoming-dir="left" type="button" onclick="homeUpcomingScroll(-1)" aria-label="Partite precedenti">‹</button>
          <div class="home-upcoming-track" id="homeUpcomingTrack">${data.fixtures.length ? data.fixtures.map(card).join("") : `<div class="home-upcoming-empty">Nessuna prossima partita presente nel calendario.</div>`}</div>
          <button class="home-upcoming-side home-upcoming-side-right" data-home-upcoming-dir="right" type="button" onclick="homeUpcomingScroll(1)" aria-label="Partite successive">›</button>
        </div>
      </div>
    </section>`;
  }


  function insertUpcomingMatches(){
    const homeRoot = document.querySelector(".home-structure");
    const hero = homeRoot && homeRoot.querySelector(".hero");
    const existing = homeRoot && homeRoot.querySelector(".home-upcoming-section");
    if(existing) existing.remove();
    if(!homeRoot || !hero) return;
    const html = section();
    if(!html) return;
    hero.insertAdjacentHTML("afterend", html);
    bindUpcomingTrack();
    setTimeout(updateUpcomingArrows, 0);
  }

  function upcomingTrack(){
    return document.getElementById("homeUpcomingTrack");
  }

  function updateUpcomingArrows(){
    const track = upcomingTrack();
    const leftButtons = document.querySelectorAll('[data-home-upcoming-dir="left"]');
    const rightButtons = document.querySelectorAll('[data-home-upcoming-dir="right"]');
    if(!track){
      leftButtons.forEach(button => button.classList.add("is-hidden"));
      rightButtons.forEach(button => button.classList.add("is-hidden"));
      return;
    }
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const atStart = track.scrollLeft <= 2;
    const atEnd = maxScroll <= 2 || track.scrollLeft >= maxScroll - 2;
    leftButtons.forEach(button => button.classList.toggle("is-hidden", atStart));
    rightButtons.forEach(button => button.classList.toggle("is-hidden", atEnd));
  }

  function bindUpcomingTrack(){
    const track = upcomingTrack();
    if(!track || track.__homeUpcomingBound) return;
    track.addEventListener("scroll", updateUpcomingArrows, {passive:true});
    window.addEventListener("resize", updateUpcomingArrows);
    track.__homeUpcomingBound = true;
  }

  function patchHome(){
    if(typeof window.home !== "function" || window.home.__upcomingPatched) return;
    const originalHome = window.home;
    window.home = function(){
      const result = originalHome.apply(this, arguments);
      setTimeout(insertUpcomingMatches, 0);
      return result;
    };
    window.home.__upcomingPatched = true;
  }

  window.homeUpcomingScroll = function(direction){
    const track = upcomingTrack();
    if(!track) return;
    const card = track.querySelector(".home-upcoming-card");
    const gap = 18;
    const visibleCards = window.matchMedia("(max-width: 820px)").matches ? 1 : (window.matchMedia("(max-width: 1180px)").matches ? 3 : 4);
    const step = card ? (card.getBoundingClientRect().width + gap) * visibleCards : track.clientWidth;
    track.scrollBy({left: direction * step, behavior:"smooth"});
    setTimeout(updateUpcomingArrows, 120);
    setTimeout(updateUpcomingArrows, 420);
  };

  function boot(){
    patchHome();
    insertUpcomingMatches();
    setTimeout(function(){patchHome();insertUpcomingMatches();}, 80);
    setTimeout(function(){patchHome();insertUpcomingMatches();}, 300);
    setTimeout(updateUpcomingArrows, 520);
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
