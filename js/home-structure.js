(function(){
  const PLACEHOLDER = "/img/placeholder.webp";

  function h(value){
    return String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }

  function js(value){
    return String(value ?? "").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\n/g," ");
  }

  function localNorm(value){
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function localFmt(value){
    if(typeof fmt === "function") return fmt(value);
    if(!value) return "Da definire";
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("it-IT", {day:"2-digit", month:"short", year:"numeric"}).format(date);
  }

  function teamSelected(){
    try{return view && view.homeTeam === "u21" ? "u21" : "prima";}catch(e){return "prima";}
  }

  function teamLabel(key){return key === "u21" ? "Under 21" : "Prima squadra";}

  function dataForTeam(key){
    const s = typeof state !== "undefined" ? state : {};
    return {
      fixtures: key === "u21" ? (s.u21Fixtures || []) : (s.fixtures || []),
      standings: key === "u21" ? (s.u21Standings || []) : (s.standings || []),
      cup: key === "u21" ? (s.u21Cup || {}) : (s.cup || {}),
      roster: (s.roster || []).filter(p => key === "u21" ? String(p.team || "").toLowerCase().includes("under") : String(p.team || "").toLowerCase().includes("prima"))
    };
  }

  function isCus(name){
    const key = localNorm(name);
    return key === "custrento" || key === "custrentoc5" || key === "custrentou21" || key.includes("custrento");
  }

  function findCus(rows){
    return (rows || []).find(row => isCus(row && row.team)) || {};
  }

  function nextMatch(fixtures){
    if(typeof nextFixture === "function") return nextFixture(fixtures);
    const now = Date.now();
    const future = (fixtures || [])
      .filter(f => f && f.date && !Number.isNaN(Date.parse(f.date)) && Date.parse(f.date) >= now - 86400000)
      .sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
    return future[0] || (fixtures || []).find(f => localNorm(f && f.status) === "dagiocare") || (fixtures || [])[0] || {};
  }

  function lastMatch(fixtures){
    if(typeof lastResult === "function") return lastResult(fixtures);
    return [...(fixtures || [])]
      .filter(f => f && (f.score || localNorm(f.status) === "terminata"))
      .sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))[0] || {};
  }

  function isCupFixture(f){
    const text = `${f && f.competition || ""} ${f && f.round || ""} ${f && f._calendarType || ""}`;
    return localNorm(text).includes("coppa") || localNorm(text).includes("cup");
  }

  function cupFixturesForTeam(teamData, key){
    const explicit = Array.isArray(teamData.cup && teamData.cup.fixtures) ? teamData.cup.fixtures : [];
    if(explicit.length) return explicit;
    return (teamData.fixtures || []).filter(isCupFixture);
  }

  function cupNextFixture(teamData, key){
    const rows = cupFixturesForTeam(teamData, key).slice().sort((a,b) => String(a.date || "").localeCompare(String(b.date || "")));
    return rows.find(row => localNorm(row && row.status) === "dagiocare") || rows[0] || null;
  }

  function compactMatch(match, emptyLabel){
    const hasMatch = match && Object.keys(match).length;
    const id = hasMatch && match.id != null ? String(match.id) : "";
    const click = id ? ` onclick="route('match-${js(id)}')"` : "";
    return `<div class="home-structure-match${id ? " clickable" : ""}"${click}>
      <div class="home-structure-match-top"><span>${h(hasMatch ? localFmt(match.date) : "Calendario")}</span><span>${h(hasMatch ? (match.status || "Da giocare") : "Da aggiornare")}</span></div>
      <div class="home-structure-teams"><b>${h(hasMatch ? (match.home || "CUS Trento") : "CUS Trento")}</b><span>${h(hasMatch ? (match.score || "VS") : "VS")}</span><b>${h(hasMatch ? (match.away || "Avversario") : (emptyLabel || "Avversario"))}</b></div>
      <p>${h(hasMatch ? `${match.venue || "Campo da definire"} · ${match.time || "--:--"}` : "Inserisci le nuove gare dal CMS.")}</p>
    </div>`;
  }

  function standingsRows(rows){
    const list = (rows || []).slice().sort((a,b) => (Number(a.pos) || 999) - (Number(b.pos) || 999));
    const cus = findCus(list);
    let display = list.slice(0,4);
    if(cus.team && !display.some(row => isCus(row.team))) display = [...display.slice(0,3), cus];
    if(!display.length) return `<div class="home-structure-empty">Classifica da aggiornare.</div>`;
    return `<div class="home-structure-standing-list">${display.map(row => `<div class="home-structure-standing-row ${isCus(row.team) ? "is-cus" : ""}">
      <div><span>${h(row.pos || "-")}</span>${row.logo ? `<img src="${h(row.logo)}" alt="${h(row.team || "Squadra")}">` : ""}<b>${h(row.team || "Squadra")}</b></div>
      <strong>${h(row.pts ?? "-")}</strong>
    </div>`).join("")}</div>`;
  }

  function cardCalendar(teamData){
    const next = nextMatch(teamData.fixtures);
    const last = lastMatch(teamData.fixtures);
    return `<article class="card card-pad home-structure-card home-structure-card-calendar">
      <div class="home-structure-card-head"><span>Calendario</span><button onclick="route('fixtures')">Apri</button></div>
      ${compactMatch(next)}
      <div class="home-structure-card-foot"><b>Ultimo risultato</b><span>${h(last && last.score ? last.score : "—")}</span></div>
    </article>`;
  }

  function cardStandings(teamData){
    const rows = teamData.standings || [];
    const cus = findCus(rows);
    return `<article class="card card-pad home-structure-card home-structure-card-standing">
      <div class="home-structure-card-head"><span>Classifica</span><button onclick="route('standings')">Apri</button></div>
      ${standingsRows(rows)}
      <div class="home-structure-card-foot"><b>Posizione CUS</b><span>#${h(cus.pos || "-")} · ${h(cus.pts ?? "-")} pt</span></div>
    </article>`;
  }

  function cardCup(teamData, key){
    const cup = teamData.cup || {};
    const next = cupNextFixture(teamData, key);
    return `<article class="card card-pad home-structure-card home-structure-card-cup">
      <div class="home-structure-card-head"><span>Coppa</span><button onclick="route('coppa')">Apri</button></div>
      <h3>${h(cup.title || (key === "u21" ? "Coppa Under 21" : "Coppa Trentino Alto Adige"))}</h3>
      <p>${h(cup.status || cup.edition || "Percorso coppa da aggiornare")}</p>
      ${compactMatch(next, "Avversario")}
    </article>`;
  }

  function latestThreeNews(){
    const s = typeof state !== "undefined" ? state : {};
    return [...(s.news || [])]
      .sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
      .slice(0,3);
  }

  function newsCard(news, index){
    if(!news){
      return `<article class="card home-structure-news-card"><div class="home-structure-news-image"><img src="${PLACEHOLDER}" alt="News CUS Trento C5"></div><div class="card-pad"><span class="badge">News</span><h3>News da aggiornare</h3><p class="muted">Aggiungi contenuti dal CMS.</p></div></article>`;
    }
    const id = news.id != null ? String(news.id) : `home-news-${index}`;
    return `<article class="card home-structure-news-card clickable" onclick="route('article-${js(id)}')">
      <div class="home-structure-news-image"><img loading="lazy" decoding="async" src="${h(news.image || PLACEHOLDER)}" alt="${h(news.title || "News CUS Trento C5")}"></div>
      <div class="card-pad">
        <span class="badge">${h(news.category || "News")}</span>
        <h3>${h(news.title || "News CUS Trento C5")}</h3>
        <p class="muted">${h(news.excerpt || "Leggi l'aggiornamento completo sul CUS Trento C5.")}</p>
        <button class="btn dark small">Leggi articolo</button>
      </div>
    </article>`;
  }

  function newsStandingsCard(){
    const s = typeof state !== "undefined" ? state : {};
    const rows = s.standings || [];
    const cus = findCus(rows);
    return `<article class="card card-pad home-structure-news-standing-card">
      ${standingsRows(rows)}
      <div class="home-structure-card-foot"><b>CUS Trento</b><span>#${h(cus.pos || "-")} · ${h(cus.pts ?? "-")} pt</span></div>
    </article>`;
  }

  function newsSection(){
    const items = latestThreeNews();
    while(items.length < 3) items.push(null);
    return `<section class="section home-structure-news-section">
      <div class="container">
        <div class="home-structure-section-head home-structure-news-head-grid">
          <span class="eyebrow home-structure-news-eyebrow" role="link" tabindex="0" onclick="route('news')" style="cursor:pointer">NEWS</span>
          <span class="eyebrow home-structure-standings-eyebrow" role="link" tabindex="0" onclick="route('standings')" style="cursor:pointer">CLASSIFICA</span>
        </div>
        <div class="home-structure-news-grid">${items.map(newsCard).join("")}${newsStandingsCard()}</div>
      </div>
    </section>`;
  }

  function ctaCard(kind, title, text, button, routeId){
    return `<article class="home-structure-cta-card home-structure-cta-${kind}">
      <div>
        <h3>${h(title)}</h3>
        <p>${h(text)}</p>
        <button onclick="route('${js(routeId)}')">${h(button)}</button>
      </div>
    </article>`;
  }

  function ctaSection(){
    return `<section class="section home-structure-cta-section">
      <div class="container home-structure-cta-grid">
        ${ctaCard("play", "Vuoi giocare?", "Entra nel CUS Trento C5. Cerchiamo giocatori motivati per allenamenti, campionati e tornei universitari.", "Candidati ora", "contacts")}
        ${ctaCard("partner", "Vuoi sponsorizzarci?", "Dai visibilità al tuo brand e sostieni un progetto sportivo giovane, universitario e radicato nel territorio.", "Scopri le opportunità", "sponsor")}
        ${ctaCard("events", "Vuoi partecipare agli eventi?", "Partite, tornei e serate CUS. Scopri tutti gli appuntamenti aperti a studenti, tifosi, aziende e community.", "Vai agli eventi", "matchday")}
      </div>
    </section>`;
  }


  function heroSection(){
    const s = typeof state !== "undefined" ? state : {};
    const fixtures = s.fixtures || [];
    const standings = s.standings || [];
    const roster = s.roster || [];
    const next = nextMatch(fixtures);
    const last = lastMatch(fixtures);
    const cus = findCus(standings);
    const top = roster.filter(p => String(p.team || "") === "Prima squadra").sort((a,b) => (Number(b.goals) || 0) - (Number(a.goals) || 0))[0] || {};
    const leftMark = next && next.home && String(next.home).includes("CUS") ? "CUS" : String(next && next.home || "").slice(0,2);
    const rightMark = next && next.away && String(next.away).includes("CUS") ? "CUS" : String(next && next.away || "").slice(0,2);
    return `<section class="hero"><div class="container hero-grid"><div><span class="tag">Serie C1</span><span class="tag ghost">Stagione 26/27</span><h1>CUS Trento C5</h1><p class="lead lead-strong">Il futsal universitario di Trento</p><p class="lead">Una squadra, una community, un progetto che unisce sport, università e territorio. Segui la stagione, vivi gli eventi e sostieni il futsal targato UniTrento.</p><div class="btns home-hero-actions"><button class="btn" onclick="route('play-with-us')"><i class="fa-solid fa-futbol" aria-hidden="true"></i><span>Gioca con noi</span></button><button class="btn light" onclick="route('become-partner')"><i class="fa-solid fa-handshake" aria-hidden="true"></i><span>Diventa sponsor</span></button><button class="btn ghost" onclick="route('events')"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i><span>Scopri gli eventi</span></button></div></div><div class="home-hero-socials" aria-label="Profili social CUS Trento C5"><a href="https://www.instagram.com/custrentoc5/" target="_blank" rel="noopener noreferrer" aria-label="Instagram CUS Trento C5"><i class="fa-brands fa-instagram" aria-hidden="true"></i></a><button type="button" onclick="route('social')" aria-label="Facebook CUS Trento C5"><i class="fa-brands fa-facebook-f" aria-hidden="true"></i></button><a href="https://www.tiktok.com/@custrentoc5" target="_blank" rel="noopener noreferrer" aria-label="TikTok CUS Trento C5"><i class="fa-brands fa-tiktok" aria-hidden="true"></i></a><button type="button" onclick="route('video')" aria-label="YouTube CUS Trento C5"><i class="fa-brands fa-youtube" aria-hidden="true"></i></button></div></div></section>`;
  }

  function seasonSection(){
    const key = teamSelected();
    const teamData = dataForTeam(key);
    return `<section class="section home-structure-season-section">
      <div class="container">
        <div class="home-structure-season-head">
          <span>Stagione 2026/27</span>
          <div class="home-structure-team-switch" role="tablist" aria-label="Seleziona squadra home">
            <button class="${key === "prima" ? "active" : ""}" onclick="setHomeTeam('prima')" type="button">Prima squadra</button>
            <button class="${key === "u21" ? "active" : ""}" onclick="setHomeTeam('u21')" type="button">Under 21</button>
          </div>
        </div>
        <div class="home-structure-card-grid">
          ${cardCalendar(teamData)}
          ${cardStandings(teamData)}
          ${cardCup(teamData, key)}
        </div>
      </div>
    </section>`;
  }

  window.setHomeTeam = function(value){
    if(typeof view !== "undefined") view.homeTeam = value === "u21" ? "u21" : "prima";
    if(typeof home === "function") home();
  };

  window.home = function(){
    if(typeof setSEO === "function") setSEO("Home", "CUS Trento C5: sito ufficiale con news, rosa, calendario, classifica, coppa e social wall.");
    const social = typeof homeSocialSection === "function" ? homeSocialSection() : "";
    const siteFooter = typeof footer === "function" ? footer() : "";
    app.innerHTML = `<div class="home-structure">${heroSection()}${newsSection()}${social}${ctaSection()}</div>${siteFooter}`;
  };

  try{
    if(typeof current !== "undefined" && current === "home" && typeof render === "function") render();
  }catch(e){
    if(typeof window.home === "function" && document.getElementById("app")) window.home();
  }
})();
