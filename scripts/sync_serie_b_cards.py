#!/usr/bin/env python3
"""Daily official Serie B disciplinary sync for CUS Trento first-team league fixtures.

A match is eligible only if the official Girone B results confirm both teams,
score and date. Unrecognized names or PDF layouts are skipped without edits.
Coppa, youth matches, staff sanctions and other statistics are never touched.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = "https://divisionecalcioa5.it/categoria-comunicati/serie-b/"
UA = "CUS-Trento-C5 disciplinary-sync/1.0 (public official bulletins)"
ALIASES = {
    "CUS Trento": ["CUS TRENTO"],
    "Futsal Villorba": ["FUTSAL VILLORBA A R.L.", "FUTSAL VILLORBA"],
    "Manzano BRN 1988": ["MANZANO BRN 1988"],
    "Atletico Sestu": ["ATLETICO SESTU"],
    "Canottieri Belluno": ["CANOTTIERI BELLUNO C5"],
    "Real Bubi Merano": ["REAL BUBI MERANO C5"],
    "Elmas": ["ELMAS C5"],
    "Futsal Atesina": ["FUTSAL ATESINA"],
    "Jesolo": ["FUTSAL JESOLO"],
    "Eagles": ["EAGLES FUTSAL"],
    "ConeglianoMontello": ["FUTSAL CONEGLIANOMONTELLO C5"],
    "Trento": ["AC TRENTO 1921 S.R.L."],
}
PLAYER_LINE = re.compile(r"^\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9 .'\-’]+?)\s+\(([^()]+)\)\s*$")
SCORE_LINE = re.compile(r"(\d+)\s*[-:]\s*(\d+)\s*$")


def clean(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return " ".join(re.findall(r"[A-Z0-9]+", value.upper()))


def alias(team: str) -> list[str]:
    return ALIASES.get(team, [team.upper()])


def discover(session, pages=4, limit=8):
    candidates = {}
    successes = 0
    for page in range(1, pages + 1):
        url = ARCHIVE + f"?tcpg={page}"
        try:
            response = session.get(url, timeout=30, headers={"User-Agent": UA})
            response.raise_for_status()
            successes += 1
        except requests.RequestException as exc:
            print(f"::warning::Archive unavailable ({page}): {exc}", flush=True)
            continue
        for tag in BeautifulSoup(response.text, "html.parser").select("a[href]"):
            title = " ".join(tag.get_text(" ", strip=True).split())
            pdf = urljoin(url, tag["href"])
            if re.search(r"errata\s+corrige.*serie\s+b", title, re.I):
                print(f"::warning::Official errata requires manual review: {title} {pdf}")
            if not re.search(r"omologazione.*serie\s+b\s+maschile", title, re.I):
                continue
            parsed = urlparse(pdf)
            if (parsed.scheme != "https" or parsed.netloc != "divisionecalcioa5.it"
                    or not parsed.path.lower().endswith(".pdf")):
                continue
            number = re.search(r"Comunicato.Ufficiale.(\d+)", parsed.path, re.I)
            if number:
                candidates[pdf] = {"url": pdf, "title": title, "number": int(number.group(1))}
    if not successes:
        raise RuntimeError("Official Serie B archive unavailable; no modifications made")
    return sorted(candidates.values(), key=lambda b: b["number"], reverse=True)[:limit]


def pdf_text(session, url):
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.netloc != "divisionecalcioa5.it"
            or not parsed.path.startswith("/wp-content/uploads/")
            or not parsed.path.lower().endswith(".pdf")):
        raise ValueError("PDF source is not an allowed official bulletin")
    response = session.get(url, timeout=50, headers={"User-Agent": UA, "Accept": "application/pdf"})
    response.raise_for_status()
    if not response.content.startswith(b"%PDF") or len(response.content) > 10_000_000:
        raise ValueError("Missing PDF signature or file larger than 10MB")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "comunicato.pdf"
        src.write_bytes(response.content)
        result = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(src), "-"],
            text=True, capture_output=True, check=True, timeout=45,
        )
    return result.stdout.replace("\u00a0", " ")


def player_line(line):
    match = PLAYER_LINE.match(line)
    return (clean(match[1]), clean(match[2])) if match else None


def disciplinary_players(text):
    red = re.search(r"A\s+CARICO\s+(?:DI\s+)?CALCIATORI\s+ESPULSI\s+DAL\s+CAMPO", text, re.I)
    nonred = re.search(r"A\s+CARICO\s+(?:DI\s+)?CALCIATORI\s+NON\s+ESPULSI\s+DAL\s+CAMPO", text, re.I)
    if not nonred:
        raise ValueError("No non-expelled players section: unsafe PDF layout")
    red_rows = text[red.end():nonred.start()].splitlines() if red and red.start() < nonred.start() else []
    reds = {x for row in red_rows if (x := player_line(row))}
    yellow_tail = text[nonred.end():]
    signature = re.search(r"^\s*Il Giudice Sportivo\b", yellow_tail, re.I | re.M)
    if signature:
        yellow_tail = yellow_tail[:signature.start()]
    yellows = set()
    caution_section = False
    for row in yellow_tail.splitlines():
        heading = clean(row)
        if re.match(r"^AMMONIZIONE\b", heading):
            caution_section = True
        elif re.match(r"^SQUALIFICA\b", heading):
            caution_section = "RECIDIVA IN AMMONIZIONE" in heading
        elif re.match(r"^A CARICO\b", heading):
            caution_section = False
        if caution_section and (entry := player_line(row)):
            yellows.add(entry)
    if len(yellows) < 20:
        raise ValueError(f"Too few yellow card entries ({len(yellows)}): unsafe extraction")
    return yellows, reds


def match_date(text):
    hit = re.search(r"\bGARE\s+DEL\s+(\d{1,2})/(\d{1,2})/(\d{4})", text, re.I)
    return f"{int(hit[3]):04d}-{int(hit[2]):02d}-{int(hit[1]):02d}" if hit else ""


def confirms_result(text, fixture):
    start = re.search(r"\bGIRONE\s*:\s*B\b", text, re.I)
    if not start:
        return False
    after = text[start.end():]
    end = re.search(r"\bGIRONE\s*:\s*C\b", after, re.I)
    section = after[:end.start()] if end else after[:4500]
    for line in section.splitlines():
        score = SCORE_LINE.search(line)
        if not score or f"{score[1]}-{score[2]}" != str(fixture.get("score", "")).replace(" ", ""):
            continue
        left = re.sub(r"^\s*\d{1,2}/\d{1,2}/\d{2,4}\s+\d+/[AR]\s+", "", line[:score.start()], flags=re.I)
        if any(clean(left) == clean(home + " " + away)
               for home in alias(fixture["home"]) for away in alias(fixture["away"])):
            return True
    return False


def match_player(pdf_name, player_options):
    target = Counter(clean(pdf_name).split())
    matching = [ident for ident, name in player_options if Counter(clean(name).split()) == target]
    if len(matching) != 1:
        raise ValueError(f"Player name {pdf_name}: {len(matching)} unique lineup matches")
    return matching[0]


def update_cards(fixture, roster, yellows, reds):
    home_cus = clean(fixture.get("home")) == "CUS TRENTO"
    if not (home_cus or clean(fixture.get("away")) == "CUS TRENTO"):
        raise ValueError("Fixture is not CUS Trento")
    opponent = fixture["away"] if home_cus else fixture["home"]
    opponent_alias = {clean(value) for value in alias(opponent)}
    cus_y = {name for name, team in yellows if team == "CUS TRENTO"}
    cus_r = {name for name, team in reds if team == "CUS TRENTO"}
    opp_y = {name for name, team in yellows if team in opponent_alias}
    opp_r = {name for name, team in reds if team in opponent_alias}
    lineup = fixture.get("lineup") or {}
    called = {str(x) for x in (lineup.get("startingFive") or []) + (lineup.get("bench") or [])}
    own_options = [(str(p["id"]), str(p.get("name") or "")) for p in roster if str(p["id"]) in called]
    other_options = [
        (i, f"{p.get('surname', '')} {p.get('firstName', '')}")
        for i, p in enumerate(fixture.get("opponentLineup") or [])
    ]
    if not own_options or not other_options:
        raise ValueError("Missing lineup; cannot safely associate all cards")
    # Resolve all names before modifying even the first player.
    own_y = {match_player(name, own_options) for name in cus_y}
    own_r = {match_player(name, own_options) for name in cus_r}
    other_y = {match_player(name, other_options) for name in opp_y}
    other_r = {match_player(name, other_options) for name in opp_r}
    if own_y & own_r or other_y & other_r:
        raise ValueError("Same player shown as both cautioned and expelled")
    changed = False
    for field, desired in (("yellowCardEvents", own_y), ("redCardEvents", own_r)):
        current = fixture.get(field) or []
        ids = {str(e.get("playerId")) for e in current}
        new = [e for e in current if str(e.get("playerId")) in desired]
        new.extend({"playerId": key, "cards": 1} for key in sorted(desired - ids))
        if new != current:
            fixture[field] = new
            changed = True
    for index, p in enumerate(fixture["opponentLineup"]):
        for field, value in (("yellow", index in other_y), ("red", index in other_r)):
            if bool(p.get(field)) != value:
                p[field] = value
                changed = True
    return changed


def reconcile(root, reports, apply):
    cms_path = root / "content/cms/fixtures.json"
    site_path = root / "content/data.json"
    cms = json.loads(cms_path.read_text(encoding="utf-8"))
    site = json.loads(site_path.read_text(encoding="utf-8"))
    changes = []
    for bulletin, text in sorted(reports, key=lambda row: row[0]["number"]):
        day = match_date(text)
        matches = [
            f for f in cms["fixtures"]
            if f.get("competition") == "Campionato" and f.get("status") == "Terminata"
            and f.get("score") and f.get("date") == day and confirms_result(text, f)
            and ("CUS Trento" in (f.get("home"), f.get("away")))
        ]
        if not matches:
            continue
        if len(matches) != 1:
            print(f"::warning::C.U. {bulletin['number']}: ambiguous fixture, skipped")
            continue
        fixture = matches[0]
        try:
            yellow, red = disciplinary_players(text)
            preview = json.loads(json.dumps(fixture))
            update_cards(preview, site["roster"], yellow, red)
        except ValueError as exc:
            print(f"::warning::C.U. {bulletin['number']} / {fixture['id']} skipped: {exc}")
            continue
        other = next((m for m in site["fixtures"] if m.get("id") == fixture["id"]), None)
        if other is None or other.get("score") != fixture["score"]:
            raise ValueError("CMS and public fixture do not match; aborting without writes")
        cms_changed = update_cards(fixture, site["roster"], yellow, red)
        public_changed = update_cards(other, site["roster"], yellow, red)
        if cms_changed or public_changed:
            changes.append(f"C.U. {bulletin['number']}: {fixture['home']} - {fixture['away']}, {fixture['score']}")
    if changes and apply:
        cms_path.write_text(json.dumps(cms, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        site_path.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--apply", action="store_true", help="Write confirmed changes")
    args = parser.parse_args()
    with requests.Session() as session:
        bulletins = discover(session)
        print(f"Official Serie B homologation bulletins: {len(bulletins)}", flush=True)
        if not bulletins:
            raise RuntimeError("No official homologation bulletin; refusing silent success")
        reports = []
        for bulletin in bulletins:
            try:
                reports.append((bulletin, pdf_text(session, bulletin["url"])))
            except (requests.RequestException, subprocess.SubprocessError, ValueError) as exc:
                print(f"::warning::C.U. {bulletin['number']} unavailable: {exc}", flush=True)
        if not reports:
            raise RuntimeError("No PDF could be extracted; refusing silent success")
    changes = reconcile(args.root, reports, args.apply)
    for detail in changes:
        print(("APPLIED " if args.apply else "WOULD APPLY ") + detail)
    print(f"Verified disciplinary changes: {len(changes)}", flush=True)


if __name__ == "__main__":
    main()
