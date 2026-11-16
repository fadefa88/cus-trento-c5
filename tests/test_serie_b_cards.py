"""Offline regression tests: official Serie B cards must not corrupt the CMS."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.sync_serie_b_cards import (
    clean, match_player, confirms_result, match_date, match_dates,
    disciplinary_players, update_cards, reconcile,
)


BASE = """
Stagione Sportiva 2026/2027
Comunicato Ufficiale N. 999
4. RISULTATI GARE
CAMPIONATO NAZIONALE SERIE B MASCHILE
GIRONE: A
7/11/26 6/A CARDANO 91 SERMIG 4 - 3
GIRONE: B
7/11/26 6/A ATLETICO SESTU REAL BUBI MERANO C5 4 - 1
CUS TRENTO ELMAS C5 1 - 8
FUTSAL JESOLO CANOTTIERI BELLUNO C5 3 - 2
GIRONE: C
7/11/26 6/A ARZIGNANO CALCIO A5 C.U.S. ANCONA 3 - 4
5. Giustizia Sportiva
5.1.1. CAMPIONATO NAZIONALE SERIE B MASCHILE
GARE DEL 07/11/2026
PROVVEDIMENTI DISCIPLINARI
A CARICO DI ALLENATORI
AMMONIZIONE I infr
PIAZZA EMILIANO                   (CUS TRENTO)
A CARICO CALCIATORI ESPULSI DAL CAMPO
SQUALIFICA PER UNA GARA
PLAYER EXAMPLE                    (OTHER CLUB)
A CARICO CALCIATORI NON ESPULSI DAL CAMPO
SQUALIFICA PER UNA GARA PER RECIDIVA IN AMMONIZIONE V infr
TEST TEST                        (OTHER CLUB)
AMMONIZIONE CON DIFFIDA IV infr
OTHER PLAYER                     (OTHER CLUB)
AMMONIZIONE III infr
"""
DUMMY = "".join(f"TESTPLAYER{n} SURNAME{n}     (DUMMY TEAM)\n" for n in range(30))
ENDING = """
AMMONIZIONE I infr
CONTI DIEGO                       (CUS TRENTO)
BOI NICOLA                        (ELMAS C5)
Il Giudice Sportivo della Divisione Calcio a Cinque
"""
PDF = BASE + DUMMY + ENDING


class OfficialCardsTest(unittest.TestCase):
    def setUp(self):
        self.roster = [
            {"id": "18", "name": "Conti Diego"},
            {"id": "11", "name": "Zampedri Daniele"},
        ]
        self.fixture = {
            "id": "cus-trento-elmas-2026-11-07",
            "date": "2026-11-07",
            "home": "CUS Trento",
            "away": "Elmas",
            "competition": "Campionato",
            "status": "Terminata",
            "score": "1-8",
            "lineup": {"startingFive": ["18"], "bench": ["11"]},
            "opponentLineup": [
                {"surname": "Boi", "firstName": "Roberto", "yellow": True, "red": False},
                {"surname": "Boi", "firstName": "Nicola", "yellow": False, "red": False},
            ],
            "yellowCardEvents": [{"playerId": "18", "cards": 1}],
            "redCardEvents": [],
        }

    def test_result_requires_exact_teams_and_score(self):
        self.assertTrue(confirms_result(PDF, self.fixture))
        self.assertEqual(match_date(PDF), "2026-11-07")
        self.assertFalse(confirms_result(PDF, {**self.fixture, "score": "1-7"}))
        self.assertFalse(confirms_result(PDF, {**self.fixture, "away": "Atletico Sestu"}))

    def test_two_day_bulletin_dates(self):
        bulletin = PDF.replace("GARE DEL 07/11/2026", "GARE DEL 06-07/11/2026")
        self.assertEqual(match_dates(bulletin), {"2026-11-06", "2026-11-07"})
        self.assertEqual(match_date(bulletin), "2026-11-07")

    def test_manzano_official_prefix(self):
        manzano = {
            **self.fixture,
            "away": "Manzano BRN 1988",
            "score": "3-6",
        }
        report = PDF.replace(
            "CUS TRENTO ELMAS C5 1 - 8",
            "CUS TRENTO C5 MANZANO BRN 1988 3 - 6",
        )
        self.assertTrue(confirms_result(report, manzano))

    def test_all_players_and_no_coaches(self):
        caution, red = disciplinary_players(PDF)
        self.assertIn(("CONTI DIEGO", "CUS TRENTO"), caution)
        self.assertIn(("BOI NICOLA", "ELMAS C5"), caution)
        self.assertNotIn(("PIAZZA EMILIANO", "CUS TRENTO"), caution)
        self.assertNotIn(("PIAZZA EMILIANO", "CUS TRENTO"), red)

    def test_two_boi_players_disambiguated_and_idempotent(self):
        caution, red = disciplinary_players(PDF)
        self.assertTrue(update_cards(self.fixture, self.roster, caution, red))
        self.assertFalse(self.fixture["opponentLineup"][0]["yellow"])
        self.assertTrue(self.fixture["opponentLineup"][1]["yellow"])
        self.assertEqual(self.fixture["yellowCardEvents"], [{"playerId": "18", "cards": 1}])
        self.assertFalse(update_cards(self.fixture, self.roster, caution, red))

    def test_unmatched_official_name_is_safe(self):
        caution, red = disciplinary_players(PDF)
        caution.add(("UNKNOWN ATHLETE", "CUS TRENTO"))
        original = copy.deepcopy(self.fixture)
        with self.assertRaisesRegex(ValueError, "unique lineup matches"):
            update_cards(self.fixture, self.roster, caution, red)
        self.assertEqual(self.fixture, original)

    def test_coppa_left_alone_and_two_json_files_aligned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "content/cms").mkdir(parents=True)
            cup = copy.deepcopy(self.fixture)
            cup["competition"] = "Coppa"
            cup["id"] = "cup-fixture"
            data = {"fixtures": [cup, copy.deepcopy(self.fixture)], "roster": self.roster}
            cms = {"fixtures": [copy.deepcopy(cup), copy.deepcopy(self.fixture)]}
            (root / "content/data.json").write_text(json.dumps(data), encoding="utf8")
            (root / "content/cms/fixtures.json").write_text(json.dumps(cms), encoding="utf8")
            reports = [({"number": 999}, PDF)]
            self.assertEqual(len(reconcile(root, reports, True)), 1)
            after = json.loads((root / "content/cms/fixtures.json").read_text(encoding="utf8"))
            public = json.loads((root / "content/data.json").read_text(encoding="utf8"))
            self.assertEqual(after["fixtures"][0], cup)
            self.assertEqual(after["fixtures"], public["fixtures"])
            self.assertEqual(reconcile(root, reports, True), [])

    def test_name_order_is_not_assumed(self):
        self.assertEqual(match_player("MONTEIRO AUGUSTO THYAGO", [("21", "Thyago Augusto Monteiro")]), "21")

    def test_unreadable_pdf_fails_closed(self):
        with self.assertRaises(ValueError):
            disciplinary_players("no disciplinary section")
        with self.assertRaises(ValueError):
            disciplinary_players("A CARICO CALCIATORI NON ESPULSI DAL CAMPO\nAMMONIZIONE I infr\nCONTI DIEGO (CUS TRENTO)")

    def test_real_world_fixture_has_not_been_modified(self):
        # This script only changes cards: match identity, times, and goals remain immutable.
        caution, red = disciplinary_players(PDF)
        self.fixture["score"] = "1-8"
        self.fixture["opponentLineup"][1]["goals"] = 2
        self.fixture["opponentLineup"][1]["goalTimes"] = [{"time": "4’16” st"}]
        original = copy.deepcopy(self.fixture)
        update_cards(self.fixture, self.roster, caution, red)
        self.assertEqual(self.fixture["score"], original["score"])
        self.assertEqual(self.fixture["opponentLineup"][1]["goalTimes"], original["opponentLineup"][1]["goalTimes"])
        self.assertEqual(self.fixture["opponentLineup"][1]["goals"], original["opponentLineup"][1]["goals"])


if __name__ == "__main__":
    unittest.main()
