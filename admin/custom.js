/* CUS Trento C5 — Decap CMS validation helpers */
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

  function labelOf(id){
    return id ? `giocatore ID ${id}` : "giocatore non selezionato";
  }

  function findDuplicates(list){
    return list.filter((id, idx) => list.indexOf(id) !== idx);
  }

  function checkMatch(match, path, errors){
    if(!match || typeof match !== "object") return;

    if(match.status && !["Da giocare","Terminata"].includes(match.status)){
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
    const errors = [];

    arr(data.fixtures).forEach((m,i) => {
      checkMatch(m, `Calendario Prima squadra, partita ${i+1}`, errors);
    });

    arr(data.u21Fixtures).forEach((m,i) => {
      checkMatch(m, `Calendario Under 21, partita ${i+1}`, errors);
    });

    arr(data.cup && data.cup.fixtures).forEach((m,i) => {
      checkMatch(m, `Coppa Prima squadra, partita ${i+1}`, errors);
    });

    arr(data.u21Cup && data.u21Cup.fixtures).forEach((m,i) => {
      checkMatch(m, `Coppa Under 21, partita ${i+1}`, errors);
    });

    return errors;
  }

  function register(){
    if(!window.CMS || typeof window.CMS.registerEventListener !== "function") return false;

    window.CMS.registerEventListener({
      name: "preSave",
      handler: function(payload){
        const entry = payload && payload.entry;
        const data = asJS(entry && entry.get ? entry.get("data") : (entry && entry.data));
        const errors = validateData(data || {});

        if(errors.length){
          alert("Correggi questi dati prima di salvare:\n\n" + errors.join("\n"));
          throw new Error(errors.join(" | "));
        }

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
