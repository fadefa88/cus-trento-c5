(function(){
  "use strict";

  const CONTENT_URL = "/content/data.json";
  const HERO_IMAGE = "/assets/foto-sito.webp?auto=format&fit=crop&w=2200&q=88";
  const TEAM_IMAGE = "/assets/team.jpg";

  const fallbackNews = [
    {title:"CUS Trento: il sogno playoff si ferma ad Arzignano",category:"Prima squadra",image:TEAM_IMAGE,excerpt:"Archivio e racconto della stagione: risultati, gruppo e identità universitaria.",id:"home-news-1"},
    {title:"CUS Trento C5, nuova stagione e identità Uni.Team",category:"Club",image:HERO_IMAGE,excerpt:"Il progetto cresce tra prima squadra, Under 21, studenti e territorio.",id:"home-news-2"},
    {title:"Sanbàpolis, casa del futsal universitario",category:"Matchday",image:"/img/players/7-cirasola-luca-laterale.webp",excerpt:"Tutte le informazioni per seguire le prossime partite e vivere il matchday.",id:"home-news-3"}
  ];

  const fallbackSocial = [
    {network:"Instagram", handle:"@custrentoc5", text:"E con le fasi finali dei CNU 2026 si chiude ufficialmente la nostra stagione.", image:"/img/players/7-cirasola-luca-laterale.webp"},
    {network:"Instagram", handle:"@custrentoc5", text:"Il nostro nuovo capitano per i CNU 2026", image:TEAM_IMAGE},
    {network:"TikTok", handle:"@custrentoc5", text:"Modi creativi per farti correre", image:HERO_IMAGE},
    {network:"TikTok", handle:"@custrentoc5", text:"Non doveva andare così. Futsal, football, training e meme.", image:"/img/players/1-baccaro-zeni-lucca-portiere.webp"}
  ];

  const paths = {home:"/",squad:"/squadra/",staff:"/staff/",fixtures:"/calendario/",standings:"/classifica/",coppa:"/coppa/",matchday:"/matchday/",news:"/news/",social:"/social/",sponsor:"/sponsor/",contacts:"/contatti/"};

  let data = null;
  let loadingStarted = false;
  let renderLock = false;
  let lastRenderKey = "";

  function esc(value){
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  }

  function routeTo(id){
    if(typeof window.route === "function"){
      window.route(id);
      window.setTimeout(renderIfHome, 60);
      return;
    }
    window.location.href = paths[id] || "/";
  }
  window.homeGo = routeTo;

  function canonicalPath(){
    const p = window.location.pathname || "/";
    if(p === "/index.html") return "/";
    return p.endsWith("/") ? p : `${p}/`;
  }

  function isHome(){return canonicalPath() === "/" || window.location.hash === "#home";}
  function asArray(v){return Array.isArray(v) ? v : [];}
  function norm(v){return String(v || "").trim().toLowerCase();}
  function isCusTeam(v){return norm(v).replace(/\s+/g," ").includes("cus trento");}
  function isFinished(match){
    const status = norm(match && match.status);
    return status === "terminata" || status === "finished" || /^\d+\s*[-:]\s*\d+/.test(String(match && match.score || ""));
  }
  function matchDateValue(match){
    const raw = `${match && match.date || ""}T${match && match.time || "00:00"}`;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  function formatDate(value){
    if(!value) return "Da definire";
    const d = new Date(value);
    if(!Number.isFinite(d.getTime())) return String(value);
    return d.toLocaleDateString("it-IT", {day:"2-digit", month:"short"}).replace(".", "");
  }
  function latestFinished(fixtures){return asArray(fixtures).filter(isFinished).sort((a,b)=>matchDateValue(b)-matchDateValue(a))[0] || null;}
  function nextFixture(fixtures){
    const now = Date.now() - 86400000;
    const future = asArray(fixtures).filter(m => !isFinished(m) && matchDateValue(m) >= now).sort((a,b)=>matchDateValue(a)-matchDateValue(b))[0];
    return future || asArray(fixtures).filter(m => !isFinished(m)).sort((a,b)=>matchDateValue(a)-matchDateValue(b))[0] || null;
  }
  function getStandings(source){
    const standings = asArray(source && source.standings);
    if(!standings.length){
      return [{pos:1,team:"CALCIO BLEGGIO",pts:60},{pos:2,team:"CUS TRENTO",pts:54},{pos:3,team:"MEZZOLOMBARDO",pts:53},{pos:4,team:"GNU TEAM ALA",pts:40}];
    }
    const ordered = standings.slice().sort((a,b)=>(Number(a.pos)||99)-(Number(b.pos)||99));
    const cus = ordered.find(x => isCusTeam(x.team));
    const rows = ordered.slice(0,4);
    if(cus && !rows.some(x => isCusTeam(x.team))){rows.pop();rows.push(cus);rows.sort((a,b)=>(Number(a.pos)||99)-(Number(b.pos)||99));}
    return rows;
  }
  function getCusPosition(source){const row=asArray(source&&source.standings).find(x=>isCusTeam(x.team));return row&&row.pos?`#${row.pos}`:"#2";}
  function topScorer(source){
    const candidates=asArray(source&&source.roster).map(p=>({name:p.name,goals:Number(p.goals||(p.competitions&&p.competitions.totale&&p.competitions.totale.goals)||0)})).filter(p=>p.name&&p.goals>0).sort((a,b)=>b.goals-a.goals);
    return candidates[0]?`${candidates[0].goals}`:"0";
  }
  function getNews(source){
    const news=asArray(source&&source.news).filter(n=>n&&n.title).slice(0,3);
    const merged=news.length?news:fallbackNews;
    return merged.slice(0,3).map((item,index)=>({title:item.title||fallbackNews[index].title,category:item.category||item.tag||fallbackNews[index].category,image:item.image||item.cover||fallbackNews[index].image,excerpt:item.excerpt||item.summary||fallbackNews[index].excerpt,id:item.id||fallbackNews[index].id}));
  }
  function getSocial(source){
    const cms=asArray(source&&source.social).filter(s=>s&&(s.text||s.network)).slice(0,4);
    const base=cms.length?cms:fallbackSocial;
    return [0,1,2,3].map(i=>{const item=base[i]||fallbackSocial[i];return {network:item.network||fallbackSocial[i].network,handle:item.handle||fallbackSocial[i].handle,text:item.text||fallbackSocial[i].text,image:item.image||item.thumb||fallbackSocial[i].image};});
  }
  function matchTeams(match){if(!match)return {home:"CUS Trento",away:"Avversario"};return {home:match.home||"CUS Trento",away:match.away||"Avversario"};}
  function matchHtml(match){
    const teams=matchTeams(match);
    return `<div class="hr-matchline"><div><span>${esc(match&&match.competition||"Calendario")}</span><strong>${esc(teams.home)}</strong></div><b>VS</b><div><span>${esc(match&&match.date?formatDate(match.date):"Da definire")}</span><strong>${esc(teams.away)}</strong></div></div>`;
  }
  function standingsHtml(rows){return rows.map(row=>`<div class="hr-standing-row ${isCusTeam(row.team)?"is-cus":""}"><span>${esc(row.pos||"-")}</span><strong>${esc(row.team||"Squadra")}</strong><b>${esc(row.pts??"-")}</b></div>`).join("");}
  function newsCardsHtml(items){return items.map(item=>`<article class="hr-news-card"><div class="hr-news-image" style="background-image:url('${esc(item.image)}')"></div><div class="hr-news-copy"><span>${esc(item.category)}</span><h3>${esc(item.title)}</h3><p>${esc(item.excerpt)}</p><button type="button" onclick="homeGo('news')">Leggi articolo</button></div></article>`).join("");}
  function socialCardsHtml(items){return items.map(item=>`<article class="hr-social-card"><div class="hr-social-photo" style="background-image:url('${esc(item.image)}')"></div><div class="hr-social-body"><div><span>${esc(item.network)}</span><small>${esc(item.handle)}</small></div><p>${esc(item.text)}</p></div></article>`).join("");}

  function render(source){
    const app=document.getElementById("app");
    if(!app) return;
    const fixtures=asArray(source&&source.fixtures);
    const next=nextFixture(fixtures), last=latestFinished(fixtures), rows=getStandings(source), news=getNews(source), social=getSocial(source);
    const cup=source&&source.cup||{title:"Coppa Trentino Alto Adige",status:"Quarti di finale"};
    const position=getCusPosition(source), scorer=topScorer(source), lastScore=last&&last.score?last.score:"-";
    const key=JSON.stringify({path:canonicalPath(),next:next&&[next.date,next.time,next.home,next.away,next.status].join("|"),standing:rows.map(r=>`${r.pos}:${r.team}:${r.pts}`).join("|"),news:news.map(n=>n.title).join("|"),social:social.map(s=>s.text).join("|")});
    if(app.firstElementChild&&app.firstElementChild.classList.contains("home-redesign")&&key===lastRenderKey) return;
    lastRenderKey=key;
    renderLock=true;
    document.body.classList.add("home-redesign-page");
    app.innerHTML=`<section class="home-redesign" aria-label="CUS Trento C5 home"><div class="hr-hero"><div class="hr-hero-copy"><div class="hr-kickers"><span>Serie C1</span><span>Stagione 2026/27</span></div><h1>CUS TRENTO C5<br><em>IL FUTSAL UNIVERSITARIO</em><br>DI TRENTO</h1><p>Prima squadra, Under 21, studenti, tifosi e territorio in un unico progetto sportivo gialloblù.</p><div class="hr-hero-links"><button type="button" onclick="homeGo('fixtures')">Prossima partita</button><button type="button" onclick="homeGo('squad')">Scopri la rosa</button><button type="button" onclick="homeGo('matchday')">Info matchday</button><button type="button" onclick="homeGo('contacts')">Gioca con noi</button><button type="button" onclick="homeGo('sponsor')">Diventa partner</button><button type="button" onclick="homeGo('coppa')">Scopri i nostri eventi</button></div></div><div class="hr-hero-photo" role="img" aria-label="CUS Trento C5 in campo" style="background-image:url('${HERO_IMAGE}')"><div class="hr-score-card"><span>Prossima partita</span>${matchHtml(next)}<div class="hr-score-grid"><div><strong>${esc(position)}</strong><small>Posizione<br>attuale</small></div><div><strong>${esc(scorer)}</strong><small>Top scorer<br>stagione</small></div><div><strong>${esc(lastScore)}</strong><small>Ultimo<br>risultato</small></div></div></div></div></div><section class="hr-section hr-season"><div class="hr-section-head"><span>Stagione 2026/27</span><span>Prima squadra - Under 21</span></div><div class="hr-feature-grid"><article class="hr-info-card"><h2>Calendario</h2>${matchHtml(next)}</article><article class="hr-info-card"><h2>Classifica</h2><div class="hr-standings">${standingsHtml(rows)}</div><button type="button" onclick="homeGo('standings')">Classifica completa</button></article><article class="hr-info-card hr-cup-card"><span>Coppa</span><h2>${esc(cup.title||"Coppa Trentino Alto Adige")}</h2><p>${esc(cup.status||"Calendario da aggiornare")}</p><button type="button" onclick="homeGo('coppa')">Vai alla Coppa</button></article></div><div class="hr-news-label">Official news (scritte da noi)</div><div class="hr-news-grid">${newsCardsHtml(news)}</div></section><section class="hr-section hr-social-wall"><div class="hr-social-head"><div><span>Social wall</span><h2>Ultimi Post</h2></div><button type="button" onclick="homeGo('social')">Apri social wall</button></div><div class="hr-social-grid">${socialCardsHtml(social)}</div></section><section class="hr-section hr-cta-grid"><article class="hr-cta-card hr-cta-play"><div><span>⌖</span><h2>Vuoi giocare?</h2><p>Entra nel CUS Trento C5. Cerchiamo giocatori motivati per allenamenti, campionati e tornei universitari.</p><button type="button" onclick="homeGo('contacts')">Candidati ora</button></div></article><article class="hr-cta-card hr-cta-partner"><div><span>◇</span><h2>Vuoi sponsorizzarci?</h2><p>Dai visibilità al tuo brand e sostieni un progetto sportivo giovane, universitario e radicato nel territorio.</p><button type="button" onclick="homeGo('sponsor')">Scopri le opportunità</button></div></article><article class="hr-cta-card hr-cta-event"><div><span>▦</span><h2>Vuoi partecipare agli eventi?</h2><p>Partite, tornei e serate CUS: scopri tutti gli appuntamenti aperti a studenti, tifosi, aziende e community.</p><button type="button" onclick="homeGo('coppa')">Vai agli eventi</button></div></article></section></section>`;
    window.setTimeout(()=>{renderLock=false;},0);
  }

  function renderIfHome(force){
    if(renderLock) return;
    const app=document.getElementById("app");
    if(!app) return;
    if(!isHome()){document.body.classList.remove("home-redesign-page");lastRenderKey="";return;}
    const already=app.firstElementChild&&app.firstElementChild.classList.contains("home-redesign");
    if(already&&!force){document.body.classList.add("home-redesign-page");return;}
    render(data||{});
  }
  function loadData(){
    if(loadingStarted) return;
    loadingStarted=true;
    fetch(CONTENT_URL,{cache:"no-store"}).then(res=>res.ok?res.json():{}).then(json=>{data=json||{};renderIfHome(true);}).catch(()=>{data={};renderIfHome(true);});
  }
  function wrapRoute(){
    if(typeof window.route!=="function"||window.route.__homeRedesignWrapped) return;
    const original=window.route;
    window.route=function(){const result=original.apply(this,arguments);window.setTimeout(renderIfHome,80);return result;};
    window.route.__homeRedesignWrapped=true;
  }
  function boot(){
    wrapRoute();
    loadData();
    renderIfHome(true);
    const app=document.getElementById("app");
    if(app){new MutationObserver(()=>{if(renderLock)return;window.setTimeout(renderIfHome,30);}).observe(app,{childList:true});}
    window.addEventListener("popstate",()=>window.setTimeout(renderIfHome,60));
    window.addEventListener("hashchange",()=>window.setTimeout(renderIfHome,60));
    window.setTimeout(renderIfHome,300);
    window.setTimeout(renderIfHome,900);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();
