#!/usr/bin/env python3
"""
Aggiorna automaticamente le classifiche CUS Trento C5 da SporTrentino.

Sorgenti:
- Prima squadra / Serie C1: https://calcioa5.sportrentino.it/camp_classifica.asp?pf=422&f=3562
- Under 21 / Serie D Girone B: https://calcioa5.sportrentino.it/camp_classifica.asp?pf=422&f=3565

Scrive in content/data.json:
- standings
- u21Standings

Non usa database. Lo script è pensato per GitHub Actions.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

SOURCES = {
    "standings": "https://calcioa5.sportrentino.it/camp_classifica.asp?pf=422&f=3562",
    "u21Standings": "https://calcioa5.sportrentino.it/camp_classifica.asp?pf=422&f=3565",
}

BASE_URL = "https://calcioa5.sportrentino.it/"


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


def to_int(value: str) -> int:
    value = clean_text(str(value)).replace(".", "").replace(",", ".")
    m = re.search(r"-?\d+", value)
    return int(m.group(0)) if m else 0


def normalize_team_name(name: str) -> str:
    return clean_text(name).upper()


def fetch_html(url: str) -> str:
    response = requests.get(
        url,
        timeout=30,
        headers={
            "User-Agent": "CUS-Trento-C5-StandingsUpdater/1.0 (+https://custrentocalcioa5.it)"
        },
    )
    response.raise_for_status()
    if not response.encoding or response.encoding.lower() == "iso-8859-1":
        response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def looks_like_standings_row(values: list[str]) -> bool:
    if len(values) < 9:
        return False
    if not re.fullmatch(r"\d+", values[0]):
        return False
    # Dopo la squadra devono esserci almeno: Pt, G, V, N, P, Gf, Gs.
    nums = [v for v in values[2:] if re.fullmatch(r"-?\d+(?:[,.]\d+)?", v)]
    return len(nums) >= 7


def parse_row_from_tr(tr: Tag) -> dict[str, Any] | None:
    raw_values = [clean_text(x) for x in tr.stripped_strings if clean_text(x)]
    if not raw_values or not re.fullmatch(r"\d+", raw_values[0]):
        return None

    # Prende il nome squadra dal primo link utile nella riga.
    team = ""
    for a in tr.find_all("a"):
        txt = clean_text(a.get_text(" ", strip=True))
        href = a.get("href") or ""
        if txt and not txt.lower() in {"ultima", "calendario", "classifica", "incroci", "organici", "marcatori"}:
            team = txt
            break

    if not team:
        # Fallback: posizione, squadra, numeri...
        # Cerca il primo token non numerico dopo la posizione.
        for value in raw_values[1:]:
            if not re.fullmatch(r"-?\d+(?:[,.]\d+)?", value):
                team = value
                break

    if not team:
        return None

    # I numeri dopo il nome squadra sono:
    # Pt, G, V, N, P, Gf, Gs, poi dati casa/trasferta ecc.
    try:
        team_index = raw_values.index(team)
    except ValueError:
        team_index = 1

    numeric_values = [v for v in raw_values[team_index + 1 :] if re.fullmatch(r"-?\d+(?:[,.]\d+)?", v)]
    if len(numeric_values) < 7:
        return None

    logo = ""
    img = tr.find("img")
    if img and img.get("src"):
        logo = urljoin(BASE_URL, img.get("src") or "")

    return {
        "g": to_int(numeric_values[1]),
        "logo": logo,
        "gs": to_int(numeric_values[6]),
        "n": to_int(numeric_values[3]),
        "pts": to_int(numeric_values[0]),
        "p": to_int(numeric_values[4]),
        "pos": to_int(raw_values[0]),
        "v": to_int(numeric_values[2]),
        "team": normalize_team_name(team),
        "gf": to_int(numeric_values[5]),
    }


def parse_rows_from_text(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """Fallback quando il markup tabellare cambia o viene appiattito."""
    text = clean_text(soup.get_text(" ", strip=True))
    start = text.find("Classifica Squadra Pt")
    end = text.find("Pt=Punti", start)
    if start == -1 or end == -1:
        return []

    chunk = text[start:end]
    # Righe tipo: 1 Calcio Bleggio 60 26 20 0 6 185 114 ...
    pattern = re.compile(
        r"(?:^|\s)(\d{1,2})\s+(.+?)\s+"
        r"(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+"
        r"\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+",
        re.I,
    )
    rows: list[dict[str, Any]] = []
    for m in pattern.finditer(chunk):
        team = clean_text(m.group(2))
        # Evita di mangiare intestazioni residue.
        team = re.sub(r"^.*?Gs\s+", "", team).strip()
        rows.append(
            {
                "g": to_int(m.group(4)),
                "logo": "",
                "gs": to_int(m.group(9)),
                "n": to_int(m.group(6)),
                "pts": to_int(m.group(3)),
                "p": to_int(m.group(7)),
                "pos": to_int(m.group(1)),
                "v": to_int(m.group(5)),
                "team": normalize_team_name(team),
                "gf": to_int(m.group(8)),
            }
        )
    return rows


def parse_standings(html_text: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html_text, "html.parser")
    rows: list[dict[str, Any]] = []
    seen_positions: set[int] = set()

    for tr in soup.find_all("tr"):
        parsed = parse_row_from_tr(tr)
        if not parsed:
            continue
        pos = int(parsed.get("pos") or 0)
        if pos <= 0 or pos in seen_positions:
            continue
        seen_positions.add(pos)
        rows.append(parsed)

    if not rows:
        rows = parse_rows_from_text(soup)

    rows = sorted(rows, key=lambda item: int(item.get("pos") or 9999))
    if not rows:
        raise ValueError("Nessuna riga classifica trovata nella pagina SporTrentino")
    return rows


def preserve_missing_logos(new_rows: list[dict[str, Any]], old_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    old_by_team = {normalize_team_name(str(row.get("team", ""))): row for row in old_rows}
    for row in new_rows:
        key = normalize_team_name(str(row.get("team", "")))
        if not row.get("logo") and key in old_by_team:
            row["logo"] = old_by_team[key].get("logo", "")
    return new_rows


def update_data(data_path: Path) -> bool:
    data = json.loads(data_path.read_text(encoding="utf-8"))
    changed = False

    for key, url in SOURCES.items():
        print(f"Updating {key} from {url}", flush=True)
        html_text = fetch_html(url)
        new_rows = parse_standings(html_text)
        new_rows = preserve_missing_logos(new_rows, data.get(key, []))
        print(f"  rows parsed: {len(new_rows)}", flush=True)

        if data.get(key) != new_rows:
            data[key] = new_rows
            changed = True

    if changed:
        data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="content/data.json", help="Path to content/data.json")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"ERROR: file not found: {data_path}", file=sys.stderr)
        return 1

    changed = update_data(data_path)
    if changed:
        print("Standings updated.", flush=True)
    else:
        print("No standings changes.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
