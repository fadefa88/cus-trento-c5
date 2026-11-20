"""Offline safety tests for CPA Trento Serie D U23 disciplinary sync."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.sync_serie_d_u23_cards import (
    confirms_match, c_us_sanctions, add_verified_cards,
    update_site, sections, norm, club_options
)

REPORT = """
Federazione Italiana Giuoco Calcio
COMITATO PROVINCIALE AUTONOMO DI TRENTO
Stagione Sportiva 2026/2027
Comunicato Ufficiale N° 67 del 18 novembre 2026
4. GARE
4.2 RISULTATI
CAMPIONATO CALCIO A 5 SERIE D
RISULTATI UFFICIALI GARE DEL 13/11/2026
GIRONE A - 8 Giornata - A
CUS TRENTO sq.B - SAN GIUSEPPE       2 - 4
GIRONE B
5. GIUSTIZIA SPORTIVA
5.1 DECISIONI DEL GIUDICE SPORTIVO
CAMPIONATO CALCIO A 5 SERIE D
GARE DEL 13/ 11/2026
PROVVEDIMENTI DISCIPLINARI
In base alle risultanze degli atti ufficiali sono state deliberate le seguenti sanzioni disciplinari.
CALCIATORI ESPULSI
SQUALIFICA PER UNA GARA EFFETTIVA
BATTAGLIA EDOARDO
(CUS TRENTO sq.B)
ALTRO GIOCATORE
(SAN GIUSEPPE)
CALCIATORI NON ESPULSI
SQUALIFICA PER UNA GARA PER RECIDIVITA' IN AMMONIZIONE (V INFR)
GRIPPA MICHELE
(CUS TRENTO sq.B)
I AMMONIZIONE DIFFIDA
BUDA SAMUELE
(CUS TRENTO sq.B)
CASUALE GIOCATORE
(SAN GIUSEPPE)
ALLENATORI
AMMONIZIONE
UN MISTER
(CUS TRENTO sq.B)
Pubblicato in Trento il 19/11/2026
"""

ROSTER = [
    {"id": "battaglia-edoardo", "name": "Battaglia Edoardo"},
    {"id": "grippa-michele", "name": "Grippa Michele"},
    {"id": "buda-samuele", "name": "Buda Samuele"},
]
FIXTURE = {
    "id": "cus-trento-u23-san-giuseppe-2026-11-13",
    "home": "CUS Trento U23",
    "away": "San Giuseppe",
    "date": "2026-11-13",
    "score": "2-4",
    "competition": "Campionato",
    "status": "Terminata",
    "lineup": {"startingFive": [], "bench": ["battaglia-edoardo", "grippa-michele", "buda-samuele"]},
    "scorerEvents": [{"playerId": "buda-samuele", "goals": 1}],
    "yellowCardEvents": [{"playerId": "grippa-michele", "cards": 1}],
}


class Under23DisciplineTests(unittest.TestCase):
    def test_exact_match_result_and_date(self):
        self.assertTrue(confirms_match(REPORT, FIXTURE))
        self.assertFalse(confirms_match(REPORT, {**FIXTURE, "score": "2-5"}))
        self.assertFalse(confirms_match(REPORT, {**FIXTURE, "date": "2026-11-20"}))
        self.assertFalse(confirms_match(REPORT, {**FIXTURE, "competition": "Coppa"}))
        self.assertFalse(confirms_match(REPORT, {**FIXTURE, "away": "Nomi"}))

    def test_real_two_column_result_and_u23_identifier(self):
        # Taken from the layout of CPA Trento C.U. 50/2026.
        row = ("ATHESIS CALCIO                        - CUS TRENTO U.23            3-1"
               "         BRENTA BORGO                          - BRENTA ORTIGARALEFRE    4-3")
        report = REPORT.replace("CUS TRENTO sq.B - SAN GIUSEPPE       2 - 4", row)
        report = report.replace("13/11/2026", "06/11/2026")
        match = {**FIXTURE, "home": "Athesis Calcio", "away": "CUS Trento U23",
                 "score": "3-1", "date": "2026-11-06"}
        self.assertTrue(confirms_match(report, match))
        self.assertFalse(confirms_match(report, {**match, "score": "4-3"}))
        self.assertFalse(confirms_match(report, {**match, "home": "Nomi"}))

    def test_serie_b_and_coppa_sections_ignored(self):
        text = REPORT.replace("CAMPIONATO CALCIO A 5 SERIE D", "CAMPIONATO CALCIO A 5 SERIE B")
        self.assertFalse(confirms_match(text, FIXTURE))
        self.assertEqual(list(sections(text)), [])

    def test_extract_only_serie_d_players(self):
        y, r = c_us_sanctions(REPORT, "2026-11-13")
        self.assertEqual(y, {"GRIPPA MICHELE", "BUDA SAMUELE"})
        self.assertEqual(r, {"BATTAGLIA EDOARDO"})
        self.assertNotIn("UN MISTER", y | r)

    def test_multiple_dates_in_one_serie_d_bulletin_do_not_mix_cards(self):
        other_date = (
            "GARE DEL 12/11/2026\n"
            "PROVVEDIMENTI DISCIPLINARI\n"
            "CALCIATORI NON ESPULSI\n"
            "AMMONIZIONE I INFR\n"
            "ZANROSSO MATTEO (CUS TRENTO U.23)\n"
        )
        report = REPORT.replace("GARE DEL 13/ 11/2026", other_date + "GARE DEL 13/ 11/2026")
        yellows, reds = c_us_sanctions(report, "2026-11-13")
        self.assertEqual(yellows, {"GRIPPA MICHELE", "BUDA SAMUELE"})
        self.assertEqual(reds, {"BATTAGLIA EDOARDO"})
        with self.assertRaises(ValueError):
            c_us_sanctions(report, "2026-11-10")

    def test_same_date_can_have_separate_disciplinary_blocks(self):
        extra_block = (
            "GARE DEL 13/11/2026\n"
            "PROVVEDIMENTI DISCIPLINARI\n"
            "CALCIATORI NON ESPULSI\n"
            "AMMONIZIONE I INFR\n"
            "ZANROSSO MATTEO (CUS TRENTO U.23)\n"
        )
        report = REPORT.replace("Pubblicato in Trento il 19/11/2026", extra_block + "Pubblicato in Trento il 19/11/2026")
        yellows, reds = c_us_sanctions(report, "2026-11-13")
        self.assertIn("ZANROSSO MATTEO", yellows)
        self.assertIn("BUDA SAMUELE", yellows)
        self.assertIn("BATTAGLIA EDOARDO", reds)

    def test_non_expelled_suspension_is_not_a_red_card(self):
        modified = REPORT.replace(
            "CALCIATORI NON ESPULSI\n",
            "CALCIATORI NON ESPULSI\n"
            "SQUALIFICA PER UNA GARA EFFETTIVA\n"
            "ZANROSSO MATTEO\n"
            "(CUS TRENTO U.23)\n",
        )
        cautions, reds = c_us_sanctions(modified, "2026-11-13")
        self.assertEqual(reds, {"BATTAGLIA EDOARDO"})
        self.assertNotIn("ZANROSSO MATTEO", cautions | reds)

    def test_preserve_existing_cards_and_double_yellow(self):
        match = copy.deepcopy(FIXTURE)
        match["yellowCardEvents"].append({"playerId": "battaglia-edoardo", "cards": 2})
        y, r = c_us_sanctions(REPORT, match["date"])
        self.assertTrue(add_verified_cards(match, ROSTER, y, r))
        self.assertIn({"playerId": "battaglia-edoardo", "cards": 2}, match["yellowCardEvents"])
        self.assertIn({"playerId": "battaglia-edoardo", "cards": 1}, match["redCardEvents"])
        self.assertIn({"playerId": "buda-samuele", "cards": 1}, match["yellowCardEvents"])
        self.assertFalse(add_verified_cards(match, ROSTER, y, r))

    def test_unknown_player_no_changes(self):
        match = copy.deepcopy(FIXTURE)
        with self.assertRaises(ValueError):
            add_verified_cards(match, ROSTER, {"UNKNOWN ATHLETE"}, set())
        self.assertEqual(match, FIXTURE)

    def test_only_fixture_card_fields_modified(self):
        match = copy.deepcopy(FIXTURE)
        before = copy.deepcopy(match)
        y, r = c_us_sanctions(REPORT, match["date"])
        add_verified_cards(match, ROSTER, y, r)
        for k in ["score", "scorerEvents", "lineup", "date", "competition", "home", "away"]:
            self.assertEqual(match[k], before[k])
        self.assertTrue(match["redCardEvents"])

    def test_cms_and_data_updated_but_coppa_not_touched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "content/cms").mkdir(parents=True)
            cup = {**copy.deepcopy(FIXTURE), "id": "cup", "competition": "Coppa"}
            docs = {"u21Fixtures": [cup, copy.deepcopy(FIXTURE)]}
            (root / "content/cms/u21-fixtures.json").write_text(json.dumps(docs), encoding="utf8")
            (root / "content/data.json").write_text(json.dumps({**docs, "roster": ROSTER}), encoding="utf8")
            self.assertTrue(update_site(root, [("https://example.org/official.pdf", REPORT)], True))
            cms = json.loads((root / "content/cms/u21-fixtures.json").read_text())
            data = json.loads((root / "content/data.json").read_text())
            self.assertEqual(cms["u21Fixtures"], data["u21Fixtures"])
            self.assertEqual(cms["u21Fixtures"][0], cup)
            self.assertFalse(update_site(root, [("https://example.org/official.pdf", REPORT)], True))

    def test_results_and_discipline_in_different_official_bulletins(self):
        # Results and justice decisions can be in two separate C.U. PDFs.
        result_only = REPORT.split("5. GIUSTIZIA SPORTIVA")[0]
        sanction_only = "5. GIUSTIZIA SPORTIVA" + REPORT.split("5. GIUSTIZIA SPORTIVA")[1]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "content/cms").mkdir(parents=True)
            fixture = copy.deepcopy(FIXTURE)
            cms = {"u21Fixtures": [fixture]}
            data = {"u21Fixtures": [copy.deepcopy(fixture)], "roster": ROSTER}
            (root / "content/cms/u21-fixtures.json").write_text(json.dumps(cms))
            (root / "content/data.json").write_text(json.dumps(data))
            reports = [("result-cu.pdf", result_only), ("justice-cu.pdf", sanction_only)]
            self.assertTrue(update_site(root, reports, True))
            published = json.loads((root / "content/data.json").read_text())
            self.assertEqual(published["u21Fixtures"][0]["redCardEvents"],
                             [{"playerId": "battaglia-edoardo", "cards": 1}])
            self.assertFalse(update_site(root, reports, True))

    def test_real_team_aliases_for_lagarina_and_alta_giudicarie(self):
        lagarina = {**FIXTURE, "home": "Lagarina Futsal",
                    "away": "CUS Trento U23", "score": "5-5"}
        lagarina_pdf = REPORT.replace(
            "CUS TRENTO sq.B - SAN GIUSEPPE       2 - 4",
            "LAGARINA FUTSAL ASD                 - CUS TRENTO U.23            5-5        OTHER CLUB                          - OTHER CLUB    1-1",
        )
        self.assertTrue(confirms_match(lagarina_pdf, lagarina))
        alta = {**FIXTURE, "home": "CUS Trento U23",
                "away": "Alta Giudicarie", "score": "2-3"}
        alta_pdf = REPORT.replace(
            "CUS TRENTO sq.B - SAN GIUSEPPE       2 - 4",
            "CUS TRENTO U.23                    - ALTA GIUDICARIE A.S.D.      2-3         OTHER CLUB                          - OTHER CLUB    1-1",
        )
        self.assertTrue(confirms_match(alta_pdf, alta))

    def test_missing_or_ambiguous_sanctions_fail_closed(self):
        with self.assertRaises(ValueError):
            c_us_sanctions("ALTRA COMPETIZIONE\nGARE DEL 13/11/2026", "2026-11-13")
        with self.assertRaises(ValueError):
            c_us_sanctions(REPORT + "\n" + REPORT, "2026-11-13")


if __name__ == "__main__":
    unittest.main()
