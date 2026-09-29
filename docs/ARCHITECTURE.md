# Architettura del sito CUS Trento C5

Sito statico su Cloudflare Pages: pagine HTML prerenderizzate per SEO + una SPA
in JavaScript senza framework che, una volta caricati i dati, prende il controllo
di `<main id="app">`. Il repository Git è anche il database (JSON) e il backend
del CMS (Decap).

```
Decap CMS (/admin) ──commit──► content/cms/*.json ─┐
Workflow orari/giornalieri ──► content/*.json        ├─► main ──► Cloudflare Pages: npm run build
Workflow su push ─ roster → admin/config.yml ────────┘            │
                                                                   ▼
                          scripts/generate_static_pages.py + build_cloudflare_pages.sh ─► _site/
                                                                   │
Browser: HTML prerenderizzato ─► js/site-core.js + js/app.js caricano /content/data.json e renderizzano
         form contatti ─► js/contact-security.js ─► /api/contact (functions/api/contact.js) ─► Turnstile + Web3Forms
```

## Fonti di verità

| Regola | Autorità | Usata da | Controllo |
|---|---|---|---|
| Route pubbliche, pagine prerenderizzate e loro meta (title, description, heading) | `js/site-core.js` → `pages` | generatore, build, router SPA | `check_site_consistency.py` |
| Collection CMS: campi dello slug, URL base, prefisso della route di dettaglio, breadcrumb | `js/site-core.js` → `collections` | generatore, `app.js`, `admin/custom.js` | idem |
| Algoritmo di slug/ID (NFKD, max 86 caratteri, suffisso `-2`, `-3`…) | `js/site-core.js` | `app.js`, `admin/custom.js`; porting Python in `scripts/site_data.py` | parità JS/Python su tutti i contenuti reali |
| News nascoste, stagione → campionato, testo Under 21 → Under 23 | `js/site-core.js` | generatore, `app.js` | parità JS/Python |
| Alias di route e redirect (`/sponsor/` → `/partner/`) | `js/site-core.js` → `routeAliases`, `redirects` | router SPA, `_redirects` generato | idem |
| Elenco dei file CMS | `admin/config.yml` (ciò che Decap scrive davvero) | `scripts/site_data.py` | file dichiarati = file su disco; chiavi disgiunte |
| Fusione CMS → `content/data.json` | `scripts/site_data.py merge` | build Cloudflare, workflow *Sync CMS data*, generatore | build |
| Cartelle prerenderizzate pubblicate | `generate_static_pages.py --list-output-dirs` | build Cloudflare | la build fallisce se un URL del sitemap non ha la sua pagina |

Il blocco `SITE-CONFIG` in `js/site-core.js` è JSON rigoroso: lo legge anche Python.
Per aggiungere una collection CMS bastano la voce in `admin/config.yml` e la voce in
`collections`; fusione, generatore, router e CMS la raccolgono da lì.

### Precedenza dei dati

`content/data.json` è la base (classifiche, statistiche storiche, automazioni). Ogni file
`content/cms/*.json` definisce una sola chiave di primo livello (`news`, `roster`,
`fixtures`, …) che sostituisce quella della base. Due file CMS con la stessa chiave sono
un errore. Le news pubblicate sono: news CMS + `content/news.index.json` (importate),
deduplicate per `sourceUrl`/`sourceId`/`id`, con il testo completo preso da
`content/news.imported.json`.

## Route

- **Prerenderizzate** (un `index.html` per URL, tutte nel sitemap): le 22 pagine di
  `pages` più una pagina per ogni elemento delle collection (news, rosa, partite,
  partite U23, album, sponsor, pacchetti, staff, video, eventi).
- **Solo SPA** (nessuna pagina, raggiungibili via hash): `/#historical-stats`,
  `/#sponsor-lead`; i filtri eventi `/eventi/#tornei`, `#selezioni`,
  `#archivio-eventi`, `#prossimi-eventi` sono stati della pagina `/eventi/`.
- **Alias**: `/sponsor/` → redirect 301 a `/partner/` (`_redirects`); le route SPA
  `sponsor` e `club` sono alias di `partner` e `club-project`.
- **Fallback**: senza `404.html`, Cloudflare risponde agli URL sconosciuti con la home
  (status 200). Il controllo del sitemap in build impedisce che un URL pubblicato
  finisca silenziosamente nel fallback, come succedeva per le 8 sezioni mancanti.

## Build (Cloudflare Pages)

`npm run build` → `scripts/build_cloudflare_pages.sh`:

1. rigenera pagine, `sitemap.xml`, `robots.txt`, `_redirects`;
2. copia in `_site/` i file statici (elenco fisso di asset) più le cartelle che il
   generatore dichiara di possedere;
3. `site_data.py merge --root _site` pubblica `content/data.json` già unito;
4. verifica che ogni URL del sitemap abbia la sua pagina in `_site/`;
5. aggiunge gli header di sicurezza e `noindex` per `*.pages.dev` e `/admin`.

Output: `_site/`. Il frontend usa sempre l'endpoint `/api/contact`; le chiavi
(`TURNSTILE_SECRET_KEY`, `WEB3FORMS_ACCESS_KEY`) esistono solo come variabili
d'ambiente della Pages Function.

## Frontend

| File | Ruolo |
|---|---|
| `js/site-core.js` | regole condivise (vedi sopra), nessun accesso al DOM |
| `js/app.js` | unica implementazione di dati, router, menu, pagine, match center, link reali |
| `js/contact-security.js` | solo form contatti: Turnstile + invio a `/api/contact` |

Ordine di caricamento: `site-core.js` → `app.js` → `contact-security.js` (tutti `defer`).
`app.js` all'avvio disegna il menu (e la home con i dati di fallback); dopo
`content/data.json` renderizza la route corrente. `render()` è l'unico punto di
smistamento: prima la pagina, poi il menu, che dipende dalla route effettiva.
I pulsanti con `onclick="route('…')"` diventano `<a href>` canonici
(`linkifyRouteButtons`), così crawler e "apri in nuova scheda" vedono l'URL vero.

### Livelli rimossi e dove è finito il loro comportamento

| Livello precedente | Tipo | Ora |
|---|---|---|
| `js/site-navigation-rework.js` | override di `route`, `popstate`, menu, menu mobile; pagine nuove | router, menu e pagine di sezione in `app.js` |
| `js/home-structure.js` | sostituiva `home()` | `home()` in `app.js` |
| `js/home-upcoming-matches.js` | inseriva "Prossime partite" dopo `home()`; patch a `titleCaseWords`, `rankingRows`, `historicalPlayerName`, `scorerListHtml`, `matchDetail` | sezione composta direttamente in `home()`; patch integrate nelle funzioni originali; le patch al vecchio match center erano codice morto |
| script inline in `index.html`: route→link, match center v57, v60 | override globali, `render()` prima dei dati | match center unico in `app.js`; un solo linkifier |
| `contact-security.js` (parti non-contatti) | override pagina Partner, secondo linkifier, mutazioni DOM del match center, retry immagini | Partner, linkifier e match center in `app.js`; il retry immagini non scattava mai ed è stato rimosso |
| `<style>` inline in `index.html` e stile iniettato a runtime | CSS a strati | in coda a `css/site-navigation-rework.css`, nello stesso ordine di cascata |
| `loadCmsDataOverrides` in `app.js` | seconda fusione CMS nel browser (11 richieste) | rimossa: `content/data.json` è pubblicato già unito |

Bug risolti come effetto: i link diretti a news e partite (e partite U23) venivano
reindirizzati alla lista. Per le news gli slug del generatore e del frontend
divergevano; per le partite lo script inline chiamava `render()` prima dei dati.

## GitHub Actions

```
Decap CMS (commit con token OAuth dell'utente)
 ├─► Site validation            (ogni push/PR su main)
 ├─► Sync CMS data              (content/cms/*.json) ── push con GITHUB_TOKEN ──► nessun altro workflow
 └─► Optimize CMS images        (img/uploads, JSON CMS, data.json) ── push con GH_PAT ─┐
                                                                                       ▼
                        Site validation · Sync CMS data · Optimize CMS images (seconda esecuzione: nessuna modifica → nessun commit)

Import SporTrentino (ogni ora, :07)  ── GH_PAT ─► Site validation; Optimize se cambia content/data.json
Update standings    (ogni ora, :17)  ── GH_PAT ─► Site validation; Optimize (content/data.json)
Update social feed  (ogni giorno 05:23) ── GH_PAT ─► Site validation
```

- Ogni push su `main` produce un deploy Cloudflare (integrazione Git, non Actions).
- `GITHUB_TOKEN` per *Sync CMS data* è intenzionale: il suo commit (`admin/config.yml`,
  `content/data.json`) non deve riavviare *Optimize*. Gli altri workflow usano `GH_PAT`
  perché le loro modifiche devono attivare validazione e ottimizzazione.
- La condizione `github.actor != 'github-actions[bot]'` non ferma i push fatti con
  `GH_PAT` (l'attore è il proprietario del token). Le catene terminano perché la
  seconda esecuzione non trova modifiche; è un comportamento esistente, non modificato.
- Tutti i workflow che committano rigenerano le pagine con `generate_static_pages.py`
  e fanno `git add -A`, con rebase e 3 tentativi di push.

## Output generato

Le cartelle delle route, `sitemap.xml`, `robots.txt` e `_redirects` sono generati da
`scripts/generate_static_pages.py`: non vanno modificati a mano. Restano versionati
perché i workflow li committano e perché servono all'anteprima locale del repository.
La build Cloudflare non ne dipende: una build da una copia senza nessun file generato
produce lo stesso `_site/` byte per byte. Per smettere di versionarli servono:
conferma nel pannello Cloudflare di comando di build `npm run build` e cartella
`_site`, un `.gitignore` per l'output e la rimozione della generazione dai workflow
che oggi la committano.

## Controlli in CI (`site-validation.yml`)

- JSON validi, sintassi Python/JS/bash;
- `scripts/check_site_consistency.py`: file CMS dichiarati = presenti, chiavi disgiunte,
  route/alias/redirect coerenti, nessuna tabella di regole ridichiarata fuori da
  `site-core.js`, parità JS/Python di slug, ID, URL e testi su tutti i contenuti;
- build completa, inclusa la verifica che ogni URL del sitemap sia pubblicato.
