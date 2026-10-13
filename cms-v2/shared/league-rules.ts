// Text of the League rules as currently hard-coded in js/app.js
// (leagueRulesHtml), used as the starting point when an editor customises them.
// A test checks that rendering it gives the same text as the current page.
export const DEFAULT_RULES = {
  heading: "CUS Trento Futsal League",
  intro: "Indicazioni generali tratte e riformulate dal regolamento pubblicato da UniTrento Sport / CUS Trento. La formula a due gironi e le fasi finali qui descritte si riferiscono alla Fall Edition 2026.",
  sections: [
    { title: "1. Partecipazione", paragraphs: ["Possono partecipare gli iscritti a UniTrento Sport / CUS Trento con tesseramento valido: studenti, dipendenti e alumni dell’Università di Trento. Ogni squadra può comprendere al massimo quattro persone esterne, previa registrazione al portale ufficiale."] },
    { title: "2. Composizione delle squadre", paragraphs: ["Il regolamento pubblicato prevede rose composte da un minimo di otto e un massimo di quattordici giocatori. Il capitano comunica l’elenco dei componenti al momento dell’iscrizione."] },
    { title: "3. Gironi e qualificazione", paragraphs: ["La Fall Edition 2026 comprende due gironi da quattro squadre. Tutte e otto accedono alla fase finale, indipendentemente dalla posizione in classifica; la posizione determina l’avversaria dei quarti.", "Gli incroci sono: **1ª A–4ª B**, **2ª A–3ª B**, **3ª A–2ª B** e **4ª A–1ª B**."] },
    { title: "4. Fasi finali", paragraphs: ["Quarti di finale, semifinali e finale si disputano a eliminazione diretta in gara unica. Le vincenti dei quarti 1 e 2 giocano la prima semifinale; quelle dei quarti 3 e 4 la seconda. Le due vincenti si incontrano in finale.", "Per un risultato di parità, la modalità di individuazione della vincente deve essere comunicata dall’organizzazione."] },
    { title: "5. Partite", paragraphs: ["La fonte ufficiale indica incontri composti da due tempi di 22 minuti e regole di calcio a 5 con eventuali adattamenti comunicati prima della competizione. Le gare vengono programmate dall’organizzazione, che informa i capitani."] },
    { title: "6. Iscrizione", paragraphs: ["Il capitano trasmette il modulo con i nominativi dei giocatori. L’iscrizione è confermata solo dopo il pagamento della quota. Nella pagina ufficiale sono previsti consegna del modulo alla segreteria oppure invio tramite email."] },
    { title: "7. Quote e premi", paragraphs: ["La pagina di riferimento, relativa alla precedente edizione di primavera 2026, riportava quote individuali di **15 € per studenti**, **20 € per dipendenti e alumni** e **25 € per esterni**, oltre a un buono acquisto da 400 € per la prima classificata. Importi e premi **non sono confermati per la Fall Edition 2026**: chiedere verifica alla segreteria."] },
    { title: "8. Informazioni e contatti", paragraphs: ["Per iscrizioni, tesseramento, pagamenti e chiarimenti sulle regole rivolgersi alla segreteria CUS Trento: Via Verdi 8, Trento; telefono [0461 281856](tel:+390461281856); email [custn@unitn.it](mailto:custn@unitn.it).", "Il calendario corrente e le date vengono pubblicati sul sito del torneo."] },
  ],
};
