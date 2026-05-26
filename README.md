# cus-trento-c5

## Deploy VHosting

Workflow corretto in `.github/workflows/deploy.yml`.

Trigger:
- push su `main`
- push su `master`
- avvio manuale da GitHub Actions con `Run workflow`

Secrets richiesti:
- FTP_SERVER
- FTP_USERNAME
- FTP_PASSWORD
- FTP_SERVER_DIR

Nota:
la cartella `.github` deve stare nella root del repository, allo stesso livello di `index.html`.
Non caricare lo ZIP dentro GitHub: estrai lo ZIP e carica i file/cartelle.
