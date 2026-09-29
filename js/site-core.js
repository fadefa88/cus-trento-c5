/*
  CUS Trento C5 — shared site rules (single source of truth).

  Loaded by the public site (before app.js) and by the Decap CMS admin
  (before admin/custom.js). The JSON between the SITE-CONFIG markers is also
  parsed by scripts/site_data.py, so it must stay strict JSON: double quotes,
  no comments, no trailing commas.

  Owns: public routes and their prerender metadata, CMS collections with their
  slug fields and URL bases, the slug algorithm, hidden news, route aliases.
  scripts/check_site_consistency.py verifies that the Python port of the slug
  rules (scripts/site_data.py) produces the same URLs as this file.
*/
(function(root){
  const CONFIG = /*SITE-CONFIG-START*/{
    "siteUrl": "https://calcioa5.custrento.it",
    "slug": {"maxLength": 86, "fallback": "news"},
    "collections": {
      "news": {"slugFields": ["title", "date"], "urlBase": "/news/", "routePrefix": "article-"},
      "roster": {"slugFields": ["name"], "urlBase": "/squadra/", "routePrefix": "player-", "breadcrumb": ["/squadra/", "Rosa"]},
      "fixtures": {"slugFields": ["home", "away", "date"], "urlBase": "/calendario/", "routePrefix": "match-", "breadcrumb": ["/calendario/", "Calendario"]},
      "u21Fixtures": {"slugFields": ["home", "away", "date"], "urlBase": "/under-21/calendario/", "routePrefix": "match-", "breadcrumb": ["/calendario/", "Calendario"]},
      "galleryAlbums": {"slugFields": ["title", "season", "date"], "urlBase": "/gallery/", "routePrefix": "gallery-album-", "breadcrumb": ["/gallery/", "Gallery"]},
      "sponsors": {"slugFields": ["name"], "urlBase": "/partner/", "routePrefix": "sponsor-detail-", "breadcrumb": ["/partner/", "Partner"]},
      "sponsorPackages": {"slugFields": ["name"], "urlBase": "/diventa-partner/", "routePrefix": "package-detail-", "breadcrumb": ["/diventa-partner/", "Diventa partner"]},
      "staff": {"slugFields": ["name", "role"], "urlBase": "/staff/", "routePrefix": "staff-detail-", "breadcrumb": ["/staff/", "Staff"]},
      "videos": {"slugFields": ["title"], "urlBase": "/video/", "routePrefix": "video-detail-", "breadcrumb": ["/video/", "Video"]},
      "events": {"slugFields": ["title", "date"], "urlBase": "/eventi/", "routePrefix": "event-detail:", "breadcrumb": ["/eventi/", "Eventi"]}
    },
    "nestedSlugLists": [
      {"object": "clubHistory", "list": "images", "slugFields": ["season"]}
    ],
    "pages": [
      {"route": "news", "path": "/news/", "title": "News CUS Trento C5", "description": "News, match report e storie ufficiali dal CUS Trento Calcio a 5.", "heading": "News, match report e storie dal club", "eyebrow": "Media center"},
      {"route": "squad", "path": "/squadra/", "title": "Rosa CUS Trento C5", "description": "Rosa della prima squadra e dell'Under 23 del CUS Trento Calcio a 5.", "heading": "Rosa", "eyebrow": "Team"},
      {"route": "staff", "path": "/staff/", "title": "Staff tecnico CUS Trento C5", "description": "Staff tecnico e dirigenziale del CUS Trento Calcio a 5.", "heading": "Staff tecnico", "eyebrow": "Club"},
      {"route": "fixtures", "path": "/calendario/", "title": "Calendario CUS Trento C5", "description": "Calendario, risultati e partite del CUS Trento Calcio a 5.", "heading": "Calendario e risultati", "eyebrow": "Stagione"},
      {"route": "standings", "path": "/classifica/", "title": "Classifica CUS Trento C5", "description": "Classifica aggiornata della stagione del CUS Trento Calcio a 5.", "heading": "Classifica", "eyebrow": "Stagione"},
      {"route": "stats", "path": "/statistiche/", "title": "Statistiche CUS Trento C5", "description": "Statistiche giocatori, marcatori e andamento del CUS Trento Calcio a 5.", "heading": "Statistiche", "eyebrow": "Data room"},
      {"route": "coppa", "path": "/coppa/", "title": "Coppa CUS Trento C5", "description": "Percorso, calendario e risultati di Coppa del CUS Trento Calcio a 5.", "heading": "Coppa", "eyebrow": "Stagione"},
      {"route": "gallery", "path": "/gallery/", "title": "Gallery CUS Trento C5", "description": "Foto, album e contenuti multimediali del CUS Trento Calcio a 5.", "heading": "Gallery", "eyebrow": "Media"},
      {"route": "video", "path": "/video/", "title": "Video CUS Trento C5", "description": "Video ufficiali e contenuti multimediali del CUS Trento Calcio a 5.", "heading": "Video", "eyebrow": "Media"},
      {"route": "social", "path": "/social/", "title": "Social wall CUS Trento C5", "description": "Ultimi contenuti social Instagram e TikTok del CUS Trento C5.", "heading": "Social wall", "eyebrow": "Community"},
      {"route": "club-project", "path": "/club/", "title": "Club CUS Trento C5", "description": "Storia e progetto sportivo del CUS Trento Calcio a 5.", "heading": "Chi siamo", "eyebrow": "Club"},
      {"route": "records", "path": "/hall-of-fame/", "title": "Hall of fame CUS Trento C5", "description": "Record storici, presenze e marcatori del CUS Trento Calcio a 5.", "heading": "Hall of fame", "eyebrow": "Records"},
      {"route": "contacts", "path": "/contatti/", "title": "Contatti CUS Trento C5", "description": "Contatti ufficiali del CUS Trento Calcio a 5.", "heading": "Contatti", "eyebrow": "Club"},
      {"route": "u21", "path": "/under-21/", "title": "Under 21 CUS Trento C5", "description": "Sezione Under 21 del CUS Trento Calcio a 5.", "heading": "Under 21", "eyebrow": "Team"},
      {"route": "teams-overview", "path": "/squadre/", "title": "Squadre CUS Trento C5", "description": "Prima squadra e Under 23 del CUS Trento C5.", "heading": "Squadre", "eyebrow": "Team"},
      {"route": "play-with-us", "path": "/gioca-con-noi/", "title": "Gioca con noi CUS Trento C5", "description": "Candidature e informazioni per giocare nel CUS Trento C5.", "heading": "Gioca con noi", "eyebrow": "Squadre"},
      {"route": "cnu", "path": "/cnu/", "title": "CNU CUS Trento C5", "description": "Campionati Nazionali Universitari del CUS Trento C5.", "heading": "CNU", "eyebrow": "Stagione"},
      {"route": "season-archive", "path": "/archivio-stagioni/", "title": "Archivio stagioni CUS Trento C5", "description": "Archivio storico delle stagioni del CUS Trento C5.", "heading": "Archivio stagioni", "eyebrow": "Stagione"},
      {"route": "events", "path": "/eventi/", "title": "Eventi CUS Trento C5", "description": "Eventi, tornei e selezioni del CUS Trento C5.", "heading": "Eventi", "eyebrow": "Eventi"},
      {"route": "partner", "path": "/partner/", "title": "Partner CUS Trento C5", "description": "Partner e sponsor del CUS Trento C5.", "heading": "Partner", "eyebrow": "Partner"},
      {"route": "become-partner", "path": "/diventa-partner/", "title": "Diventa partner CUS Trento C5", "description": "Pacchetti e opportunità per diventare partner del CUS Trento C5.", "heading": "Diventa partner", "eyebrow": "Partner"},
      {"route": "venue", "path": "/impianto/", "title": "Palazzetto Sanbàpolis CUS Trento C5", "description": "Impianto e casa del CUS Trento C5.", "heading": "Palazzetto Sanbàpolis", "eyebrow": "Club"}
    ],
    "hashRoutes": {
      "events:upcoming": "/eventi/#prossimi-eventi",
      "events:tournaments": "/eventi/#tornei",
      "events:selections": "/eventi/#selezioni",
      "events:archive": "/eventi/#archivio-eventi"
    },
    "routeAliases": {"sponsor": "partner", "club": "club-project"},
    "redirects": [
      {"from": "/sponsor/", "to": "/partner/", "status": 301}
    ],
    "hiddenNewsTitles": ["Serie C1: ecco il calendario, si parte venerdì 25 settembre"],
    "seasonCompetitions": {
      "2011/2012": "Serie D", "2012/2013": "Serie D", "2013/2014": "Serie D", "2014/2015": "Serie C2",
      "2015/2016": "Serie D", "2016/2017": "Serie D", "2017/2018": "Serie C2", "2018/2019": "Serie C2",
      "2019/2020": "Serie C2", "2020/2021": "Serie C2", "2021/2022": "Serie C1", "2022/2023": "Serie C1",
      "2023/2024": "Serie C1", "2024/2025": "Serie C1", "2025/2026": "Serie C1", "2026/2027": "Serie B"
    }
  }/*SITE-CONFIG-END*/;

  function slugify(value){
    const text = String(value == null ? "" : value)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, CONFIG.slug.maxLength)
      .replace(/-$/g, "");
    return text || CONFIG.slug.fallback;
  }

  function collectionFields(collection){
    const def = CONFIG.collections[collection];
    return def ? def.slugFields : ["title", "name", "date"];
  }

  // Human-readable base for automatic IDs and slugs.
  function slugBase(item, fields){
    const direct = (fields || []).map(field => item && item[field]).filter(Boolean).join(" ");
    return direct || (item && (item.name || item.title || item.home || item.away || item.date || item.season)) || "item";
  }

  function uniqueSlug(base, used){
    const rootSlug = slugify(base || "item");
    let candidate = rootSlug;
    let n = 2;
    while(used.has(String(candidate))){
      candidate = `${rootSlug}-${n}`;
      n += 1;
    }
    used.add(String(candidate));
    return candidate;
  }

  // Computes {id, slug} for each entry of a plain array: existing unique IDs are
  // kept, slugs are recomputed from the stored slug (or the slug fields) and
  // de-duplicated in list order.
  function computeIdsAndSlugs(items, fields){
    const usedIds = new Set();
    const usedSlugs = new Set();
    return (items || []).map(item => {
      if(!item || typeof item !== "object") return null;
      const currentId = String(item.id || "").trim();
      let id = currentId;
      if(currentId && !usedIds.has(currentId)) usedIds.add(currentId);
      else id = uniqueSlug(currentId || slugBase(item, fields), usedIds);
      const currentSlug = String(item.slug || "").trim();
      const slug = uniqueSlug(currentSlug || slugBase(item, fields), usedSlugs);
      return {id, slug};
    });
  }

  function withIdsAndSlugs(items, fields){
    if(!Array.isArray(items)) return items;
    const computed = computeIdsAndSlugs(items, fields);
    return items.map((item, i) => computed[i] ? {...item, id: computed[i].id, slug: computed[i].slug} : item);
  }

  function normalizeCollections(data){
    const out = {...(data || {})};
    Object.keys(CONFIG.collections).forEach(key => {
      if(Array.isArray(out[key])) out[key] = withIdsAndSlugs(out[key], CONFIG.collections[key].slugFields);
    });
    CONFIG.nestedSlugLists.forEach(({object, list, slugFields}) => {
      if(out[object] && Array.isArray(out[object][list])) out[object] = {...out[object], [list]: withIdsAndSlugs(out[object][list], slugFields)};
    });
    return out;
  }

  function objectSlug(item, collection){
    return slugify((item && item.slug) || slugBase(item, collectionFields(collection)));
  }

  function itemPath(collection, item){
    const def = CONFIG.collections[collection];
    return `${def ? def.urlBase : "/"}${objectSlug(item, collection)}/`;
  }

  function isHiddenNews(item){
    return CONFIG.hiddenNewsTitles.includes(String(item && item.title || "").trim());
  }

  const pathByRoute = {home: "/"};
  CONFIG.pages.forEach(page => { pathByRoute[page.route] = page.path; });
  Object.assign(pathByRoute, CONFIG.hashRoutes);
  const routeByPath = {"/": "home"};
  CONFIG.pages.forEach(page => { routeByPath[page.path] = page.route; });
  CONFIG.redirects.forEach(r => { if(routeByPath[r.to]) routeByPath[r.from] = routeByPath[r.to]; });

  // "2014/15" and "2014/2015" both resolve.
  function seasonCompetition(season){
    const key = String(season || "").replace(/\s/g, "");
    const long = key.replace(/^(\d{4})\/(\d{2})$/, (m, a, b) => `${a}/20${b}`);
    return CONFIG.seasonCompetitions[key] || CONFIG.seasonCompetitions[long] || "";
  }

  function publicYouthText(value){
    return String(value == null ? "" : value).replace(/\bunder\s*21\b/gi, "Under 23").replace(/\bu21\b/gi, "U23");
  }

  function canonicalRoute(routeId){
    const id = String(routeId || "home");
    return CONFIG.routeAliases[id] || id;
  }

  root.CUS_SITE = {
    config: CONFIG,
    slugify,
    slugBase,
    uniqueSlug,
    computeIdsAndSlugs,
    normalizeCollections,
    objectSlug,
    itemPath,
    isHiddenNews,
    seasonCompetition,
    publicYouthText,
    canonicalRoute,
    pathByRoute,
    routeByPath
  };
})(typeof window !== "undefined" ? window : globalThis);
