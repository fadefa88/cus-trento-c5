# CMS media su Cloudflare R2

Questa configurazione lascia il CMS Decap invariato: gli editor continuano a caricare immagini dall'interfaccia `/admin` come prima.

Flusso operativo:

1. Decap CMS salva temporaneamente il nuovo file in `img/uploads/` e aggiorna i JSON sotto `content/cms/`.
2. La GitHub Action `Optimize CMS uploaded images and move to R2` rileva solo i nuovi file aggiunti in `img/uploads/`.
3. Lo script converte/ottimizza l'immagine in WebP con il profilo corretto:
   - `people`: 800x1000 crop, qualità 82
   - `news`: larghezza massima 1600px, qualità 82
   - `gallery`: larghezza massima 1600px, qualità 80
   - `sponsor`: larghezza massima 300px, qualità 90
4. Il WebP ottimizzato viene caricato su Cloudflare R2.
5. I JSON vengono riscritti con l'URL pubblico R2.
6. Il file temporaneo in `img/uploads/` viene rimosso dal repository.

I file già esistenti nel repository non vengono migrati, perché la workflow lavora solo sui file nuovi aggiunti dal CMS. L'input manuale `process_all_current_uploads` va lasciato su `false`, salvo migrazione esplicita di tutto l'archivio.

## Secret richiesti in GitHub

Impostare in `Settings > Secrets and variables > Actions > Secrets`:

- `R2_ENDPOINT` — esempio: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `R2_BUCKET` — nome del bucket R2
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BASE_URL` — dominio pubblico collegato al bucket, esempio `https://media.custrentocalcioa5.it`

Opzionale in `Settings > Secrets and variables > Actions > Variables`:

- `R2_PREFIX` — default: `cms/uploads`

## Cloudflare R2

Configurazione consigliata:

- bucket dedicato, ad esempio `cus-trento-c5-media`;
- dominio custom pubblico, ad esempio `media.custrentocalcioa5.it`;
- API token R2 con permessi Object Read & Write limitati a quel bucket.

Il sito può usare direttamente URL assoluti R2 nei JSON, quindi non serve modificare `js/app.js`.

## Nota operativa

Non riutilizzare nomi file identici a immagini già esistenti in `img/uploads/` quando carichi dal CMS. La workflow è impostata per processare solo file nuovi (`diff-filter=A`), proprio per non toccare gli asset storici già presenti nel repository.
