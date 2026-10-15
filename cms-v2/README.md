# Admin V2 — CMS CUS Trento C5

Pannello di amministrazione pubblicato in `/admin-v2/`. Architettura e audit:
[`docs/ADMIN_V2.md`](../docs/ADMIN_V2.md). È l'unico CMS del sito: il vecchio Decap (`/admin/`) è stato rimosso e il suo indirizzo reindirizza qui.

## Struttura

| Percorso | Contenuto |
|---|---|
| `shared/` | regole condivise da browser e server: schemi Zod, operazioni di modifica, normalizzazione (ID/slug da `js/site-core.js`), regole di business, League, rich text |
| `server/` | API: autenticazione Access, CSRF, rate limit, audit, GitHub, bozze/pubblicazione, media |
| `../functions/api/admin/[[path]].ts` | Pages Function che collega l'ambiente Cloudflare a `server/` |
| `../functions/admin-v2/_middleware.ts` | reindirizza `/admin-v2/` all'host protetto quando arriva da un altro dominio |
| `src/` | app React (Vite, Tailwind CSS 4, componenti Radix in stile shadcn/ui, Lucide) |
| `dev/devApi.ts` | solo sviluppo: API reale su copia in memoria del repository, JWT firmato localmente |
| `tests/` | test unitari e di integrazione delle API (Vitest) |
| `e2e/` | test Playwright: layout iPhone/iPad/desktop, accessibilità, flussi di modifica |

## Comandi

```bash
npm ci
npm run cms:dev        # http://localhost:5174/admin-v2/ — nessuna scrittura su disco o GitHub
npm run cms:test       # API, permessi, validazione, regressione sui dati reali
npm run cms:typecheck
npm run cms:e2e        # richiede: npx playwright install chromium (webkit: CMS_E2E_WEBKIT=1)
npm run build          # build Cloudflare completa: sito + _site/admin-v2
```

`CMS_DEV_ROLE=editor npm run cms:dev` prova il pannello con il ruolo Redazione.

## Configurazione in produzione

Nulla di quanto segue è nel repository. Servono tre passaggi, nell'ordine.

### Dove si usa il CMS

`calcioa5.custrento.it` è un CNAME (DNS su Aruba) verso il progetto Pages
`cus-trento-c5.pages.dev`: quel dominio non è nell'account Cloudflare, quindi Access
non può proteggerlo. Il CMS si usa quindi da:

**https://cus-trento-c5.pages.dev/admin-v2/** (da aggiungere alla schermata Home dell'iPhone)

Con `CMS_ADMIN_HOST=cus-trento-c5.pages.dev`:

- `calcioa5.custrento.it/admin-v2/` reindirizza (302) all'indirizzo sopra;
- `calcioa5.custrento.it/api/admin/*` risponde 404: le API esistono solo sull'host
  protetto e sui suoi sottodomini di anteprima (`*.cus-trento-c5.pages.dev`);
- il sito pubblico non cambia.

Anche senza questa variabile le API restano chiuse sul dominio pubblico: lì le
richieste non attraversano Access, non hanno il token firmato e ricevono 401.

### 1. Cloudflare Access (Zero Trust → Access → Applications)

Il piano gratuito di Zero Trust basta (fino a 50 utenti). Alla prima attivazione
Cloudflare chiede un nome di team: la pagina di login sarà `<team>.cloudflareaccess.com`,
senza bisogno di DNS.

Crea un'applicazione **Self-hosted** con questi domini:

- `cus-trento-c5.pages.dev` (produzione);
- `*.cus-trento-c5.pages.dev` (anteprime dei branch, incluse le bozze `cms-v2-drafts`).

Puoi proteggere l'intero host `pages.dev`: il pubblico usa `calcioa5.custrento.it`,
e le anteprime sono già escluse dai motori di ricerca. In alternativa limita i percorsi
a `/admin-v2` e `/api/admin`.

Poi:

- policy **Allow** solo per le email degli amministratori, con un metodo di login che
  richieda MFA (es. Google con verifica in due passaggi, oppure one-time PIN +
  *Require → Authentication method: mfa*);
- durata sessione consigliata: 24 ore.

Annota il **team domain** e l'**Application Audience (AUD) tag**.

L'API verifica comunque firma, audience, issuer e scadenza del token e l'elenco email.

### 2. GitHub App (permessi minimi)

GitHub → Settings → Developer settings → GitHub Apps → New:

- Repository permissions: **Contents: Read and write**, **Metadata: Read**,
  **Checks: Read**, **Commit statuses: Read** (gli ultimi due servono solo per lo stato del deploy);
- nessun webhook, nessun permesso sull'organizzazione;
- installala **solo** sul repository `fadefa88/cus-trento-c5`.

Genera una chiave privata (file `.pem`). Il formato PKCS#1 fornito da GitHub è accettato.
I commit fatti con il token dell'app avviano normalmente i workflow (*Sync CMS data*, *Optimize CMS images*).

Se `main` ha regole di protezione, aggiungi la GitHub App tra gli attori autorizzati a fare push.

### 3. Variabili del progetto Pages (Production e Preview)

Vanno impostate in **Cloudflare** → Workers & Pages → `cus-trento-c5` → Settings →
Variables and Secrets, per Production **e** Preview. **Non** come secret del repository
GitHub: le API girano su Cloudflare e non leggono i secret di GitHub Actions (che inoltre
non accettano nomi che iniziano con `GITHUB_`, da cui il prefisso `G_APP_`).

| Nome | Tipo | Valore |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | testo | `<team>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | testo | AUD tag dell'applicazione |
| `CMS_ADMIN_EMAILS` | testo | `mail1@…:admin:Nome Cognome, mail2@…:editor:Nome` |
| `G_APP_ID` | **secret** | ID numerico dell'app |
| `G_APP_INSTALLATION_ID` | **secret** | ID dell'installazione sul repository |
| `G_APP_PRIVATE_KEY` | **secret** | contenuto del file `.pem` |
| `CMS_ADMIN_HOST` | testo | `cus-trento-c5.pages.dev` |
| `CMS_REPO` | testo (facoltativo) | `fadefa88/cus-trento-c5` |
| `CMS_DRAFT_PREVIEW_URL` | testo (facoltativo) | `https://cms-v2-drafts.cus-trento-c5.pages.dev/` |
| `CMS_KV` | binding KV (consigliato) | namespace per rate limit e registro attività |

Per le statistiche visitatori in dashboard (facoltative, vedi sotto):

| Nome | Tipo | Valore |
|---|---|---|
| `CF_ANALYTICS_API_TOKEN` | **secret** | API token con solo *Account → Account Analytics → Read* |
| `CF_ACCOUNT_ID` | testo | Account ID Cloudflare (32 caratteri esadecimali) |
| `CF_WEB_ANALYTICS_SITE_TAG` | testo | site tag del sito Web Analytics (32 caratteri) |
| `CF_ANALYTICS_HOSTS` | testo (facoltativo) | host conteggiati, default `calcioa5.custrento.it` |

In alternativa alla GitHub App: `CMS_GITHUB_TOKEN` (secret) con un *fine-grained token*
limitato al solo repository e a *Contents: Read and write*.

Ruoli: `admin` può anche ripristinare versioni, pubblicare una bozza sopra modifiche
concorrenti e leggere il registro attività; `editor` modifica, salva bozze e pubblica.

## Verifica deploy e aggiornamento CMS

Cloudflare Pages deve utilizzare **Build command** `npm run build` e
**Build output directory** `_site` (root directory: repository root).
La build ora fallisce se `admin-v2` non è compilato, invece di pubblicare
il sito senza l'interfaccia aggiornata.

Ogni build pubblica `/admin-v2/release.txt` con il commit e l'istante
UTC di compilazione. Confrontare `commit=` con il SHA della deployment
Cloudflare Pages, **non** soltanto con il commit indicato dal dashboard.

Il service worker non conserva più una copia HTML dell'amministrazione:
le schermate e le API vengono sempre richieste online; vengono conservati
solo gli asset Vite con hash nel nome. Su iOS, dopo l'aggiornamento,
chiudere e riaprire l'app installata per caricare il nuovo bundle.

## Statistiche visitatori

La card *Visite al sito* in dashboard legge **Cloudflare Web Analytics** tramite la
GraphQL Analytics API (`rumPageloadEventsAdaptiveGroups`), da
`GET /api/admin/analytics` (`server/analytics.ts`): il token resta sul server, la
risposta è in cache 10 minuti (KV `CMS_KV` se presente).

- **Visite** e **Pagine viste** sono le metriche di Web Analytics: non esistono
  "visitatori unici" (il beacon non usa cookie né identificatori). Una visita è una
  pagina vista arrivando da un altro sito o da un link diretto. I valori sono stime
  di Cloudflare (campionamento adattivo).
- Il riquadro **Visite 24 ore / Pagine viste 24 ore** corrisponde
  all'intervallo predefinito **Ultime 24 ore** di Web Analytics (senza filtri aggiuntivi).
  Cloudflare applica un campionamento adattivo, per cui il totale API può comunque
  differire dalla UI. Il pannello visualizza il sample interval per la finestra 24 ore.
- Filtri della query: il site tag e il solo host pubblico `calcioa5.custrento.it`
  (niente `pages.dev`, anteprime e CMS). Nessun filtro bot opzionale o filtro
  sui percorsi, per non introdurre discrepanze con il dashboard Cloudflare di default.
  Chi sceglie *Exclude Bots* nel dashboard Cloudflare ottiene invece un perimetro diverso.
- **Oggi**, **ultimi 7 giorni** e **ultimi 30 giorni** utilizzano ciascuno
  un singolo totale non raggruppato sulla rispettiva finestra di calendario italiano,
  evitando di sommare stime campionate da giorni/ore separati.
  Il grafico deriva dalla suddivisione oraria degli ultimi 30 giorni ed è indicativo.
- La card mantiene una cache di 10 minuti. I valori dei diversi intervalli
  sono stime indipendenti e possono non sommarsi perfettamente, specie su siti con poche visite.
- Senza le variabili la card mostra *Statistiche non configurate*; mai numeri fittizi.

Il beacon sul sito pubblico è in `js/app.js` (`loadWebAnalytics`); con
`CF_WEB_ANALYTICS_TOKEN` vuoto è spento. Con il token si carica per tutti i
visitatori, indipendentemente dalla scelta sui cookie (il pannello cookie in
`index.html` lo dichiara: *Statistiche di visita — Sempre attive*), ma solo su
`calcioa5.custrento.it`. Il CSP di `/admin-v2/` lo blocca comunque. **Non** usare
*Workers & Pages → progetto → Metrics → Web Analytics → Enable*: inietterebbe il
beacon anche su `pages.dev` e sulle anteprime.

Attivazione (con l'informativa privacy e il pannello cookie aggiornati):

1. Cloudflare → **Web Analytics** → **Add a site** → hostname `calcioa5.custrento.it`
   → copia il **token** dello snippet JS (non incollare lo snippet nelle pagine).
2. In `js/app.js` imposta `CF_WEB_ANALYTICS_TOKEN` con quel token (è pubblico per
   natura: compare nell'HTML di qualunque sito che usa Web Analytics).
3. Aggiorna in `index.html` la voce *Analytics e marketing* del pannello cookie.
4. **site tag**: Web Analytics → il sito → nell'indirizzo della pagina compare
   `siteTag~in=<32 caratteri>`.
5. **API token**: My Profile → API Tokens → Create Token → Custom token, permesso
   *Account · Account Analytics · Read*, risorsa solo il tuo account.
6. Imposta le variabili della tabella sopra e rifai il deploy.

## Bozze e pubblicazione

- **Salva bozza**: commit sul branch `cms-v2-drafts` (= `main` + documenti in bozza +
  `.cms-v2/drafts.json`). `main` non cambia; il sito pubblico non cambia.
  Cloudflare Pages costruisce il branch come anteprima privata (se protetta da Access).
- **Pubblica**: le modifiche vengono riapplicate sull'ultima versione di `main`
  e committate. Modifiche di altri a elementi diversi sono mantenute; modifiche agli
  stessi elementi producono un conflitto (409) mostrato all'utente.
- Le immagini vengono caricate subito su `main` (`img/uploads/`), non referenziate
  finché il contenuto non viene pubblicato: il workflow di ottimizzazione le converte
  in WebP solo quando sono usate.
- Il repository è pubblico: anche le bozze sono leggibili su GitHub, pur non essendo
  pubblicate sul sito. Non inserire dati riservati nei contenuti.

## Ripristino e rollback

- Ogni pubblicazione è un commit con trailer `CMS-Actor`, `CMS-Action`, `CMS-Document`.
- *Cronologia e ripristino* riporta un documento a una versione precedente creando un
  nuovo commit (nessun force-push).
- Decap è stato rimosso; se mai servisse recuperarlo, è nella cronologia Git
  (commit precedenti alla rimozione di `admin/`). Per disattivare Admin V2: rimuovere le variabili `CF_ACCESS_*` (l'API risponde 503)
  oppure revocare l'installazione della GitHub App.

## Sicurezza: riepilogo dei controlli

Access + verifica JWT RS256 lato server · CMS e API solo sull'host protetto
(`CMS_ADMIN_HOST`) · allowlist email e ruoli · CSRF (header
dedicato, Origin, Sec-Fetch-Site) · nessun CORS · rate limit per utente e per IP sui
tentativi negati · validazione Zod e regole di business su ogni scrittura · HTML delle
news generato dal server con escaping · URL immagini/link limitati a percorsi del sito e
http(s) · upload verificati sui byte (no SVG) · CSP restrittiva su `/admin-v2/` ·
token GitHub solo server-side e a breve scadenza · aggiornamenti dei branch solo
fast-forward (nessuna sovrascrittura) · audit su commit e KV · ripristino versioni.
