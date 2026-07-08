/*
  CUS Trento C5 CMS custom layer.

  ID e slug non vengono mostrati nei form del CMS: vengono preservati se già presenti
  e generati automaticamente al salvataggio per ogni nuovo oggetto.
  Lo slug serve per creare URL/pagine SEO-friendly.

  Nota tecnica: Decap CMS passa i dati come strutture Immutable in alcune viste e
  come oggetti JS in altre. Questo file deve preservare lo stesso tipo ricevuto,
  senza inserire array/oggetti plain dentro strutture Immutable, altrimenti il CMS
  può fallire in salvataggio con errori tipo `.toJS is not a function`.
*/
(function(){
  const AUTO_OBJECT_FIELDS = {
    news: ["title", "date"],
    roster: ["name"],
    fixtures: ["home", "away", "date"],
    u21Fixtures: ["home", "away", "date"],
    galleryAlbums: ["title", "season", "date"],
    sponsors: ["name"],
    sponsorPackages: ["name"],
    staff: ["name", "role"],
    videos: ["title"],
    events: ["title", "date"]
  };

  function slugify(value){
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 86)
      .replace(/-$/g, "") || "item";
  }

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

  function baseValue(item, fields){
    const direct = fields.map(field => item && item[field]).filter(Boolean).join(" ");
    if(direct) return direct;
    return item && (item.name || item.title || item.home || item.away || item.date || item.season) || "item";
  }

  function uniqueValue(base, used){
    const root = slugify(base);
    let candidate = root;
    let n = 2;
    while(used.has(String(candidate))){
      candidate = `${root}-${n}`;
      n += 1;
    }
    used.add(String(candidate));
    return candidate;
  }

  function computeIdsAndSlugs(items, fields){
    const usedIds = new Set();
    const usedSlugs = new Set();
    return items.map((item) => {
      if(!item || typeof item !== "object") return {id: null, slug: null};

      const currentId = String(item.id || "").trim();
      const id = currentId && !usedIds.has(currentId)
        ? (usedIds.add(currentId), currentId)
        : uniqueValue(currentId || baseValue(item, fields), usedIds);

      const currentSlug = String(item.slug || "").trim();
      const slug = uniqueValue(currentSlug || baseValue(item, fields), usedSlugs);

      return {id, slug};
    });
  }

  function ensureIdsAndSlugs(items, fields){
    if(!isListLike(items)) return items;

    const plainItems = toPlain(items);
    if(!Array.isArray(plainItems)) return items;

    const computed = computeIdsAndSlugs(plainItems, fields);
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

  function addAutomaticIdsAndSlugs(data){
    if(!data) return data;
    const raw = toPlain(data) || {};
    validateNewsDates(raw);

    let nextData = data;

    Object.keys(AUTO_OBJECT_FIELDS).forEach((key) => {
      const currentList = getValue(nextData, key);
      if(isListLike(currentList)){
        nextData = setValue(nextData, key, ensureIdsAndSlugs(currentList, AUTO_OBJECT_FIELDS[key]));
      }
    });

    const clubHistory = getValue(nextData, "clubHistory");
    const images = getValue(clubHistory, "images");
    if(isListLike(images)){
      const nextClubHistory = setValue(clubHistory, "images", ensureIdsAndSlugs(images, ["season"]));
      nextData = setValue(nextData, "clubHistory", nextClubHistory);
    }

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
