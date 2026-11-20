#!/usr/bin/env python3
"""Verify CUS Trento U23 Serie D cards in CPA Trento official PDFs.

Only confirmed CUS U23 league fixtures are eligible. Never change Coppa,
first-team games, scores, player counts, or other match fields.
Official reports can omit details of a second yellow, so existing card counts
are preserved. Any ambiguous document/athlete is rejected without changing it.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import tempfile
import unicodedata
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = "https://www.figctrento.it/index.php/category/comunicati-ufficiali/"
USER_AGENT = "Mozilla/5.0 (compatible; CUSTRENTO-Futsal-Audit/1.0)"
CURRENT_SEASON = "2026/2027"
CUS_NAMES = {"CUS TRENTO SQ B", "CUS TRENTO U23", "CUS TRENTO"}
TEAM_ALIASES = {
    "San Floriano 2025": ["SAN FLORIANO 2025", "SAN FLORIANO 2025 A S D", "SAN FLORIANO"],
    "San Floriano": ["SAN FLORIANO 2025", "SAN FLORIANO 2025 A S D", "SAN FLORIANO"],
    "Calcio Bleggio": ["CALCIO BLEGGIO"],
    "Lagarina Futsal": ["LAGARINA FUTSAL"],
    "Alta Giudicarie": ["ALTA GIUDICARIE"],
    "Ledrense": ["LEDRENSE"],
    "Settaurense 1934": ["SETTAURENSE 1934", "SETTAURENSE"],
    "Settaurense": ["SETTAURENSE 1934", "SETTAURENSE"],
    "Athesis Calcio": ["ATHESIS CALCIO"],
    "San Giuseppe": ["SAN GIUSEPPE"],
    "Nomi": ["NOMI"],
}
SCORE = re.compile(r"(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$")
DATE = re.compile(r"(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(20\d{2})")
U23_PREFIX = re.compile(r"^CAMPIONATO(?:\s+(?:DI|NAZIONALE))?\s+CALCIO\s+A\s*5\s+(?:TRENTO\s+)?SERIE\s+D\b", re.I)


def norm(text):
    text = unicodedata.normalize("NFKD", str(text or "").upper())
    return " ".join(re.findall(r"[A-Z0-9]+", "".join(c for c in text if not unicodedata.combining(c))))


def club_options(name):
    if name == "CUS Trento U23":
        return CUS_NAMES
    return {norm(x) for x in TEAM_ALIASES.get(name, [name])}


def parse_day(source):
    m = DATE.search(source)
    if not m:
        return ""
    try:
        return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return ""


def is_official_pdf(url):
    p = urlparse(url)
    return p.scheme == "https" and p.netloc in {"www.figctrento.it", "figctrento.it"} and (
        "/wp-content/uploads/" in p.path or "/documenti/comunicati/" in p.path
    ) and p.path.lower().endswith(".pdf") and bool(re.search(r"\bCU[_-]\d+", p.path, re.I))


def season_path(url):
    # The official archive spans seasons; CU 145 from June 2026 must not
    # outrank CU 28 from September 2026 just because its number is greater.
    return bool(re.search(r"/(?:2026/(?:07|08|09|10|11|12)|2027/(?:01|02|03|04|05|06))/", url))


def discover(session, pages=5, max_docs=16):
    """Find real 2026/27 Trento bulletins, not nationwide Serie D football."""
    candidates = set()
    articles = []
    pages_read = 0
    for page in range(1, pages + 1):
        target = ARCHIVE if page == 1 else urljoin(ARCHIVE, f"page/{page}/")
        try:
            response = session.get(target, timeout=25, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"::warning::CPA Trento archive page {page} unavailable: {exc}", flush=True)
            continue
        pages_read += 1
        soup = BeautifulSoup(response.text, "html.parser")
        for link in soup.select("a[href]"):
            url = urljoin(target, link["href"])
            if is_official_pdf(url) and season_path(url):
                candidates.add(url)
            label = norm(link.get_text(" ", strip=True))
            if (re.search(r"/2026/(?:09|10|11|12)/", url) and
                (re.search(r"\bC\s*U\b", label) or re.search(r"\bc-u-n-", url, re.I)) and
                urlparse(url).netloc in {"www.figctrento.it", "figctrento.it"} and
                url not in articles):
                articles.append(url)
    if not pages_read:
        raise RuntimeError("No official CPA Trento archive page accessible")
    for target in articles[:max_docs * 2]:
        try:
            response = session.get(target, timeout=25, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"::warning::Official article unavailable: {exc}", flush=True)
            continue
        for a in BeautifulSoup(response.text, "html.parser").select("a[href]"):
            url = urljoin(target, a["href"])
            if is_official_pdf(url) and season_path(url):
                candidates.add(url)
    ranked = sorted(candidates, key=lambda url: (
        urlparse(url).path.split("/wp-content/uploads/")[-1][:7],
        int(re.search(r"CU[_-](\d+)", url, re.I)[1]),
        url
    ), reverse=True)
    if ranked:
        match = re.search(r"/(2026|2027)/(\d{2})/", ranked[0])
        if match and (date.today() - date(int(match[1]), int(match[2]), 1)).days > 70:
            print("::warning::CPA Trento public archive appears stale; cannot validate latest Serie D matches", flush=True)
    return ranked[:max_docs]


def pdf_text(session, url):
    if not is_official_pdf(url):
        raise ValueError("Non-official PDF URL")
    response = session.get(url, timeout=40, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    if not response.content.startswith(b"%PDF") or len(response.content) > 12_000_000:
        raise ValueError("Unexpected PDF size/signature")
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "bulletin.pdf"
        file.write_bytes(response.content)
        outcome = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(file), "-"],
            check=True, capture_output=True, text=True, timeout=45,
        )
    result = outcome.stdout.replace("\u00a0", " ")
    # pdftotext -layout can add thousands of blank padding characters to
    # the first page. Inspect the first 12k characters, not just the first 1.7k.
    first_page = norm(result[:12000])
    if not re.search(r"STAGIONE SPORTIVA\\s+202\\s*6\\s+2027\\b", first_page):
        raise ValueError(f"Not a 2026/27 Trento bulletin. Season markers: {re.findall(r'STAGIONE SPORTIVA.{0,32}', first_page)[:2]!r}")
    if "COMITATO PROVINCIALE AUTONOMO DI TRENTO" not in first_page:
        raise ValueError("Missing CPA Trento official identification")
    return result


def sections(text):
    """Keep Serie D futsal blocks separate from youth, Coppa and all football leagues."""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if U23_PREFIX.match(line.strip()):
            # Block ends when a different competition/section starts.
            stop = index + 1
            while stop < len(lines):
                n = norm(lines[stop])
                if (re.match(r"^(?:CAMPIONATO|COPPA|TORNEO) ", n) or
                    re.match(r"^(?:GIUSTIZIA SPORTIVA|LEGENDA|PUBBLICATO IN TRENTO|DECISIONI DEL GIUDICE SPORTIVO)", n)):
                    break
                stop += 1
            yield "\n".join(lines[index:stop])


def official_result_dates(section):
    # Multiple match dates may appear in weekly bulletins.
    return {
        parse_day(match.group(1))
        for match in re.finditer(
            r"RISULTATI\s+UFFICIALI\s+GARE\s+DEL\s+(\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2})",
            section, re.I
        )
        if parse_day(match.group(1))
    }


def confirms_match(text, match):
    if match.get("competition") != "Campionato" or match.get("status") != "Terminata":
        return False
    if match.get("score") is None or "CUS Trento U23" not in (match.get("home"), match.get("away")):
        return False
    # Match must appear explicitly in the Serie D futsal results, with a compatible date.
    score = str(match["score"]).replace(" ", "").replace(":", "-")
    for section in sections(text):
        if "RISULTATI UFFICIALI" not in norm(section):
            continue
        dates = official_result_dates(section)
        if not dates or match["date"] not in dates:
            continue
        for line in section.splitlines():
            m = SCORE.search(line)
            if not m or f"{m[1]}-{m[2]}" != score:
                continue
            lhs = re.sub(r"^\s*(?:\d+\s*[aArR]\s+)?", "", line[:m.start()]).strip()
            if " - " not in lhs:
                continue
            first, second = lhs.split(" - ", 1)
            if norm(first) in club_options(match["home"]) and norm(second) in club_options(match["away"]):
                return True
    return False


def sanction_date(section):
    for m in re.finditer(r"GARE\s+DEL\s+(\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2})", section, re.I):
        day = parse_day(m[1])
        if day:
            return day
    return ""


def c_us_sanctions(text, match_day):
    """Read names from 'CALCIATORI ESPULSI/NON ESPULSI' only; no coach sanctions.

    Name and club can occupy separate lines. Count and type of each individual
    yellow cannot always be deduced from a disciplinary bulletin, so additions
    are one card unless the existing CMS already records double-yellow.
    """
    groups = [part for part in sections(text)
              if "PROVVEDIMENTI DISCIPLINARI" in norm(part) and sanction_date(part) == match_day]
    if len(groups) != 1:
        raise ValueError(f"Expected one Serie D disciplinary section for {match_day}, got {len(groups)}")
    text = groups[0]
    if "CALCIATORI" not in norm(text):
        raise ValueError("Missing disciplinary player headers")
    state = None
    subsection = None
    yellow, red = set(), set()
    pending = ""
    for line in text.splitlines():
        row = norm(line)
        if re.match(r"^CALCIATORI ESPULSI\b", row):
            state, subsection, pending = "red", None, ""
            continue
        if re.match(r"^CALCIATORI NON ESPULSI\b", row):
            state, subsection, pending = "yellow", None, ""
            continue
        if re.match(r"^(?:DIRIGENTI|ALLENATORI|SOCIETA)\b", row):
            state, subsection, pending = None, None, ""
            continue
        if "AMMONIZIONE" in row and re.match(r"^(?:(?:I|II|III|IV|V|VI|\d+)\s+)?AMMONIZIONE\b", row):
            subsection, pending = "yellow", ""
            continue
        if re.match(r"^SQUALIFICA\b", row):
            subsection, pending = ("yellow" if "RECIDIVITA IN AMMONIZIONE" in row else "red"), ""
            continue
        if row.startswith("PROVVEDIMENTI DISCIPLINARI"):
            state = None
            continue
        if not state:
            continue
        if re.match(r"^\s*\(\s*[^()]+\s*\)\s*$", line):
            club = norm(line.strip()[1:-1])
            if club in CUS_NAMES and pending and subsection:
                (yellow if subsection == "yellow" else red).add(pending)
            pending = ""
            continue
        combined = re.match(r"^\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý '\-.]+?)\s+\(([^()]+)\)\s*$", line)
        if combined:
            if norm(combined[2]) in CUS_NAMES and subsection:
                (yellow if subsection == "yellow" else red).add(norm(combined[1]))
            pending = ""
            continue
        # A standalone uppercase player name is followed by a club in parentheses.
        if re.fullmatch(r"[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý '\-.]{4,}", line.strip()) and not row.startswith((
            "CALCIATORI", "SQUALIFICA", "AMMONIZIONE", "PROVVEDIMENTI", "IN BASE", "GARE", "GIRONE"
        )):
            pending = norm(line)
    if not ("CALCIATORI ESPULSI" in norm(text) or "CALCIATORI NON ESPULSI" in norm(text)):
        raise ValueError("No player discipline headings")
    return yellow, red


def resolve_player(official_name, roster, called):
    matches = [str(p["id"]) for p in roster if str(p["id"]) in called
               and Counter(norm(p.get("name", "")).split()) == Counter(norm(official_name).split())]
    if len(matches) != 1:
        raise ValueError(f"Cannot uniquely identify CUS U23 player {official_name!r}: {len(matches)} matches")
    return matches[0]


def add_verified_cards(match, roster, yellows, reds):
    if match.get("competition") != "Campionato" or "CUS Trento U23" not in (match.get("home"), match.get("away")):
        raise ValueError("Not a CUS Under 23 league fixture")
    lineup = match.get("lineup") or {}
    called = {str(v) for v in (lineup.get("startingFive") or []) + (lineup.get("bench") or [])}
    if not called:
        raise ValueError("Missing U23 lineup")
    yellow_ids = {resolve_player(n, roster, called) for n in yellows}
    red_ids = {resolve_player(n, roster, called) for n in reds}
    # This is additive only: never remove manually entered cards or double-yellow events.
    changed = False
    for key, ids in (("yellowCardEvents", yellow_ids), ("redCardEvents", red_ids)):
        current = match.get(key) or []
        existing = {str(e.get("playerId")) for e in current}
        for ident in sorted(ids - existing):
            current.append({"playerId": ident, "cards": 1})
            changed = True
        if changed:
            match[key] = current
    return changed


def update_site(root, reports, apply=False):
    cms_path = root / "content/cms/u21-fixtures.json"
    data_path = root / "content/data.json"
    cms = json.loads(cms_path.read_text(encoding="utf-8"))
    site = json.loads(data_path.read_text(encoding="utf-8"))
    roster = site["roster"]
    changed_matches = set()
    for bulletin, raw in reports:
        matching = [m for m in cms["u21Fixtures"] if confirms_match(raw, m)]
        if len(matching) > 1:
            print(f"::warning::Ambiguous CUS Under 23 matches in {bulletin}; skipped", flush=True)
            continue
        if not matching:
            continue
        m = matching[0]
        try:
            yellows, reds = c_us_sanctions(raw, m["date"])
            preview = copy.deepcopy(m)
            add_verified_cards(preview, roster, yellows, reds)
            other = [x for x in site["u21Fixtures"] if x.get("id") == m["id"]]
            if len(other) != 1 or other[0].get("score") != m["score"]:
                raise ValueError("CMS and published match disagree")
            add_verified_cards(m, roster, yellows, reds)
            add_verified_cards(other[0], roster, yellows, reds)
            if m != preview:
                raise ValueError("Inconsistent updated match")
            if m.get("yellowCardEvents") != matching[0].get("yellowCardEvents"):
                raise ValueError("Inconsistent snapshot")
            changed_matches.add(m["id"]) if (yellows or reds) else None
            print(f"Verified Serie D match {m['date']} {m['home']} - {m['away']}: {len(yellows)} cautioned, {len(reds)} expelled", flush=True)
        except ValueError as exc:
            print(f"::warning::Skipping {m['id']}: {exc}", flush=True)
            continue
    # Only report real changes; don't rewrite volatile or unrelated data.
    original_cms = json.loads(cms_path.read_text(encoding="utf-8"))
    original_site = json.loads(data_path.read_text(encoding="utf-8"))
    dirty = cms != original_cms or site != original_site
    if dirty and apply:
        cms_path.write_text(json.dumps(cms, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        data_path.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Official Serie D U23 updates: {len(changed_matches) if dirty else 0} matches; files changed={dirty and apply}", flush=True)
    return dirty


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with requests.Session() as session:
        urls = discover(session)
        print(f"Discovered official CPA Trento bulletin PDFs: {len(urls)}", flush=True)
        if not urls:
            print("::warning::No recent official CPA Trento PDFs found. Skipping changes.", flush=True)
            return 0
        reports = []
        for url in urls:
            try:
                reports.append((url, pdf_text(session, url)))
            except (ValueError, requests.RequestException, subprocess.SubprocessError) as exc:
                print(f"::warning::Cannot parse {url}: {exc}", flush=True)
        if not reports:
            print("::warning::No readable verified 2026/27 PDFs. Nothing changed.", flush=True)
            return 0
    update_site(args.root, reports, args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
