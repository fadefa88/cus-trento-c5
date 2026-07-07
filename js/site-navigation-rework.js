(function(){
  const MENU_VERSION = "menu-rework-v4";
  const baseUrl = "https://custrentocalcioa5.it";
  const oldRoute = typeof window.route === "function" ? window.route.bind(window) : null;

  const pathByRoute = {
    "home":"/",
    "teams-overview":"/squadre/",
    "squad":"/squadra/",
    "staff":"/staff/",
    "stats":"/statistiche/",
    "play-with-us":"/gioca-con-noi/",
    "fixtures":"/calendario/",
    "standings":"/classifica/",
    "coppa":"/coppa/",
    "cnu":"/cnu/",
    "season-archive":"/archivio-stagioni/",
    "matchday":"/matchday/",
    "events":"/eventi/",
    "events:upcoming":"/eventi/#prossimi-eventi",
    "events:tournaments":"/eventi/#tornei",
    "events:tryout":"/eventi/#open-day-tryout",
    "events:partner":"/eventi/#eventi-partner",
    "events:archive":"/eventi/#archivio-eventi",
    "partner":"/partner/",
    "become-partner":"/diventa-partner/",
    "news":"/news/",
    "gallery":"/gallery/",
    "video":"/video/",
    "social":"/social/",
    "club-project":"/club/",
    "club-history":"/storia/",
    "venue":"/impianto/",
    "values":"/valori/",
    "collaborations":"/collaborazioni/",
    "records":"/hall-of-fame/",
    "contacts":"/contatti/",
    "privacy":"/privacy/",
    "cookies":"/cookies/"
  };

  const pathToRoute = {
    "/":"home",
    "/news/":"news",
    "/squadra/":"squad",
    "/staff/":"staff",
    "/statistiche/":"stats",
    "/calendario/":"fixtures",
    "/classifica/":"standings",
    "/coppa/":"coppa",
    "/matchday/":"matchday",
    "/gallery/":"gallery",
    "/video/":"video",
    "/social/":"social",
    "/hall-of-fame/":"records",
    "/contatti/":"contacts",
    "/privacy/":"privacy",
    "/cookies/":"cookies",
    "/squadre/":"teams-overview",
    "/gioca-con-noi/":"play-with-us",
    "/cnu/":"cnu",
    "/archivio-stagioni/":"season-archive",
    "/eventi/":"events",
    "/partner/":"partner",
    "/diventa-partner/":"become-partner",
    "/club/":"club-project",
    "/storia/":"club-history",
    "/impianto/":"venue",
    "/valori/":"values",
    "/collaborazioni/":"collaborations",
    "/sponsor/":"partner"
  };

  const menuGroups = [
    {label:"Home",items:[["home","Home"]]},
    {label:"Squadre",items:[
      ["teams-overview","Squadre"],
      ["squad","Rosa"],
      ["staff","Staff"],
      ["stats","Statistiche"],
      ["play-with-us","Gioca con noi"]
    ]},
    {label:"Stagione",items:[
      ["fixtures","Calendario"],
      ["standings","Classifica"],
      ["coppa","Coppa"],
      ["cnu","CNU"],
      ["season-archive","Archivio stagioni"],
      ["matchday","Matchday"]
    ]},
    {label:"Eventi",items:[
      ["events:upcoming","Prossimi eventi"],
      ["events:tournaments","Tornei"],
      ["events:tryout","Open day / Tryout"],
      ["events:partner","Eventi partner"],
      ["events:archive","Archivio eventi"]
    ]},
    {label:"Partner",items:[
      ["partner","I nostri partner"],
      ["become-partner","Diventa partner"]
    ]},
    {label:"Media",items:[
      ["news","News"],
      ["gallery","Gallery"],
      ["video","Video"],
      ["social","Social wall"]
    ]},
    {label:"Club",items:[
      ["club-project","Chi siamo / Il progetto"],
      ["club-history","Storia"],
      ["venue","Impianto"],
      ["values","Valori"],
      ["collaborations","Collaborazioni"],
      ["records","Hall of Fame"],
      ["contacts","Contatti"]
    ]}
  ];

  const existingRouteMeta = {
    news:["Media","News","Tutte le notizie, gli aggiornamenti e i contenuti ufficiali del CUS Trento C5."],
    squad:["Squadre","Rosa","Giocatori, ruoli e profili della rosa del CUS Trento C5."],
    staff:["Squadre","Staff","Staff tecnico, dirigenti e figure operative del progetto CUS Trento C5."],
    stats:["Squadre","Statistiche","Numeri, rendimento e dati tecnici della stagione."],
    fixtures:["Stagione","Calendario","Tutte le partite della stagione, per Prima squadra e Under 21."],
    standings:["Stagione","Classifica","Classifiche aggiornate dei campionati del CUS Trento C5."],
    coppa:["Stagione","Coppa","Percorso, turni e partite di coppa del CUS Trento C5."],
    matchday:["Stagione","Matchday","Informazioni utili per seguire le partite e vivere il giorno gara."],
    gallery:["Media","Gallery","Album fotografici e contenuti visuali del club."],
    video:["Media","Video","Highlights, interviste e contenuti video del CUS Trento C5."],
    social:["Media","Social wall","Aggiornamenti social e contenuti dalla community CUS."],
    records:["Club","Hall of Fame","Record, numeri storici e protagonisti del CUS Trento C5."],
    contacts:["Club","Contatti","Contatti ufficiali, richieste informazioni e riferimenti del club."],
    privacy:["Privacy","Privacy policy","Informazioni privacy e trattamento dati del sito."],
    cookies:["Cookie","Cookie policy","Informazioni sull'utilizzo dei cookie e contenuti esterni."],
    partner:["Partner","I nostri partner","Aziende, realtà e sponsor che sostengono il progetto CUS Trento C5."],
    sponsor:["Partner","I nostri partner","Aziende, realtà e sponsor che sostengono il progetto CUS Trento C5."],
    "club-project":["Club","Chi siamo / Il progetto","Identità, obiettivi e visione sportiva del CUS Trento C5."],
    club:["Club","Chi siamo / Il progetto","Identità, obiettivi e visione sportiva del CUS Trento C5."]
  };

  function h(value){
    return String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }

  function norm(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "pagina";
  }

  function localState(){
    try{return state || {};}catch(e){return {};}
  }

  function siteFooter(){
    try{return typeof footer === "function" ? footer() : "";}catch(e){return "";}
  }

  function seo(title, desc, path){
    if(typeof setSEO === "function") setSEO(title, desc);
    const canonical = document.getElementById("canonical");
    if(canonical && path) canonical.href = baseUrl + path;
    const ogTitle = document.getElementById("ogTitle");
    const ogDescription = document.getElementById("ogDescription");
    if(ogTitle) ogTitle.content = `CUS Trento C5 — ${title}`;
    if(ogDescription) ogDescription.content = desc;
  }

  function fmtDate(value){
    if(typeof fmt === "function") return fmt(value);
    if(!value) return "Da definire";
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"short",year:"numeric"}).format(date);
  }

  function monthDay(value){
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return {day:"--",month:"TBD"};
    return {
      day:new Intl.DateTimeFormat("it-IT",{day:"2-digit"}).format(date),
      month:new Intl.DateTimeFormat("it-IT",{month:"short"}).format(date).replace(".","")
    };
  }

  function isCustomRoute(routeId){
    return [
      "teams-overview","play-with-us","events","events:upcoming","events:tournaments","events:tryout",
      "events:partner","events:archive","cnu","season-archive","partner","become-partner",
      "club-project","club-history","venue","values","collaborations"
    ].includes(String(routeId || "")) || String(routeId || "").startsWith("event-detail:");
  }

  function topActive(routeId){
    const base = String(routeId || window.__cusActiveRoute || "home");
    if(base.startsWith("events") || base.startsWith("event-detail")) return "events";
    if(["teams-overview","squad","staff","stats","play-with-us"].includes(base)) return "teams";
    if(["fixtures","standings","coppa","cnu","season-archive","matchday"].includes(base)) return "season";
    if(["partner","become-partner"].includes(base)) return "partner";
    if(["news","gallery","video","social"].includes(base)) return "media";
    if(["club-project","club-history","venue","values","collaborations","records","contacts"].includes(base)) return "club";
    return base === "home" ? "home" : "";
  }

  function renderCusMenu(){
    const nav = document.getElementById("navGroups");
    const mobile = document.getElementById("mobileMenu");
    if(!nav || !mobile) return;
    const active = window.__cusActiveRoute || routeFromLocation() || "home";
    const activeTop = topActive(active);

    nav.dataset.cusRework = "true";
    nav.innerHTML = menuGroups.map(group => {
      const groupKey = topKey(group.label);
      if(group.items.length === 1){
        const [id,label] = group.items[0];
        return `<div class="nav-group"><button class="nav-main ${activeTop===groupKey ? "active" : ""}" onclick="cusMenuRoute('${id}')">${h(label)}</button></div>`;
      }
      const first = group.items[0][0];
      return `<div class="nav-group">
        <button class="nav-main ${activeTop===groupKey ? "active" : ""}" onclick="cusMenuRoute('${first}')">${h(group.label)}</button>
        <div class="dropdown">
          ${group.items.map(([id,label]) => `<button class="${active===id ? "active" : ""}" onclick="cusMenuRoute('${id}')">${h(label)}</button>`).join("")}
        </div>
      </div>`;
    }).join("");

    mobile.dataset.cusRework = "true";
    mobile.innerHTML = `<div class="cus-mobile-menu-head"><span>Menu</span><button type="button" onclick="cusCloseMobileMenu()" aria-label="Chiudi menu">×</button></div>` + menuGroups.map(group => {
      const groupKey = topKey(group.label);
      const isOpen = activeTop === groupKey;
      if(group.items.length === 1){
        const [id,label] = group.items[0];
        return `<button class="cus-mobile-link ${active===id ? "active" : ""}" onclick="cusMenuRoute('${id}');cusCloseMobileMenu()">${h(label)}</button>`;
      }
      return `<details ${isOpen ? "open" : ""}><summary>${h(group.label)}</summary>${group.items.map(([id,label]) => `<button class="${active===id ? "active" : ""}" onclick="cusMenuRoute('${id}');cusCloseMobileMenu()">${h(label)}</button>`).join("")}</details>`;
    }).join("");
  }

  function topKey(label){
    const key = String(label || "").toLowerCase();
    if(key === "squadre") return "teams";
    if(key === "stagione") return "season";
    if(key === "eventi") return "events";
    if(key === "partner") return "partner";
    if(key === "media") return "media";
    if(key === "club") return "club";
    return "home";
  }

  function pushRoute(routeId, replace){
    const path = pathByRoute[routeId] || "/"+norm(routeId)+"/";
    if(replace) history.replaceState({route:routeId},"",path);
    else history.pushState({route:routeId},"",path);
  }

  function setApp(html, routeId, title, desc, replace){
    const target = document.getElementById("app");
    if(!target) return;
    window.__cusActiveRoute = routeId;
    seo(title, desc, (pathByRoute[routeId] || location.pathname));
    if(!replace) pushRoute(routeId, false);
    target.innerHTML = `<div class="cus-rework-page">${html}</div>${siteFooter()}`;
    renderCusMenu();
    window.scrollTo({top:0,behavior:"instant"});
  }

  function pageHero(kicker,title,lead){
    return `<section class="cus-rework-section cus-rework-page-intro"><div class="container"><span class="cus-rework-kicker">${h(kicker)}</span><h1 class="cus-rework-title">${h(title)}</h1><p class="cus-rework-lead">${h(lead)}</p></div></section>`;
  }

  function routeMeta(routeId){
    const key = String(routeId || "");
    if(key.startsWith("article-")) return ["News","Articolo","Dettaglio articolo e contenuto editoriale del CUS Trento C5."];
    return existingRouteMeta[key] || ["CUS Trento C5","CUS Trento C5","Sito ufficiale del CUS Trento C5."];
  }

  function injectStandardHero(routeId){
    return;
  }

  function afterOldRoute(routeId){
    setTimeout(() => {
      renderCusMenu();
    }, 0);
  }

  window.cusCloseMobileMenu = function(){
    const mobile = document.getElementById("mobileMenu");
    const toggle = document.querySelector(".mobile-toggle");
    if(mobile){
      mobile.classList.remove("open");
      mobile.setAttribute("aria-hidden","true");
    }
    if(toggle) toggle.setAttribute("aria-expanded","false");
  };

  const nativeToggleMobile = typeof window.toggleMobile === "function" ? window.toggleMobile.bind(window) : null;
  window.toggleMobile = function(){
    const mobile = document.getElementById("mobileMenu");
    const toggle = document.querySelector(".mobile-toggle");
    if(mobile && mobile.dataset.cusRework === "true"){
      const open = !mobile.classList.contains("open");
      mobile.classList.toggle("open", open);
      mobile.setAttribute("aria-hidden", open ? "false" : "true");
      if(toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
    if(nativeToggleMobile) nativeToggleMobile();
  };

  function metric(value,label){
    return `<div class="cus-rework-metric"><b>${h(value)}</b><span>${h(label)}</span></div>`;
  }

  function teamRoster(teamName){
    const s = localState();
    return (s.roster || []).filter(p => String(p.team || "").toLowerCase().includes(String(teamName).toLowerCase()));
  }

  function rosterCount(teamName){
    return teamRoster(teamName).length;
  }

  function playerAgeYears(player){
    const raw = player && (player.birthDate || player.dateOfBirth || player.dob || player.nascita);
    if(raw){
      const born = new Date(raw);
      if(!Number.isNaN(born.getTime())){
        const years = (new Date() - born) / (365.2425 * 24 * 60 * 60 * 1000);
        if(Number.isFinite(years) && years > 0 && years < 90) return years;
      }
    }
    const fallback = Number(player && player.age);
    return Number.isFinite(fallback) && fallback > 0 && fallback < 90 ? fallback : null;
  }

  function averageRosterAge(teamName){
    const ages = teamRoster(teamName).map(playerAgeYears).filter(value => value != null);
    if(!ages.length) return "—";
    const avg = ages.reduce((sum,value) => sum + value, 0) / ages.length;
    return avg.toLocaleString("it-IT", {minimumFractionDigits:1, maximumFractionDigits:1});
  }

  function futureMatchCount(list){
    return (list || []).filter(m => !m.score && String(m.status || "").toLowerCase() !== "terminata").length;
  }

  function renderTeamsOverview(replace){
    const s = localState();
    const prima = rosterCount("prima");
    const u21 = rosterCount("under");
    const primaAge = averageRosterAge("prima");
    const u21Age = averageRosterAge("under");
    const html = `${pageHero("Squadre","Le nostre squadre","CUS Trento C5 è un progetto sportivo costruito su più livelli: dalla competizione federale alla crescita dei giovani, fino alla rappresentanza universitaria. Ogni squadra porta in campo la stessa identità: impegno, appartenenza e voglia di rappresentare il CUS Trento dentro e fuori dal campo.")}
      <section class="cus-rework-section">
        <div class="container">
          <div class="cus-rework-grid two">
            ${teamCard("Prima squadra","La prima squadra è il cuore agonistico del CUS Trento C5. Un gruppo che affronta la stagione con intensità, metodo e spirito di squadra, rappresentando il club nei principali appuntamenti del calcio a 5 regionale.",prima,primaAge,"SERIE C1","/assets/foto-sito.webp?auto=format&fit=crop&w=1200&q=90","squad")}
            ${teamCard("Under 21","L’Under 21 è il percorso di crescita dedicato ai giovani giocatori del CUS Trento C5. Una squadra pensata per formare atleti pronti ad affrontare il futsal con serietà, continuità e responsabilità.",u21,u21Age,"SERIE D","/img/players/foto-squadra-u21.webp?auto=format&fit=crop&w=1200&q=90","squad")}
          </div>
        </div>
      </section>
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-band">
            <div class="cus-rework-head" style="margin-bottom:0">
              <div><h2>Vuoi entrare in squadra?</h2><p>Hai voglia di metterti alla prova, allenarti con continuità e vivere il futsal in un ambiente serio, giovane e di squadra?<br>Il CUS Trento C5 cerca giocatori motivati, pronti a crescere, competere e rappresentare con orgoglio i colori del CUS Trento e dell’Università degli Studi di Trento, dentro e fuori dal campo.
</p></div>
              <button class="cus-rework-action red" onclick="cusMenuRoute('play-with-us')">Candidati come giocatore</button>
            </div>
          </div>
        </div>
      </section>`;
    setApp(html,"teams-overview","Squadre","Prima squadra e Under 21 del CUS Trento C5.",replace);
  }

  function teamCard(title,text,count,averageAge,championship,image,routeId){
    return `<article class="cus-rework-card">
      <div class="cus-rework-media"><img src="${h(image)}" alt="${h(title)} CUS Trento C5" loading="lazy"></div>
      <div class="cus-rework-card-pad">
        <h3>${h(title)}</h3>
        <p>${h(text)}</p>
        <div class="cus-rework-metrics">
          ${metric(count || "—","Giocatori")}
          ${metric(averageAge,"Età media")}
          ${metric(championship,"campionato")}
        </div>
        <button class="cus-rework-action" onclick="route('${routeId}')">Apri rosa</button>
      </div>
    </article>`;
  }

  function renderPlayWithUs(replace){
    const intro = "Hai voglia di metterti alla prova nel futsal, allenarti con continuità e giocare per la squadra dell’Università? Il CUS Trento C5 cerca giocatori motivati, pronti a crescere dentro un ambiente serio, giovane e universitario. Che tu sia uno studente, un atleta con esperienza o un giocatore che vuole rimettersi in gioco, qui puoi trovare spazio, gruppo e competizione.";
    const faqs = [
      ["Chi può candidarsi?","Possono candidarsi studenti universitari e studenti delle scuole superiori motivati a entrare nel progetto CUS Trento C5."],
      ["Devo essere per forza uno studente universitario?","Il progetto sportivo è rivolto sia a studenti universitari sia a studenti delle scuole superiori."],
      ["Serve esperienza nel calcio a 5?","L’esperienza nel futsal è utile, ma non obbligatoria. Valutiamo anche giocatori provenienti dal calcio a 11 o da altri percorsi sportivi."],
      ["Come funziona la candidatura?","Compila il modulo con i tuoi dati, il ruolo, le esperienze precedenti e i contatti. Lo staff valuterà il profilo e, se in linea con il progetto, ti contatterà per un allenamento di prova."],
      ["Quando si svolgono gli allenamenti?","Gli allenamenti si svolgono in orario serale, indicativamente il lunedì e il mercoledì. Giorni e orari possono variare in base alla stagione e alla squadra di riferimento. Le informazioni definitive verranno comunicate direttamente dallo staff."],
      ["Cosa devo portare al primo allenamento?","Porta abbigliamento sportivo e scarpe adatte al campo indoor. Eventuali ulteriori indicazioni verranno comunicate dallo staff prima dell’allenamento."],
      ["Posso scegliere tra prima squadra e Under 21?","L’inserimento nella prima squadra o nell’Under 21 viene valutato dallo staff in base a età, livello, esperienza e disponibilità agli allenamenti. L’obiettivo è trovare il percorso più adatto per ogni giocatore."],
      ["Come vengo contattato?","Verrai contattato tramite il numero di telefono o l’email indicati nel modulo di candidatura."]
    ];
    const html = `${pageHero("Gioca con noi","Entra in squadra",intro)}
      <section class="cus-rework-section">
        <div class="container">
          <div class="cus-rework-grid two">
            <article class="cus-rework-card cus-rework-card-pad">
              <span class="badge">Cosa cerchiamo</span>
              <h2 style="margin-top:12px">Persone prima ancora che giocatori</h2>
              <p>Cerchiamo persone prima ancora che giocatori: atleti affidabili, disponibili ad allenarsi con impegno e capaci di vivere il gruppo con rispetto. Non conta solo il livello tecnico. Conta la voglia di migliorare, la continuità, l’atteggiamento e la disponibilità a rappresentare i colori del CUS Trento e dell’Università degli Studi di Trento, dentro e fuori dal campo.</p>
            </article>
            <article class="cus-rework-card cus-rework-card-pad">
              <span class="badge">Come funziona</span>
              <h2 style="margin-top:12px">Candidatura e prova</h2>
              <p>Invia la tua candidatura compilando il modulo con i tuoi dati e le informazioni sportive principali. Lo staff valuterà il profilo ricevuto e, se in linea con il progetto CUS Trento C5, ti contatterà per un allenamento di prova.</p>
            </article>
          </div>
        </div>
      </section>
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-band">
            <div class="cus-rework-head" style="margin-bottom:0">
              <div>
                <h2>Invia la tua candidatura</h2>
                <p>Nel modulo ti chiediamo di indicare nome, cognome, data di nascita, ruolo, esperienze sportive precedenti e un contatto telefonico.<br><br>Se sei uno studente universitario, inserisci anche il dipartimento, l’anno di corso e specifica se sei fuori sede o residente a Trento.<br><br>Se frequenti le scuole superiori, indica la scuola, che anno stai frequentando e le tue esperienze sportive nel territorio.</p>
              </div>
              <button class="cus-rework-action red" onclick="route('contacts')">INVIA LA TUA CANDIDATURA</button>
            </div>
          </div>
        </div>
      </section>
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-head"><div><h2>FAQ</h2><p>Le risposte principali prima di candidarti.</p></div></div>
          <div class="cus-rework-grid two">
            ${faqs.map(item => faq(item[0],item[1])).join("")}
          </div>
        </div>
      </section>`;
    setApp(html,"play-with-us","Gioca con noi","Candidati per entrare nel CUS Trento C5.",replace);
  }

  function faq(q,a){return `<article class="cus-rework-card cus-rework-card-pad"><h3>${h(q)}</h3><p>${h(a)}</p></article>`;}

  const fallbackEvents = [
    {id:"open-day-1",title:"Open day CUS Trento C5",type:"Open day / Tryout",date:"2026-09-08",time:"20:30",venue:"Sanbàpolis",summary:"Serata di prova aperta a nuovi giocatori interessati a Prima squadra e Under 21.",section:"tryout"},
    {id:"torneo-studenti",title:"Torneo studenti UniTrento",type:"Torneo",date:"2026-09-21",time:"18:00",venue:"Sanbàpolis",summary:"Torneo promozionale aperto alla community universitaria.",section:"tournaments"},
    {id:"partner-night",title:"Partner Night",type:"Evento partner",date:"2026-10-03",time:"19:30",venue:"Sanbàpolis",summary:"Incontro con sponsor, aziende e realtà del territorio.",section:"partner"},
    {id:"matchday-community",title:"Community Matchday",type:"Prossimo evento",date:"2026-10-17",time:"20:45",venue:"Sanbàpolis",summary:"Matchday con attività per studenti, famiglie e tifosi.",section:"upcoming"},
    {id:"tryout-u21",title:"Tryout Under 21",type:"Open day / Tryout",date:"2026-11-04",time:"19:00",venue:"Sanbàpolis",summary:"Sessione dedicata ai profili giovani per il gruppo Under 21.",section:"tryout"},
    {id:"futsal-campus",title:"Futsal Campus",type:"Torneo",date:"2026-12-12",time:"15:00",venue:"Palestra CUS",summary:"Evento tecnico e mini torneo dedicato alla community CUS.",section:"tournaments"}
  ];

  function allEvents(){
    const s = localState();
    const cmsEvents = Array.isArray(s.events) ? s.events : [];
    return cmsEvents.length ? cmsEvents : fallbackEvents;
  }

  function renderEvents(routeId, replace){
    const section = String(routeId || "events").split(":")[1] || "upcoming";
    const html = `${pageHero("Eventi","Eventi CUS Trento C5","Prossimi eventi, tornei, open day, tryout, attività partner e archivio in un'unica pagina organizzata per sezioni.")}
      <section class="cus-rework-section">
        <div class="container">
          <div class="cus-rework-event-tabs">
            ${eventTab("events:upcoming","Prossimi eventi",section==="upcoming")}
            ${eventTab("events:tournaments","Tornei",section==="tournaments")}
            ${eventTab("events:tryout","Open day / Tryout",section==="tryout")}
            ${eventTab("events:partner","Eventi partner",section==="partner")}
            ${eventTab("events:archive","Archivio eventi",section==="archive")}
          </div>
          ${eventsBlock("prossimi-eventi","Prossimi eventi","upcoming")}
          ${eventsBlock("tornei","Tornei","tournaments")}
          ${eventsBlock("open-day-tryout","Open day / Tryout","tryout")}
          ${eventsBlock("eventi-partner","Eventi partner","partner")}
          ${eventsBlock("archivio-eventi","Eventi passati / Archivio","archive")}
        </div>
      </section>`;
    setApp(html,routeId || "events","Eventi","Eventi, tornei e open day del CUS Trento C5.",replace);
    setTimeout(() => {
      const targetId = section === "tournaments" ? "tornei" : section === "tryout" ? "open-day-tryout" : section === "partner" ? "eventi-partner" : section === "archive" ? "archivio-eventi" : "prossimi-eventi";
      const el = document.getElementById(targetId);
      if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
    }, 80);
  }

  function eventTab(id,label,active){return `<button class="${active ? "active" : ""}" onclick="cusMenuRoute('${id}')">${h(label)}</button>`;}

  function eventsBlock(anchor,title,section){
    let items = allEvents().filter(ev => {
      const evSection = ev.section || sectionFromType(ev.type);
      if(section === "archive") return ev.archive || new Date(ev.date) < new Date();
      if(ev.archive) return false;
      return evSection === section || (section === "upcoming" && !["tournaments","tryout","partner"].includes(evSection));
    });
    if(!items.length && section !== "archive") items = allEvents().filter(ev => !ev.archive).slice(0,3);
    return `<div id="${h(anchor)}" class="cus-rework-anchor" style="margin-bottom:42px">
      <div class="cus-rework-head"><div><h2>${h(title)}</h2><p>Card evento cliccabile con rimando alla scheda di dettaglio.</p></div></div>
      <div class="cus-rework-grid three">${items.length ? items.map(eventCard).join("") : `<article class="cus-rework-card cus-rework-card-pad"><h3>Nessun evento</h3><p>Aggiungi gli eventi dal CMS quando la collection sarà disponibile.</p></article>`}</div>
    </div>`;
  }

  function sectionFromType(type){
    const t = String(type || "").toLowerCase();
    if(t.includes("torneo")) return "tournaments";
    if(t.includes("tryout") || t.includes("open")) return "tryout";
    if(t.includes("partner")) return "partner";
    return "upcoming";
  }

  function eventCard(ev){
    const d = monthDay(ev.date);
    return `<article class="cus-rework-card cus-event-card clickable" onclick="cusMenuRoute('event-detail:${h(ev.id || norm(ev.title))}')">
      <div class="cus-event-top"><div class="cus-event-date"><div><b>${h(d.day)}</b><span>${h(d.month)}</span></div></div><span class="cus-event-type">${h(ev.type || "Evento")}</span></div>
      <div class="cus-rework-card-pad">
        <h3>${h(ev.title || "Evento CUS")}</h3>
        <p>${h(ev.summary || ev.description || "Informazioni evento in aggiornamento.")}</p>
        <small>${h(fmtDate(ev.date))} · ${h(ev.time || "Orario TBC")} · ${h(ev.venue || "Luogo da definire")}</small>
        <button>Info evento</button>
      </div>
    </article>`;
  }

  function renderEventDetail(routeId, replace){
    const id = String(routeId).replace(/^event-detail:/,"");
    const ev = allEvents().find(x => String(x.id || norm(x.title)) === id) || allEvents()[0];
    if(!ev){renderEvents("events:upcoming", replace);return;}
    const d = monthDay(ev.date);
    const path = `/eventi/${norm(ev.title || ev.id)}/`;
    window.__cusActiveRoute = routeId;
    if(!replace) history.pushState({route:routeId},"",path);
    seo(ev.title || "Evento","Dettaglio evento CUS Trento C5.",path);
    const html = `${pageHero(ev.type || "Evento",ev.title || "Evento CUS",ev.summary || ev.description || "Scheda evento in aggiornamento.")}
      <section class="cus-rework-section">
        <div class="container cus-rework-split">
          <div class="cus-rework-band"><h2>${h(d.day)} ${h(d.month)}</h2><p>${h(fmtDate(ev.date))} · ${h(ev.time || "Orario TBC")}<br>${h(ev.venue || "Luogo da definire")}</p><button class="cus-rework-action red" onclick="route('contacts')">Chiedi informazioni</button></div>
          <article class="cus-rework-card cus-rework-card-pad"><h3>Tutte le info</h3><p>${h(ev.details || ev.description || ev.summary || "Dettagli in aggiornamento.")}</p><button class="cus-rework-action" onclick="cusMenuRoute('events:upcoming')">Torna agli eventi</button></article>
        </div>
      </section>`;
    document.getElementById("app").innerHTML = `<div class="cus-rework-page">${html}</div>${siteFooter()}`;
    renderCusMenu();
    window.scrollTo({top:0,behavior:"instant"});
  }

  function renderCnu(replace){
    const s = localState();
    const intro = [
      "I Campionati Nazionali Universitari sono il luogo in cui lo sport universitario si accende davvero: squadre da tutta Italia, atenei da rappresentare, partite da vivere e una maglia che pesa un po’ di più.",
      "Per il CUS Trento C5 i CNU sono una delle esperienze più significative della stagione. Non si partecipa solo per giocare: si partecipa per portare in campo l’Università di Trento, il gruppo, il lavoro fatto durante l’anno e il senso di appartenenza a una community.",
      "Ogni convocato rappresenta qualcosa di più del proprio ruolo: rappresenta Trento, il CUS e tutti gli studenti che vivono lo sport come parte del proprio percorso universitario.",
      "La partecipazione è riservata agli studenti-atleti dell’Università di Trento che rispettano i requisiti previsti dal regolamento CNU. Lo staff valuta i profili in base a età, disponibilità, ruolo, livello sportivo e percorso all’interno del progetto."
    ];
    const results = [
      {phase:"Fasi qualificatorie",home:"CUS TRENTO",away:"CUS PIEMONTE ORIENTALE",score:"2-2",venue:"SANBÀPOLIS",time:"14:30",date:"2026-03-17"},
      {phase:"Fasi qualificatorie",home:"CUS PIEMONTE ORIENTALE",away:"CUS TRENTO",score:"4-8",venue:"SANBÀPOLIS",time:"14:30",date:"2026-04-14"},
      {phase:"Fasi finali",home:"CUS TRENTO",away:"CUS SALERNO",score:"5-5",venue:"PALA DAL LAGO (NOVARA)",time:"9:00",date:"2026-05-25"},
      {phase:"Fasi finali",home:"CUS BARI",away:"CUS TRENTO",score:"6-2",venue:"PALA DAL LAGO (NOVARA)",time:"9:00",date:"2026-05-26"}
    ];
    const albums = Array.isArray(s.galleryAlbums) ? s.galleryAlbums : [];
    const cnuAlbums = albums.filter(album => {
      const values = [...(Array.isArray(album.categories) ? album.categories : []), album.category, album.title].map(x => String(x || "").toLowerCase());
      return values.some(x => x.includes("cnu") || x.includes("campionati nazionali universitari"));
    });
    const cnuPhotos = cnuAlbums.flatMap(album => (album.photos || []).map((photo,idx) => ({photo,title:album.title || "CNU",idx}))).slice(0,8);
    const resultCards = results.map(match => `<article class="cus-rework-card cus-rework-card-pad"><span class="badge">${h(match.phase)}</span><h3>${h(match.home)} vs ${h(match.away)}</h3><div class="cus-rework-metrics"><div class="cus-rework-metric"><b>${h(match.score)}</b><span>Risultato</span></div><div class="cus-rework-metric"><b>${h(match.time)}</b><span>Ora</span></div></div><p>${h(match.venue)} · ${h(fmtDate(match.date))}</p></article>`).join("");
    const galleryHtml = cnuPhotos.length
      ? `<div class="cus-rework-grid four">${cnuPhotos.map(item => `<article class="cus-rework-card"><div class="cus-rework-media"><img src="${h(item.photo)}" alt="${h(item.title)} CNU"></div></article>`).join("")}</div>`
      : `<article class="cus-rework-card cus-rework-card-pad"><h3>Fotogallery in aggiornamento</h3><p>Per mostrare qui le immagini, crea o modifica un album nella Gallery del CMS e assegna la categoria CNU.</p></article>`;
    const html = `${pageHero("CNU","Campionati Nazionali Universitari","Lo sport universitario nazionale, la maglia dell’Università di Trento e il percorso del CUS Trento C5.")}
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-band"><h2>Cosa sono i CNU</h2>${intro.map(p=>`<p>${h(p)}</p>`).join("")}</div>
        </div>
      </section>
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-head"><div><span class="cus-rework-kicker">CNU 2026</span><h2>Risultati</h2></div></div>
          <div class="cus-rework-grid two">${resultCards}</div>
        </div>
      </section>
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-band"><h2>Migliori piazzamenti</h2><ul class="cus-rework-list"><li>Qualificazione fasi finali CNU 2023 — Camerino</li><li>Qualificazione fasi finali CNU 2026 — Novara</li></ul></div>
        </div>
      </section>
      <section class="cus-rework-section compact">
        <div class="container">
          <div class="cus-rework-head"><div><span class="cus-rework-kicker">Fotogallery</span><h2>CNU in immagini</h2><p>Le foto vengono lette dagli album Gallery gestiti nel CMS con categoria CNU.</p></div></div>
          ${galleryHtml}
        </div>
      </section>`;
    setApp(html,"cnu","CNU","Campionati Nazionali Universitari del CUS Trento C5.",replace);
  }

  function renderSeasonArchive(replace){
    const s = localState();
    const rows = (s.historicalStats && Array.isArray(s.historicalStats.seasons) ? s.historicalStats.seasons : (s.seasons || []));
    const html = `${pageHero("Archivio stagioni","Classifiche e stagioni passate","La storia del CUS Trento C5 raccontata stagione dopo stagione: risultati e statistiche che hanno segnato il percorso della prima squadra.")}
      <section class="cus-rework-section"><div class="container"><div class="table-wrap"><table class="cus-rework-table">
      <thead><tr><th>Stagione</th><th>Gare</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th>Diff.</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${h(r.season)}</td><td>${h(r.played || "-")}</td><td>${h(r.wins || "-")}</td><td>${h(r.draws || "-")}</td><td>${h(r.losses || "-")}</td><td>${h(r.goalsFor || "-")}</td><td>${h(r.goalsAgainst || "-")}</td><td>${h(r.goalDifference || r.note || "-")}</td></tr>`).join("")}</tbody>
      </table></div></div></section>`;
    setApp(html,"season-archive","Archivio stagioni","Archivio storico stagioni CUS Trento C5.",replace);
  }

  function renderBecomePartner(replace){
    const s = localState();
    const packs = Array.isArray(s.sponsorPackages) ? s.sponsorPackages : [];
    const html = `${pageHero("Diventa partner","Costruiamo valore insieme","Pacchetti, visibilità e contatti per aziende e realtà del territorio che vogliono sostenere il CUS Trento C5.")}
      <section class="cus-rework-section">
        <div class="container">
          <div class="cus-rework-grid four">
            ${packs.map(p => `<article class="cus-rework-card cus-rework-card-pad"><span class="badge">${h(p.price || "Su richiesta")}</span><h3>${h(p.name)}</h3><ul class="cus-rework-list">${(p.visibility || []).map(v=>`<li>${h(v)}</li>`).join("")}</ul><button class="cus-rework-action" onclick="route('contacts')">${h(p.cta || "Richiedi informazioni")}</button></article>`).join("") || `<article class="cus-rework-card cus-rework-card-pad"><h3>Pacchetti partner</h3><p>Configura i pacchetti sponsor dal CMS o contattaci per una proposta personalizzata.</p><button class="cus-rework-action" onclick="route('contacts')">Contatti</button></article>`}
          </div>
        </div>
      </section>`;
    setApp(html,"become-partner","Diventa partner","Pacchetti partner e sponsorship CUS Trento C5.",replace);
  }

  function renderClubHistory(replace){
    const s = localState();
    const history = s.clubHistory || {};
    const html = `${pageHero("Storia",history.title || "La nostra storia","Le tappe principali del CUS Trento C5: nascita, crescita, promozioni e identità universitaria.")}
      <section class="cus-rework-section"><div class="container cus-rework-split">
        <article class="cus-rework-card cus-rework-card-pad">${(history.paragraphs || ["Storia in aggiornamento."]).map(p=>`<p style="margin-bottom:16px">${h(p)}</p>`).join("")}</article>
        <div class="cus-rework-grid">${(history.images || []).slice(-4).reverse().map(img=>`<article class="cus-rework-card"><div class="cus-rework-media"><img src="${h(img.image || "/img/placeholder.webp")}" alt="${h(img.season || "Stagione")}"></div><div class="cus-rework-card-pad"><h3>${h(img.season || "Stagione")}</h3></div></article>`).join("")}</div>
      </div></section>`;
    setApp(html,"club-history","Storia","Storia del CUS Trento C5.",replace);
  }

  function renderVenue(replace){
    const html = `${pageHero("Impianto","Sanbàpolis","La casa del CUS Trento C5: il punto di riferimento per partite, allenamenti, eventi e attività della community.")}
      <section class="cus-rework-section"><div class="container cus-rework-split">
        <div class="cus-rework-card"><div class="cus-rework-media"><img src="/assets/foto-sito.webp?auto=format&fit=crop&w=1400&q=80" alt="Sanbàpolis CUS Trento C5"></div></div>
        <article class="cus-rework-card cus-rework-card-pad"><h3>Informazioni impianto</h3><p>Sanbàpolis ospita matchday, allenamenti e iniziative del club. La pagina può essere arricchita con indirizzo, parcheggi, accessibilità, mappe e info per il pubblico.</p><button class="cus-rework-action" onclick="route('matchday')">Info matchday</button></article>
      </div></section>`;
    setApp(html,"venue","Impianto","Impianto e casa del CUS Trento C5.",replace);
  }

  function renderValues(replace){
    const values = [
      ["Identità universitaria","Un progetto sportivo legato alla community CUS e al territorio trentino."],
      ["Crescita","Spazio a giovani, studenti e profili motivati a migliorare."],
      ["Responsabilità","Rispetto, impegno e affidabilità dentro e fuori dal campo."],
      ["Community","Partite, eventi e iniziative aperte a tifosi, famiglie, aziende e studenti."]
    ];
    const html = `${pageHero("Valori","Il modo in cui giochiamo","I principi che guidano squadra, staff e progetto sportivo.")}
      <section class="cus-rework-section"><div class="container"><div class="cus-rework-grid four">${values.map(v=>`<article class="cus-rework-card cus-rework-card-pad"><h3>${h(v[0])}</h3><p>${h(v[1])}</p></article>`).join("")}</div></div></section>`;
    setApp(html,"values","Valori","Valori del CUS Trento C5.",replace);
  }

  function renderCollaborations(replace){
    const html = `${pageHero("Collaborazioni","Rete sportiva e territoriale","Una pagina per valorizzare collaborazioni con università, partner, realtà sportive, istituzioni e community locali.")}
      <section class="cus-rework-section"><div class="container"><div class="cus-rework-grid three">
        ${["Università e CUS","Partner territoriali","Community e iniziative"].map((x,i)=>`<article class="cus-rework-card cus-rework-card-pad"><h3>${h(x)}</h3><p>${h(["Collaborazioni collegate al mondo universitario e allo sport CUS.","Relazioni con aziende e professionisti che sostengono il progetto.","Attività, eventi e progetti aperti a studenti, famiglie e territorio."][i])}</p></article>`).join("")}
      </div></div></section>`;
    setApp(html,"collaborations","Collaborazioni","Collaborazioni del CUS Trento C5.",replace);
  }

  function renderPartnerExact(replace){
    window.__cusActiveRoute = "partner";
    if(oldRoute) oldRoute("sponsor");
    setTimeout(() => {
      history.replaceState({route:"partner"},"",pathByRoute.partner);
      seo("Partner","I nostri partner del CUS Trento C5.",pathByRoute.partner);
      injectStandardHero("partner");
      renderCusMenu();
    }, 0);
  }

  function renderClubProject(replace){
    window.__cusActiveRoute = "club-project";
    if(oldRoute) oldRoute("club");
    setTimeout(() => {
      history.replaceState({route:"club-project"},"",pathByRoute["club-project"]);
      seo("Chi siamo / Il progetto","Il progetto sportivo e societario del CUS Trento C5.",pathByRoute["club-project"]);
      injectStandardHero("club-project");
      renderCusMenu();
    }, 0);
  }

  function routeFromLocation(){
    let path = location.pathname.replace(/\/+/g,"/");
    if(path !== "/" && !path.endsWith("/")) path += "/";
    if(path.startsWith("/eventi/") && path !== "/eventi/"){
      return "event-detail:" + path.split("/").filter(Boolean).slice(1).join("/");
    }
    if(path.startsWith("/news/") && path !== "/news/"){
      return "article-" + path.split("/").filter(Boolean).slice(1).join("/");
    }
    const route = pathToRoute[path];
    if(route === "events" && location.hash){
      const hash = location.hash.replace("#","");
      if(hash === "tornei") return "events:tournaments";
      if(hash === "open-day-tryout") return "events:tryout";
      if(hash === "eventi-partner") return "events:partner";
      if(hash === "archivio-eventi") return "events:archive";
      return "events:upcoming";
    }
    return route || null;
  }

  function renderCustom(routeId, replace){
    if(routeId === "teams-overview") return renderTeamsOverview(replace);
    if(routeId === "play-with-us") return renderPlayWithUs(replace);
    if(String(routeId).startsWith("events")) return renderEvents(routeId, replace);
    if(String(routeId).startsWith("event-detail:")) return renderEventDetail(routeId, replace);
    if(routeId === "cnu") return renderCnu(replace);
    if(routeId === "season-archive") return renderSeasonArchive(replace);
    if(routeId === "partner") return renderPartnerExact(replace);
    if(routeId === "become-partner") return renderBecomePartner(replace);
    if(routeId === "club-project") return renderClubProject(replace);
    if(routeId === "club-history") return renderClubHistory(replace);
    if(routeId === "venue") return renderVenue(replace);
    if(routeId === "values") return renderValues(replace);
    if(routeId === "collaborations") return renderCollaborations(replace);
  }

  function normalizeAlias(routeId){
    if(routeId === "sponsor") return "partner";
    if(routeId === "club") return "club-project";
    return routeId;
  }

  window.cusMenuRoute = function(routeId){
    routeId = normalizeAlias(routeId);
    if(isCustomRoute(routeId)) return renderCustom(routeId, false);
    window.__cusActiveRoute = routeId;
    if(oldRoute) oldRoute(routeId);
    afterOldRoute(routeId);
  };

  window.route = function(routeId){
    routeId = normalizeAlias(routeId);
    if(isCustomRoute(routeId)) return renderCustom(routeId, false);
    window.__cusActiveRoute = routeId || "home";
    if(oldRoute) oldRoute(routeId);
    afterOldRoute(routeId || "home");
  };

  window.addEventListener("popstate", () => {
    const custom = routeFromLocation();
    if(custom && isCustomRoute(custom)) renderCustom(custom, true);
    else {
      const routeId = custom || routeFromLocation() || "home";
      window.__cusActiveRoute = routeId;
      if(oldRoute) oldRoute(routeId);
      afterOldRoute(routeId);
    }
  });

  function boot(){
    renderCusMenu();
    const currentRoute = routeFromLocation();
    if(currentRoute && isCustomRoute(currentRoute)) renderCustom(currentRoute, true);
    else afterOldRoute(currentRoute || window.__cusActiveRoute || "home");
  }

  const navObserver = new MutationObserver(() => {
    const nav = document.getElementById("navGroups");
    if(nav && nav.dataset.cusRework !== "true") renderCusMenu();
  });

  function observeNav(){
    const nav = document.getElementById("navGroups");
    if(nav) navObserver.observe(nav,{childList:true,subtree:true});
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => {boot();observeNav();});
  }else{
    boot();observeNav();
  }

  setTimeout(boot,80);
  setTimeout(boot,350);
  setTimeout(boot,1000);
  window.__cusMenuVersion = MENU_VERSION;
})();
