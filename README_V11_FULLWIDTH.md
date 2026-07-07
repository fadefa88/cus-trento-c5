# Patch v11 full-width + prossime partite a capo

Modifiche:
- tutto il sito usa la stessa larghezza full-width della hero home, con padding laterale condiviso tramite `--cus-site-edge`;
- la sezione Prossime partite resta full-width;
- le card delle prossime partite ora vanno a capo su più righe: 4 colonne desktop, 3 tablet largo, 2 tablet/mobile largo, 1 smartphone;
- le frecce del carousel sono nascoste perché la sezione ora mostra tutte le card in griglia;
- cache-busting aggiornato a `menu-rework-v11` e `home-upcoming-v11`.

File modificati:
- `index.html`
- `css/site-navigation-rework.css`
- `css/home-upcoming-matches.css`
