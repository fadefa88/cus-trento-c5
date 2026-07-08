/*
  CUS Trento C5 CMS custom layer.

  ID e slug non vengono mostrati nei form del CMS: vengono preservati se già presenti
  e generati automaticamente al salvataggio per ogni nuovo oggetto.
  Lo slug serve per creare URL/pagine SEO-friendly.
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

  function ensureIdsAndSlugs(items, fields){
    if(!Array.isArray(items)) return items;
    const usedIds = new Set();
    const usedSlugs = new Set();
    return items.map((item) => {
      if(!item || typeof item !== "object") return item;
      const next = {...item};

      const currentId = String(next.id || "").trim();
      if(currentId && !usedIds.has(currentId)) usedIds.add(currentId);
      else next.id = uniqueValue(currentId || baseValue(next, fields), usedIds);

      const currentSlug = String(next.slug || "").trim();
      next.slug = uniqueValue(currentSlug || baseValue(next, fields), usedSlugs);
      return next;
    });
  }

  function ensureClubHistoryImageSlugs(data){
    const raw = data && typeof data.toJS === "function" ? data.toJS() : data;
    if(!raw || !raw.clubHistory || !Array.isArray(raw.clubHistory.images)) return data;
    const next = {...raw, clubHistory:{...raw.clubHistory}};
    next.clubHistory.images = ensureIdsAndSlugs(next.clubHistory.images, ["season"]);
    return toCmsValue(next);
  }

  function toPlain(value){
    return value && typeof value.toJS === "function" ? value.toJS() : value;
  }

  function toCmsValue(value){
    const immutable = window.Immutable || (window.CMS && window.CMS.Immutable);
    return immutable && typeof immutable.fromJS === "function" ? immutable.fromJS(value) : value;
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
    if(!data || typeof data.set !== "function") return data;
    const raw = toPlain(data) || {};
    validateNewsDates(raw);
    let nextData = data;

    Object.keys(AUTO_OBJECT_FIELDS).forEach((key) => {
      if(Array.isArray(raw[key])){
        const withIdsAndSlugs = ensureIdsAndSlugs(raw[key], AUTO_OBJECT_FIELDS[key]);
        nextData = nextData.set(key, toCmsValue(withIdsAndSlugs));
      }
    });

    return ensureClubHistoryImageSlugs(nextData);
  }

  function registerAutomaticIdsAndSlugs(){
    if(!window.CMS || typeof window.CMS.registerEventListener !== "function") return;
    window.CMS.registerEventListener({
      name: "preSave",
      handler: ({ entry }) => {
        const data = entry && typeof entry.get === "function" ? entry.get("data") : null;
        return addAutomaticIdsAndSlugs(data);
      }
    });
  }

  registerAutomaticIdsAndSlugs();
  console.info("CUS Trento C5 CMS loaded: ID e slug nascosti, generati automaticamente; pagine statiche abilitate in build.");
})();
