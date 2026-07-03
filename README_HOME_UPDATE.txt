CUS Trento C5 - aggiornamento home

Contenuto dello zip:
- index.html: identico all'attuale, con aggiunti solo:
  - /css/home-structure.css
  - /js/home-structure.js
- css/home-structure.css: CSS nuovo ma completamente scoped su .home-structure, quindi non impatta le altre pagine.
- js/home-structure.js: override della sola funzione home(), senza toccare js/app.js.

Come usarlo:
1. Estrai lo zip nella root del repo cus-trento-c5.
2. Sovrascrivi index.html.
3. Aggiungi le due nuove cartelle/file se non presenti.
4. Testa in locale o su staging.
5. Fai commit e push.

Note:
- Header e footer restano quelli attuali.
- La hero della home viene rimossa dalla home renderizzata.
- La sezione social wall usa la funzione esistente homeSocialSection(), quindi resta coerente con l'attuale sito.
