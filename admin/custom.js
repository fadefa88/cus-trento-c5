/*
  CUS Trento C5 CMS custom layer.

  ID e slug non vengono mostrati nei form del CMS: vengono preservati se già presenti
  e generati automaticamente al salvataggio per ogni nuovo oggetto.
  Lo slug serve per creare URL/pagine SEO-friendly.

  Nota tecnica: Decap CMS passa i dati come strutture Immutable in alcune viste e
  come oggetti JS in altre. Questo file deve preservare lo stesso tipo ricevuto,
  senza inserire array/oggetti plain dentro strutture Immutable, altrimenti il CMS
  può fallire in salvataggio con errori tipo `.toJS is not a function`.

  Le regole di ID/slug (campi per collection, algoritmo) sono quelle del sito:
  arrivano da /js/site-core.js, caricato prima di questo file in admin/index.html.
*/
(function(){
  const SITE = window.CUS_SITE;
  if(!SITE) throw new Error("CUS Trento CMS: /js/site-core.js non caricato prima di admin/custom.js");

  function isObject(value){
    return value && typeof value === "object";
  }

  function isImmutable(value){
    return isObject(value) && typeof value.get === "function" && typeof value.set === "function";
  }

  function isListLike(value){
    return Array.isArray(value) || (isObject(value) && typeof value.map === "function" && typeof value.toJS === "function");
  }

  function toPlain(value){
    return value && typeof value.toJS === "function" ? value.toJS() : value;
  }

  function getValue(target, key){
    if(!target) return undefined;
    if(typeof target.get === "function") return target.get(key);
    return target[key];
  }

  function setValue(target, key, value){
    if(!target) return target;
    if(typeof target.set === "function") return target.set(key, value);
    if(typeof target === "object") return {...target, [key]: value};
    return target;
  }

  function ensureIdsAndSlugs(items, fields){
    if(!isListLike(items)) return items;

    const plainItems = toPlain(items);
    if(!Array.isArray(plainItems)) return items;

    const computed = SITE.computeIdsAndSlugs(plainItems, fields);
    const applyComputed = (item, index) => {
      const next = computed[index];
      if(!next || next.id == null || !isObject(item)) return item;
      return setValue(setValue(item, "id", next.id), "slug", next.slug);
    };

    if(Array.isArray(items)) return items.map(applyComputed);
    return items.map(applyComputed);
  }

  function validateNewsDates(raw){
    if(!raw || !Array.isArray(raw.news)) return;
    const missing = raw.news
      .map((item, index) => ({item, index}))
      .filter(({item}) => item && typeof item === "object" && !String(item.date || "").trim());
    if(!missing.length) return;

    const names = missing.slice(0, 5).map(({item, index}) => item.title || item.name || `News #${index + 1}`).join(", ");
    const extra = missing.length > 5 ? ` e altre ${missing.length - 5}` : "";
    const message = `La data è obbligatoria per ogni news. Compila il campo Data per: ${names}${extra}.`;
    if(typeof window !== "undefined" && typeof window.alert === "function") window.alert(message);
    throw new Error(message);
  }

  function validateU21StartingFive(raw){
    if(!raw || !Array.isArray(raw.u21Fixtures)) return;

    const invalid = raw.u21Fixtures
      .map((match, index) => ({match, index}))
      .filter(({match}) => {
        if(!match || typeof match !== "object") return false;
        const status = String(match.status || "").trim().toLowerCase();
        if(status !== "terminata") return false;
        const startingFive = match.lineup && match.lineup.startingFive;
        return !Array.isArray(startingFive) || startingFive.length !== 5;
      });

    if(!invalid.length) return;

    const names = invalid.slice(0, 5).map(({match, index}) => {
      const teams = [match.home, match.away].filter(Boolean).join(" vs ");
      return teams || `Partita U23 #${index + 1}`;
    }).join(", ");
    const extra = invalid.length > 5 ? ` e altre ${invalid.length - 5}` : "";
    const message = `Per una partita U23 terminata devi selezionare esattamente 5 giocatori nel quintetto titolare. Controlla: ${names}${extra}.`;
    if(typeof window !== "undefined" && typeof window.alert === "function") window.alert(message);
    throw new Error(message);
  }

  function addAutomaticIdsAndSlugs(data){
    if(!data) return data;
    const raw = toPlain(data) || {};
    validateNewsDates(raw);
    validateU21StartingFive(raw);

    let nextData = data;

    Object.entries(SITE.config.collections).forEach(([key, def]) => {
      const currentList = getValue(nextData, key);
      if(isListLike(currentList)){
        nextData = setValue(nextData, key, ensureIdsAndSlugs(currentList, def.slugFields));
      }
    });

    SITE.config.nestedSlugLists.forEach(({object, list, slugFields}) => {
      const parent = getValue(nextData, object);
      const nested = getValue(parent, list);
      if(isListLike(nested)){
        nextData = setValue(nextData, object, setValue(parent, list, ensureIdsAndSlugs(nested, slugFields)));
      }
    });

    return nextData;
  }

  function getEntryData(entry){
    if(!entry) return null;
    if(typeof entry.getIn === "function") return entry.getIn(["data"]);
    if(typeof entry.get === "function") return entry.get("data");
    return entry.data || null;
  }

  function registerAutomaticIdsAndSlugs(){
    if(!window.CMS || typeof window.CMS.registerEventListener !== "function") return;
    window.CMS.registerEventListener({
      name: "preSave",
      handler: ({ entry }) => {
        const data = getEntryData(entry);
        return data ? addAutomaticIdsAndSlugs(data) : data;
      }
    });
  }

  registerAutomaticIdsAndSlugs();
  console.info("CUS Trento C5 CMS loaded: ID e slug nascosti, generati automaticamente; salvataggio compatibile con Decap Immutable/JS.");
})();

/* Match center: reti e tempi esatti dei gol solo per la Prima squadra. */
(function(){
  if(!window.CMS || typeof window.CMS.init !== "function" || window.__cusMatchCenterSchemaWrapped) return;
  window.__cusMatchCenterSchemaWrapped = true;

  const originalInit = window.CMS.init;

  function collectionMatchFields(config, collectionName){
    const collections = config && config.collections;
    if(!Array.isArray(collections)) return null;
    const collection = collections.find(item => item && item.name === collectionName);
    const file = collection && Array.isArray(collection.files) && collection.files[0];
    const listField = file && Array.isArray(file.fields) && file.fields.find(field => field && field.name === collectionName);
    return listField && Array.isArray(listField.fields) ? listField.fields : null;
  }

  function namedField(fields, name){
    return Array.isArray(fields) ? fields.find(field => field && field.name === name) : null;
  }

  function singleGoalTimeField(){
    return {
      label: "Tempo del gol (opzionale)",
      name: "minute",
      widget: "string",
      required: false,
      hint: "Per una sola rete puoi scrivere direttamente il tempo, ad esempio 13’12” pt o 15’27” st. Lascia vuoto se non conosci il minuto."
    };
  }

  function goalTimesField(){
    return {
      label: "Tempi dei gol (opzionale)",
      name: "goalTimes",
      widget: "list",
      required: false,
      collapsed: false,
      summary: "{{fields.time}}",
      hint: "Se il marcatore ha segnato più reti puoi inserire un tempo per ogni gol. Esempi: 13’12” pt, 15’27” st. Se non conosci i tempi lascia vuoto: verrà mostrato solo il nome e il numero di reti.",
      fields:[
        {
          label: "Tempo",
          name: "time",
          widget: "string",
          required: false,
          hint: "Formato consigliato: 13’12” pt oppure 15’27” st."
        }
      ]
    };
  }

  function goalsField(){
    return {
      label: "Reti",
      name: "goals",
      widget: "number",
      value_type: "int",
      default: 1,
      min: 1,
      required: true,
      hint: "Numero totale di reti segnate da questo marcatore nella partita."
    };
  }

  function addFirstTeamScorerFields(config){
    const fields = collectionMatchFields(config, "fixtures");
    const scorers = namedField(fields, "scorerEvents");
    if(!scorers || !Array.isArray(scorers.fields)) return;

    const goals = namedField(scorers.fields, "goals");
    if(goals) Object.assign(goals, goalsField());
    else scorers.fields.push(goalsField());

    const minute = namedField(scorers.fields, "minute");
    if(minute) Object.assign(minute, singleGoalTimeField());
    else scorers.fields.push(singleGoalTimeField());

    const goalTimes = namedField(scorers.fields, "goalTimes");
    if(goalTimes) Object.assign(goalTimes, goalTimesField());
    else scorers.fields.push(goalTimesField());

    scorers.summary = "{{fields.playerId}} — {{fields.goals}} gol";
    scorers.hint = "Scegli il marcatore, indica quante reti ha segnato e, se vuoi, inserisci il tempo di ciascun gol. I tempi sono facoltativi e non cambiano le statistiche: il conteggio ufficiale resta il campo Reti.";
  }

  function opponentScorerField(){
    return {
      label:"Marcatori avversari (solo visualizzazione)",
      name:"opponentScorerEvents",
      widget:"list",
      required:false,
      collapsed:true,
      summary:"{{fields.name}} — {{fields.goals}} gol",
      hint:"Placeholder della singola partita della Prima squadra: nome, numero di reti e tempi vengono mostrati solo nel match center e non modificano statistiche, storico marcatori o dati giocatore.",
      fields:[
        {label:"Nome marcatore avversario", name:"name", widget:"string"},
        goalsField(),
        singleGoalTimeField(),
        goalTimesField()
      ]
    };
  }

  function addOpponentScorers(config){
    const fields = collectionMatchFields(config, "fixtures");
    if(!fields) return;
    const existing = namedField(fields, "opponentScorerEvents");
    if(existing){
      Object.assign(existing, opponentScorerField());
      return;
    }
    const scorerIndex = fields.findIndex(field => field && field.name === "scorerEvents");
    fields.splice(scorerIndex >= 0 ? scorerIndex + 1 : fields.length, 0, opponentScorerField());
  }

  function opponentLineupField(){
    return {
      label:"Convocati avversari (solo visualizzazione)",
      name:"opponentLineup",
      widget:"list",
      required:false,
      collapsed:true,
      summary:"#{{fields.number}} {{fields.surname}} {{fields.firstName}}",
      hint:"Giocatori della squadra avversaria, mostrati nella colonna dei convocati del match center. Non modificano statistiche, storico marcatori o dati giocatore. Se inserisci qui i gol, il tabellino usa questi al posto dei Marcatori avversari.",
      fields:[
        {label:"Numero", name:"number", widget:"string", required:false},
        {label:"Cognome", name:"surname", widget:"string"},
        {label:"Nome", name:"firstName", widget:"string", required:false},
        Object.assign(goalsField(), {default:0, min:0, required:false, hint:"Reti segnate in questa partita (0 se nessuna)."}),
        singleGoalTimeField(),
        goalTimesField(),
        {label:"Ammonito", name:"yellow", widget:"boolean", default:false, required:false},
        {label:"Espulso", name:"red", widget:"boolean", default:false, required:false}
      ]
    };
  }

  function addOpponentLineup(config){
    const fields = collectionMatchFields(config, "fixtures");
    if(!fields) return;
    const existing = namedField(fields, "opponentLineup");
    if(existing){
      Object.assign(existing, opponentLineupField());
      return;
    }
    const lineupIndex = fields.findIndex(field => field && field.name === "lineup");
    fields.splice(lineupIndex >= 0 ? lineupIndex + 1 : fields.length, 0, opponentLineupField());
  }

  function augmentMatchSchema(options){
    if(!options || !options.config) return;
    addFirstTeamScorerFields(options.config);
    addOpponentScorers(options.config);
    addOpponentLineup(options.config);
  }

  window.CMS.init = function(options){
    augmentMatchSchema(options);
    return originalInit.apply(this, arguments);
  };
})();