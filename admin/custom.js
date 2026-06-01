/* CUS Trento C5 — Decap CMS validation + safe merge helpers */
(function(){
  function asJS(value){
    if(!value) return value;
    if(typeof value.toJS === "function") return value.toJS();
    return value;
  }

  function arr(v){
    return Array.isArray(v) ? v : (v ? [v] : []);
  }

  function norm(v){
    return String(v || "").trim();
  }

  function slug(v){
    return norm(v).toLowerCase().replace(/_/g," ").replace(/-/g," ").replace(/\s+/g," ");
  }

  function labelOf(id){
    return id ? `giocatore ID ${id}` : "giocatore non selezionato";
  }

  function findDuplicates(list){
    return list.filter((id, idx) => list.indexOf(id) !== idx);
  }

  function normalizeStatus(value){
    const s = slug(value);
    if(!s || s === "da giocare" || s === "dagiocare" || s === "to play" || s === "scheduled") return "Da giocare";
    if(s === "terminata" || s === "finita" || s === "finished" || s === "played") return "Terminata";
    return norm(value) || "Da giocare";
  }

  function normalizeCompetition(value){
    const s = slug(value);
    if(s === "coppa") return "Coppa";
    if(s === "playoff" || s === "play off") return "Playoff";
    return norm(value) || "Campionato";
  }

  function normalizeMatch(match){
    if(!match || typeof match !== "object") return match;
    const out = Object.assign({}, match);
    out.status = normalizeStatus(out.status);
    out.competition = normalizeCompetition(out.competition);

    if(out.id !== undefined && out.id !== null && out.id !== "") out.id = Number(out.id);

    if(out.lineup && typeof out.lineup === "object"){
      out.lineup = Object.assign({}, out.lineup);
      ["startingFive","bench","suspended","injured"].forEach(function(key){
        out.lineup[key] = arr(out.lineup[key]).map(function(v){ return String(v); }).filter(Boolean);
      });
    }

    ["scorerEvents","yellowCardEvents","redCardEvents","goalkeeperEvents"].forEach(function(key){
      if(Array.isArray(out[key])){
        out[key] = out[key].map(function(ev){
          const clean = Object.assign({}, ev || {});
          if(clean.playerId !== undefined && clean.playerId !== null) clean.playerId = String(clean.playerId);
          ["goals","cards","goalsAgainst","minutes","appearances"].forEach(function(n){
            if(clean[n] !== undefined && clean[n] !== null && clean[n] !== "") clean[n] = Number(clean[n]);
          });
          return clean;
        });
      }
    });

    return out;
  }

  function unwrapData(value){
    let data = asJS(value) || {};

    // Protezione se nel file viene incollato/salvato per errore un wrapper con raw/data.
    if(data && typeof data.raw === "string"){
      try{
        const parsed = JSON.parse(data.raw);
        if(parsed && typeof parsed === "object") return parsed;
      }catch(e){
        console.warn("Impossibile leggere data.raw come JSON", e);
      }
    }

    if(data && data.path === "content/data.json" && data.data && typeof data.data === "object"){
      return data.data;
    }

    return data;
  }

  function normalizeData(data){
    const out = Object.assign({}, unwrapData(data));

    if(Array.isArray(out.fixtures)) out.fixtures = out.fixtures.map(normalizeMatch);
    if(Array.isArray(out.u21Fixtures)) out.u21Fixtures = out.u21Fixtures.map(normalizeMatch);

    if(out.cup && typeof out.cup === "object"){
      out.cup = Object.assign({}, out.cup);
      if(Array.isArray(out.cup.fixtures)) out.cup.fixtures = out.cup.fixtures.map(normalizeMatch);
    }

    if(out.u21Cup && typeof out.u21Cup === "object"){
      out.u21Cup = Object.assign({}, out.u21Cup);
      if(Array.isArray(out.u21Cup.fixtures)) out.u21Cup.fixtures = out.u21Cup.fixtures.map(normalizeMatch);
    }

    return out;
  }

  function mergeTopLevel(current, changed){
    const base = (current && typeof current === "object") ? Object.assign({}, current) : {};
    const patch = normalizeData(changed || {});
    Object.keys(patch).forEach(function(key){
      base[key] = patch[key];
    });
    return normalizeData(base);
  }

  async function fetchCurrentData(){
    try{
      const res = await fetch("/content/data.json?cms-presave=" + Date.now(), {cache:"no-store"});
      if(!res.ok) return {};
      const json = await res.json();
      return normalizeData(json);
    }catch(e){
      console.warn("CMS safe merge: content/data.json corrente non letto, salvo solo i dati CMS disponibili.", e);
      return {};
    }
  }

  function checkMatch(match, path, errors){
    if(!match || typeof match !== "object") return;

    const status = normalizeStatus(match.status);
    if(status && !["Da giocare","Terminata"].includes(status)){
      errors.push(`${path}: lo stato gara può essere solo "Da giocare" o "Terminata".`);
    }

    const lineup = match.lineup || {};
    const starting = arr(lineup.startingFive).map(norm).filter(Boolean);
    const bench = arr(lineup.bench).map(norm).filter(Boolean);

    /*
      Regola richiesta:
      - quintetto vuoto = OK
      - quintetto con esattamente 5 giocatori = OK
      - quintetto con 1, 2, 3, 4 o più di 5 giocatori = ERRORE
    */
    if(starting.length > 0 && starting.length !== 5){
      errors.push(`${path}: il quintetto titolare deve essere vuoto oppure avere esattamente 5 giocatori.`);
    }

    const selected = new Set();

    const duplicateInStarting = findDuplicates(starting);
    const duplicateInBench = findDuplicates(bench);

    duplicateInStarting.forEach(id => {
      errors.push(`${path}: ${labelOf(id)} è duplicato nel quintetto.`);
    });

    duplicateInBench.forEach(id => {
      errors.push(`${path}: ${labelOf(id)} è duplicato in panchina.`);
    });

    starting.forEach(id => selected.add(id));

    bench.forEach(id => {
      if(selected.has(id)){
        errors.push(`${path}: ${labelOf(id)} è presente sia nel quintetto sia in panchina.`);
      }
      selected.add(id);
    });

    function checkSelectedEvents(events, label){
      arr(events).forEach((ev, idx) => {
        const playerId = norm(ev && ev.playerId);

        if(playerId && !selected.has(playerId)){
          errors.push(`${path}: ${label} #${idx+1} (${labelOf(playerId)}) non è presente tra quintetto o panchina.`);
        }
      });
    }

    checkSelectedEvents(match.scorerEvents, "marcatore");
    checkSelectedEvents(match.yellowCardEvents, "ammonito");
    checkSelectedEvents(match.redCardEvents, "espulso");
    checkSelectedEvents(match.goalkeeperEvents, "portiere con gol subiti");
  }

  function validateData(data){
    const clean = normalizeData(data || {});
    const errors = [];

    arr(clean.fixtures).forEach((m,i) => {
      checkMatch(m, `Calendario Prima squadra, partita ${i+1}`, errors);
    });

    arr(clean.u21Fixtures).forEach((m,i) => {
      checkMatch(m, `Calendario Under 21, partita ${i+1}`, errors);
    });

    arr(clean.cup && clean.cup.fixtures).forEach((m,i) => {
      checkMatch(m, `Coppa Prima squadra, partita ${i+1}`, errors);
    });

    arr(clean.u21Cup && clean.u21Cup.fixtures).forEach((m,i) => {
      checkMatch(m, `Coppa Under 21, partita ${i+1}`, errors);
    });

    return errors;
  }

  function immutableFromJS(value){
    if(window.Immutable && typeof window.Immutable.fromJS === "function") return window.Immutable.fromJS(value);
    if(window.immutable && typeof window.immutable.fromJS === "function") return window.immutable.fromJS(value);
    return value;
  }

  function register(){
    if(!window.CMS || typeof window.CMS.registerEventListener !== "function") return false;

    window.CMS.registerEventListener({
      name: "preSave",
      handler: async function(payload){
        const entry = payload && payload.entry;
        const incoming = unwrapData(entry && entry.get ? entry.get("data") : (entry && entry.data));
        const current = await fetchCurrentData();
        const merged = mergeTopLevel(current, incoming);
        const errors = validateData(merged || {});

        if(errors.length){
          alert("Correggi questi dati prima di salvare:\n\n" + errors.join("\n"));
          throw new Error(errors.join(" | "));
        }

        if(entry && typeof entry.set === "function"){
          return entry.set("data", immutableFromJS(merged));
        }

        if(entry) entry.data = merged;
        return entry;
      }
    });

    return true;
  }

  if(!register()){
    const timer = setInterval(function(){
      if(register()) clearInterval(timer);
    }, 300);

    setTimeout(function(){
      clearInterval(timer);
    }, 10000);
  }
})();
