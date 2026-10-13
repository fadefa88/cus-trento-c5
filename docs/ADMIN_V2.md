# Admin V2 — audit e architettura

Documento di riferimento per il CMS `/admin-v2/`. Il CMS Decap (`/admin/`) è stato
rimosso dopo l'approvazione: l'elenco dei file CMS è ora in `js/site-core.js`
(`cmsFiles`) e `/admin/` reindirizza ad Admin V2. Le sezioni di audit qui sotto
descrivono il sistema com'era prima della migrazione.

## 1. Audit del sistema attuale

### Fonti di verità (già esistenti, da non duplicare)

| Dato | Fonte autorevole | Note |
|---|---|---|
| Collection, campi slug, URL base, algoritmo slug/ID | `js/site-core.js` (blocco `SITE-CONFIG`) | porting Python in `scripts/site_data.py`, parità verificata in CI |
| Elenco file CMS e ordine di fusione | `admin/config.yml` (`file: content/cms/*.json`) | letto da `site_data.py` con una regex: il file deve restare |
| Contenuti editoriali e sportivi | `content/cms/*.json` (una chiave top-level per file) | 11 file |
| Dati automatici (classifiche, storico, coppe, social) | `content/data.json` e workflow | **non** modificabili dal CMS |
| News importate | `content/news.index.json`, `content/news.imported.json` | import SporTrentino orario, non toccate dal CMS |
| Statistiche giocatori | calcolate **nel browser** (`js/app.js`) dagli eventi delle partite terminate | il CMS salva solo gli eventi |
| Classifiche League e tabellone | calcolati **nel browser** (`leagueStandings`, `leagueBracketHtml`) | nel JSON solo risultati e vincente manuale |
| Opzioni giocatori nei select Decap | generate da `scripts/sync_roster_options.py` in `admin/config.yml` | servono solo a Decap |

### File CMS e chiavi

| File | Chiave | Tipo | Elementi | Slug fields |
|---|---|---|---|---|
| `news.json` | `news` | lista | 0 (le news visibili arrivano dall'import) | title, date |
| `roster.json` | `roster` | lista | 34 | name |
| `fixtures.json` | `fixtures` | lista | 24 | home, away, date |
| `u21-fixtures.json` | `u21Fixtures` | lista | 22 | home, away, date |
| `gallery-albums.json` | `galleryAlbums` | lista | 2 | title, season, date |
| `sponsors.json` | `sponsors` | lista | 0 | name |
| `sponsor-packages.json` | `sponsorPackages` | lista | 4 | name |
| `staff.json` | `staff` | lista | 7 | name, role |
| `videos.json` | `videos` | lista | 12 | title |
| `club-history.json` | `clubHistory` | oggetto | `images[]` con slug da `season` | — |
| `events.json` | `events` + `cusTrentoLeague` | lista + oggetto | 3 eventi, 8 squadre, 4 partite | title, date |

### Automatismi da preservare

- **ID e slug**: generati al salvataggio con `computeIdsAndSlugs` di `site-core.js`.
  Gli ID esistenti unici restano; gli slug esistenti restano (anche se i campi
  cambiano: es. partita con `home: "Trento"` e slug `cus-trento-ac-trento-1921-…`).
  Cambiare uno slug cambia l'URL SEO: il CMS V2 non lo fa mai implicitamente.
- **Validazioni Decap** (`admin/custom.js`): data obbligatoria per le news; per le
  partite U23 terminate il quintetto deve avere esattamente 5 giocatori; quintetto e
  panchina senza duplicati; per le partite "Da giocare" le liste lineup vuote diventano `[]`.
- **Campi runtime aggiunti da Decap** e non presenti in `config.yml`:
  `opponentLogo` (entrambi i calendari), `opponentLineup` e tempi gol
  (`minute`, `goalTimes`) per la Prima squadra, `opponentScorerEvents` per entrambe.
- **Campi presenti nei dati ma non nel form** (devono sopravvivere al salvataggio):
  es. `goalkeeperEvents[].minutes`, `galleryAlbums[].description/category`,
  `videos[].thumb/category`. Il CMS V2 preserva sempre i campi sconosciuti.
- **Autogol**: `playerId: "autogol"` nelle partite; nella League `name: "Autogol"`.
  Compare nel tabellino, escluso da marcatori/storico.
- **Statistiche**: una partita conta solo se `status = Terminata` e `score` contiene due
  numeri; la squadra CUS è riconosciuta dal nome (`CUS Trento` in casa o trasferta).
- **Tabellone League**: 1ªA–4ªB, 2ªA–3ªB, 3ªA–2ªB, 4ªA–1ªB; SF1 = V(Q1)–V(Q2),
  SF2 = V(Q3)–V(Q4); finale tra le vincenti. Il `winner` manuale vale solo se coincide
  con una delle due squadre dell'incontro. Classifica: punti, differenza reti, gol fatti, nome.

### Pipeline dopo un commit su `main`

1. Cloudflare Pages: `npm run build` → `scripts/build_cloudflare_pages.sh` → `_site/`.
2. *Sync CMS data* (push su `content/cms/*.json`): aggiorna `admin/config.yml` e
   `content/data.json`.
3. *Optimize CMS images*: converte `img/uploads` in WebP e riscrive i riferimenti.
4. *Site validation*: JSON, sintassi, parità JS/Python, build completa.

### Criticità rilevate

- Decap si autentica tramite un Worker OAuth esterno con token dell'utente con scope
  ampio sul repository; nessun controllo server-side sui contenuti salvati.
- Il frontend pubblico inserisce `bodyHtml` delle news senza sanitizzazione
  (oggi proviene solo dall'import). Il CMS V2 non scrive mai HTML fornito dal client.
- Il repository è **pubblico**: tutto ciò che viene committato (anche su branch di bozza)
  è leggibile su GitHub, pur non essendo pubblicato sul sito.
- Il regolamento della League è codificato in `js/app.js`, non modificabile da CMS.

## 2. Architettura proposta

```
iPhone / desktop ──► Cloudflare Access (SSO + MFA) su cus-trento-c5.pages.dev ──► /admin-v2/  (React PWA statica)
                                   │
                                   └──► /api/admin/*  (Pages Function)
                                          1. verifica JWT Access (firma RS256, aud, iss, exp)
                                          2. allowlist email + ruolo
                                          3. CSRF: Origin + header custom + JSON
                                          4. rate limit (KV) · validazione Zod
                                          5. ID/slug con js/site-core.js (stesso codice del sito)
                                          6. GitHub App (token installazione a vita breve)
                                             ├─ bozze → branch `cms-v2-drafts`
                                             └─ pubblica → commit su `main` (CAS sullo SHA)
                                          7. audit log (trailer nel commit + KV)
```

### Decisioni

| Tema | Scelta | Motivo |
|---|---|---|
| Frontend | React + TypeScript + Vite, Tailwind CSS v4, componenti stile shadcn/ui (Radix), icone Lucide | richiesto; i componenti shadcn sono copiati nel repo, nessun runtime esterno |
| Routing | hash router interno | nessuna modifica a `_redirects` (generato) né al fallback del sito |
| Sorgenti | `cms-v2/` (app, `shared/`, `server/`, test); build in `_site/admin-v2/` | il nome `admin-v2` resta libero per l'URL pubblicato |
| API | un'unica Pages Function `functions/api/admin/[[path]].ts` che delega a `cms-v2/server` | stessa infrastruttura di `/api/contact`, nessun `wrangler.toml` (eviterebbe di spostare la configurazione del progetto Pages fuori dal pannello) |
| Database | nessuno: Git resta il database | richiesto; KV solo per rate limit e audit dettagliato (opzionale) |
| Bozze | branch `cms-v2-drafts` = `main` + file in bozza; manifest `.cms-v2/drafts.json` | Sync/Optimize girano solo su `main`; l'anteprima Cloudflare del branch mostra la bozza |
| Concorrenza | ogni modifica porta lo SHA del file letto; il commit aggiorna il ref senza force (fast-forward) | due modifiche simultanee non si sovrascrivono: la seconda riceve 409 |
| ID/slug | `js/site-core.js` importato dal server | una sola implementazione per sito, generatore, Decap e V2 |
| News | editor a blocchi (TipTap) salvato come JSON validato; `bodyHtml` **generato dal server** da quel JSON con escaping; `body` testuale per anteprime/SEO | nessun HTML del client raggiunge il sito |
| Media | upload su `img/uploads/` via GitHub; ridimensionamento/ritaglio nel browser; il server controlla magic bytes, dimensione, estensione; SVG rifiutati | il workflow *Optimize* continua a funzionare |
| Rollback | ripristino di un file a un commit precedente = nuovo commit (mai force-push su `main`) | storia sempre verificabile |

### Cosa non cambia

`/admin/`, `admin/config.yml`, `content/cms/*.json` (formato), `js/site-core.js` (regole),
generatore, sitemap, URL pubblici, workflow esistenti. Il frontend pubblico riceve un
solo cambiamento additivo: il regolamento League letto da `cusTrentoLeague.rules` se
presente, altrimenti il testo attuale.

### Dominio

`calcioa5.custrento.it` è un CNAME (DNS su Aruba) verso `cus-trento-c5.pages.dev`:
Access non può proteggere il dominio pubblico. Il CMS si usa da
`https://cus-trento-c5.pages.dev/admin-v2/`, protetto da Access; con `CMS_ADMIN_HOST`
il dominio pubblico reindirizza `/admin-v2/` e non espone `/api/admin`.

## 3. Configurazione richiesta (a cura del proprietario)

Nessun segreto è nel repository. Valori da impostare nelle variabili della Pages Function
(Production **e** Preview):

| Variabile | Tipo | Descrizione |
|---|---|---|
| `CMS_ADMIN_HOST` | var | `cus-trento-c5.pages.dev` |
| `CF_ACCESS_TEAM_DOMAIN` | var | es. `<team>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | var | Application Audience (AUD) tag dell'applicazione Access |
| `CMS_ADMIN_EMAILS` | var | email autorizzate, separate da virgola (`email:ruolo`, ruoli `admin`/`editor`) |
| `G_APP_ID` | secret | ID della GitHub App |
| `G_APP_PRIVATE_KEY` | secret | chiave privata PKCS#8 (vedi sotto) |
| `G_APP_INSTALLATION_ID` | secret | installazione sul repository |
| `CMS_REPO` | var | `fadefa88/cus-trento-c5` |
| KV binding `CMS_KV` | binding | opzionale ma consigliato: rate limit e audit log |

Dettagli operativi in `cms-v2/README.md`.
