# TikTok Display API — CUS Trento C5

Questa integrazione sostituisce l'importazione non ufficiale di TikTok (RSS-Bridge / yt-dlp)
appena l'account viene autorizzato. Instagram e i layout Home/Social restano invariati.

## Requisiti (da completare nel TikTok Developer Portal)

1. Accedi a https://developers.tiktok.com/apps con un account TikTok Developers.
2. Registra un'app denominata, ad esempio, **CUS Trento C5**.
3. Configura **Login Kit per Web** con redirect URI **esattamente**
   `https://calcioa5.custrento.it/tiktok-auth/`.
4. Aggiungi il prodotto **Display API / TikTok API** e gli scope
   `user.info.basic` e `video.list`. Effettua la revisione richiesta da TikTok
   per l'ambiente Live. L'accesso all'account TikTok da solo NON abilita la Display API.
5. Nella configurazione dell'app verifica il dominio, i Terms of Service e Privacy Policy
   se richiesti da TikTok. L'app può essere testata con account autorizzati in Sandbox
   nei limiti indicati dal portale Developers.

La callback è statica e non riceve o memorizza token sul server. L'URL contenente
il codice OAuth va copiato soltanto nel comando locale di attivazione.

## Attivazione una tantum (dal proprio computer)

Non incollare Client Secret, access token, refresh token o URL di callback in
GitHub Issues, repository, chat o screenshot.

Con Python 3.12+ installato, clona il repository e, nella directory principale:

```bash
python -m pip install requests pillow cryptography
```

Crea una chiave di cifratura e **conservala in un password manager**:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Imposta queste variabili d'ambiente nella tua sessione terminale (i valori sono
esempi, NON usare letteralmente questi placeholder):

- `TIKTOK_CLIENT_KEY`: Client Key dell'app sviluppatore
- `TIKTOK_CLIENT_SECRET`: Client Secret (mai nel repository)
- `TIKTOK_FERNET_KEY`: chiave Fernet generata sopra
- `TIKTOK_REDIRECT_URI`: `https://calcioa5.custrento.it/tiktok-auth/`

Esegui:

```bash
python scripts/sync_tiktok_display_api.py authorize
```

Apri l'URL stampato dal comando nel browser e autorizza **@custrentoc5**.
La pagina di callback ha un pulsante "Copia URL di autorizzazione".
Subito dopo, sempre sullo stesso computer, esegui:

```bash
python scripts/sync_tiktok_display_api.py activate
```

Incolla l'URL copiato nella richiesta interattiva. Il codice di autorizzazione
ha durata breve; se scade, ripeti `authorize`. Il comando verifica lo `state`
anti-CSRF, scambia il codice lato client locale e scrive **solo** il token cifrato
nel file `.github/tiktok-display-credentials.enc`. Non produce alcun file di
token in chiaro.

Verifica quindi in locale:

```bash
python scripts/sync_tiktok_display_api.py sync --limit 12
```

Controlla le prime voci TikTok in `content/social-feed.json`: dovrebbero avere
`source: "tiktok-display-api"` e copertine `/img/social/tiktok-*.jpg`
specifiche di ogni video.

Commit soltanto:
- `.github/tiktok-display-credentials.enc` (cifrato, non pubblicato nel sito)
- `content/social-feed.json`
- le nuove copertine sotto `img/social/`

**Non** committare file `.env`, callback URL, codici OAuth, log con token o
`.tiktok-auth-state`.

## Secrets GitHub Actions

In **GitHub → Settings → Secrets and variables → Actions → New repository secret**
crea esattamente questi tre repository secrets:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_FERNET_KEY`

Il repository usa già `GH_PAT` per il push dalle automazioni. Il workflow
`.github/workflows/update-tiktok-display.yml` esegue una sincronizzazione due
volte al giorno. Se manca anche solo un secret o il file cifrato, non cambia
il feed e indica che l'attivazione deve essere completata.

L'access token scade dopo circa 24 ore. Il refresh token può cambiare dopo il
rinnovo: per questo entrambi sono conservati nel file cifrato che il workflow
aggiorna e committa senza mai registrare valori segreti nei log.

## Note operative e risoluzione dei problemi

- Gli URL CDN `cover_image_url` hanno TTL di circa **6 ore**: il backend scarica
  una copia locale prima di pubblicare il nuovo feed. Il browser non utilizza gli
  URL TikTok direttamente.
- Se il download di una copertina fallisce, non viene mostrato un avatar falso.
  Il feed precedente resta disponibile.
- Se il portale restituisce `scope_not_authorized` o un errore di accesso,
  controlla approvazione dell'app e autorizzazione effettiva di `video.list`.
- Se il refresh token viene revocato/scade, ripeti la procedura `authorize` e
  `activate`, senza condividere credenziali.
- Documentazione TikTok: https://developers.tiktok.com/docs/en/display-api-get-started ,
  https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list ,
  https://developers.tiktok.com/docs/en/oauth-user-access-token-management .
